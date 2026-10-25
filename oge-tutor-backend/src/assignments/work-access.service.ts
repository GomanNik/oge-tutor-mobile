import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AppError, forbidden, notFound, validationError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceContext } from '../workspace/workspace-context.service';

export type WorkTx = Prisma.TransactionClient;
export const workConflict = (code: string, message: string) => new AppError(409, code, message);
export function checkRevision(actual: number, expected: number) {
  if (actual !== expected) throw new AppError(412, 'revision_mismatch', 'Запись изменилась. Обновите страницу.');
}
export function workRevision(value?: string) {
  if (!value) throw new AppError(428, 'precondition_required', 'Нужен заголовок If-Match.');
  const normalized = value.replace(/^"(\d+)"$/, '$1');
  if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(Number(normalized))) throw new AppError(400, 'invalid_revision', 'Некорректная ревизия.');
  return Number(normalized);
}
export const fileDto = (file: { id: string; originalName: string; mimeType: string; size: number; checksum: string | null; uploadedAt: Date }) => ({
  id: file.id, originalName: file.originalName, mimeType: file.mimeType, size: file.size, checksum: file.checksum, uploadedAt: file.uploadedAt,
});
export type TaskSnapshot = { id: string; code: string; title: string; maxScore: number | null; criteria: { code: string; title: string; maxScore: number }[] };

@Injectable()
export class WorkAccessService {
  constructor(readonly prisma: PrismaService) {}

  async live(tx: WorkTx, ctx: WorkspaceContext) {
    const member = await tx.workspaceMembership.findUnique({ where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: ctx.userId } }, include: { roles: true, workspace: true } });
    if (member?.status !== 'active' || member.workspace.status !== 'active' || !member.roles.some(r => r.role === ctx.role && !r.revokedAt)) throw forbidden();
    return member;
  }

  teacherScope(ctx: WorkspaceContext): Prisma.CourseWhereInput {
    return { workspaceId: ctx.workspaceId, teachers: { some: { status: 'active', startsOn: { lte: new Date() }, OR: [{ endsOn: null }, { endsOn: { gte: new Date(new Date().toISOString().slice(0, 10)) } }], membership: { userId: ctx.userId, status: 'active', roles: { some: { role: 'teacher', revokedAt: null } } } } } };
  }

  async editor(tx: WorkTx, ctx: WorkspaceContext, courseId: string, privateWork = false) {
    if (ctx.role === 'student') throw forbidden();
    const scope = ctx.role === 'admin' && !privateWork ? { workspaceId: ctx.workspaceId } : this.teacherScope(ctx);
    const course = await tx.course.findFirst({ where: { ...scope, id: courseId } });
    if (!course) throw notFound();
    return course;
  }

  async tasks(tx: WorkTx, versionId: string, ids: string[]): Promise<TaskSnapshot[]> {
    const tasks = await tx.taskDefinition.findMany({ where: { programVersionId: versionId, id: { in: ids } }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
    if (tasks.length !== ids.length) throw validationError('Задания должны принадлежать версии программы курса.');
    return tasks.map(task => ({ id: task.id, code: task.code, title: task.title, maxScore: task.maxScore, criteria: task.criteria as TaskSnapshot['criteria'] }));
  }

  async recipients(tx: WorkTx, courseId: string, ids: string[]) {
    const rows = await tx.enrollment.findMany({ where: { courseId, id: { in: ids }, status: 'active', membership: { status: 'active', roles: { some: { role: 'student', revokedAt: null } } } } });
    const today = new Date().toISOString().slice(0, 10);
    if (rows.length !== ids.length || rows.some(row => row.startsOn && row.startsOn.toISOString().slice(0, 10) > today || row.endsOn && row.endsOn.toISOString().slice(0, 10) < today)) throw validationError('Выберите действующие зачисления этого курса.');
    return rows;
  }

  async ownFiles(tx: WorkTx, ctx: WorkspaceContext, ids: string[], purpose: 'material' | 'submission') {
    if (!ids.length) return;
    const files = await tx.fileResource.findMany({ where: { id: { in: ids }, workspaceId: ctx.workspaceId, ownerId: ctx.userId } });
    if (files.length !== ids.length || files.some(file => purpose === 'material' ? file.scope === 'private_submission' : file.scope !== 'private_submission')) throw validationError('Файл недоступен или имеет другое назначение.');
  }

  future(value: string | Date) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date <= new Date()) throw validationError('Укажите будущий срок сдачи.');
    return date;
  }

  async transaction<T>(ctx: WorkspaceContext, action: (tx: WorkTx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(async tx => { await this.live(tx, ctx); return action(tx); }, { isolationLevel: 'Serializable', timeout: 15000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) throw workConflict('concurrent_update', 'Параллельное изменение. Обновите данные и повторите запрос с тем же ключом.');
      throw error;
    }
  }

  // Authorization is performed by the caller before replaying a stored response.
  async once<T>(tx: WorkTx, ctx: WorkspaceContext, route: string, key: string, body: unknown, action: () => Promise<T>): Promise<T> {
    if (!key || key.length > 128) throw new AppError(400, 'missing_idempotency_key', 'Нужен Idempotency-Key длиной до 128 символов.');
    const identity = { actorUserId: ctx.userId, route: `work:${ctx.workspaceId}:${ctx.role}:${route}`, key };
    const bodyHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const prior = await tx.idempotencyRecord.findUnique({ where: { actorUserId_route_key: identity } });
    if (prior && prior.expiresAt > new Date()) {
      if (prior.bodyHash !== bodyHash) throw workConflict('idempotency_conflict', 'Ключ уже использован с другим запросом.');
      return prior.response as T;
    }
    if (prior) await tx.idempotencyRecord.delete({ where: { id: prior.id } });
    const result = await action();
    await tx.idempotencyRecord.create({ data: { ...identity, bodyHash, response: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + 86400000) } });
    return result;
  }

  async audit(tx: WorkTx, ctx: WorkspaceContext, targetType: string, targetId: string, action: string, changes: Prisma.InputJsonValue = {}, reason?: string) {
    await tx.workspaceAuditEvent.create({ data: { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, targetType, targetId, action, changes, reason, requestId: ctx.requestId } });
  }
}
