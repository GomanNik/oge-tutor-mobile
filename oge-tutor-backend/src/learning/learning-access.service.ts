import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError, forbidden, notFound } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceContext } from '../workspace/workspace-context.service';

export type LearningTx = Prisma.TransactionClient;
export const learningConflict = (code: string, message: string) => new AppError(409, code, message);
export const teacherCourses = (ctx: WorkspaceContext): Prisma.CourseWhereInput => ({ workspaceId: ctx.workspaceId, teachers: { some: {
  status: 'active', startsOn: { lte: new Date() }, OR: [{ endsOn: null }, { endsOn: { gte: new Date(new Date().toISOString().slice(0, 10)) } }],
  membership: { userId: ctx.userId, status: 'active', roles: { some: { role: 'teacher', revokedAt: null } } },
} } });
export function learningCursor(row: { id: string; createdAt?: Date; recordedAt?: Date }) {
  return Buffer.from(JSON.stringify({ id: row.id, at: (row.createdAt || row.recordedAt)!.toISOString() })).toString('base64url');
}
export function parseLearningCursor(value?: string): { id: string; at: Date } | null {
  if (!value) return null;
  try {
    const data: unknown = JSON.parse(Buffer.from(value, 'base64url').toString());
    if (!data || typeof data !== 'object' || !('id' in data) || !('at' in data) || typeof data.id !== 'string' || !data.id || typeof data.at !== 'string' || !Number.isFinite(Date.parse(data.at))) throw new Error();
    return { id: data.id, at: new Date(data.at) };
  } catch { throw new AppError(400, 'invalid_cursor', 'Некорректный курсор.'); }
}

@Injectable()
export class LearningAccessService {
  constructor(readonly prisma: PrismaService) {}
  async live(tx: LearningTx, ctx: WorkspaceContext) {
    const member = await tx.workspaceMembership.findUnique({ where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: ctx.userId } }, include: { roles: true, workspace: true } });
    if (member?.status !== 'active' || member.workspace.status !== 'active' || !member.roles.some(r => r.role === ctx.role && !r.revokedAt)) throw forbidden();
  }
  async transaction<T>(ctx: WorkspaceContext, action: (tx: LearningTx) => Promise<T>) {
    for (let attempt = 0; ; attempt++) {
      try { return await this.prisma.$transaction(async tx => { await this.live(tx, ctx); return action(tx); }, { isolationLevel: 'Serializable', timeout: 15000 }); }
      catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
          continue;
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) throw learningConflict('concurrent_update', 'Данные изменились параллельно. Обновите страницу и повторите запрос.');
        throw error;
      }
    }
  }
  enrollmentScope(ctx: WorkspaceContext): Prisma.EnrollmentWhereInput {
    return { workspaceId: ctx.workspaceId, ...(ctx.role === 'teacher' ? { course: teacherCourses(ctx) } : ctx.role === 'student' ? { membership: { userId: ctx.userId } } : {}) };
  }
  async enrollment(tx: LearningTx, ctx: WorkspaceContext, id: string) {
    const row = await tx.enrollment.findFirst({ where: { id, ...this.enrollmentScope(ctx) }, include: { course: { include: { programVersion: { include: { program: true } } } }, membership: { include: { user: true } } } });
    if (!row) throw notFound();
    return row;
  }
  async target(tx: LearningTx, ctx: WorkspaceContext, type: string, id: string) {
    if (type === 'progress') {
      const enrollment = await this.enrollment(tx, ctx, id);
      return { type, id, title: enrollment.course.title, courseId: enrollment.courseId, enrollmentId: enrollment.id };
    }
    const course: Prisma.CourseWhereInput = ctx.role === 'teacher' ? teacherCourses(ctx) : { workspaceId: ctx.workspaceId };
    if (type === 'course') {
      const row = await tx.course.findFirst({ where: { id, ...course, ...(ctx.role === 'student' ? { enrollments: { some: { membership: { userId: ctx.userId }, status: { in: ['active', 'paused', 'completed'] } } } } : {}) } });
      if (row) return { type, id, title: row.title, courseId: id, enrollmentId: null };
    }
    if (type === 'lesson') {
      const row = await tx.lesson.findFirst({ where: { id, course, ...(ctx.role === 'student' ? { participants: { some: { enrollment: { membership: { userId: ctx.userId }, status: { in: ['active', 'paused', 'completed'] } } } } } : {}) } });
      if (row) return { type, id, title: row.topic, courseId: row.courseId, enrollmentId: null };
    }
    if (type === 'assignment') {
      const row = await tx.assignment.findFirst({ where: { id, course, ...(ctx.role === 'student' ? { publishedAt: { not: null }, recipients: { some: { enrollment: { membership: { userId: ctx.userId } } } } } : {}) } });
      if (row) return { type, id, title: row.title, courseId: row.courseId, enrollmentId: null };
    }
    if (type === 'material') {
      const row = await tx.learningMaterial.findFirst({ where: { id, workspaceId: ctx.workspaceId, ...(ctx.role === 'student' ? { archivedAt: null, publications: { some: { revokedAt: null, course: { status: 'active' }, recipients: { some: { enrollment: { status: 'active', membership: { userId: ctx.userId } } } } } } } : ctx.role === 'teacher' ? { OR: [{ createdByUserId: ctx.userId }, { publications: { some: { revokedAt: null, course } } }] } : {}) } });
      if (row) return { type, id, title: row.title, courseId: null, enrollmentId: null };
    }
    throw notFound('Связанный объект больше недоступен.');
  }
}
