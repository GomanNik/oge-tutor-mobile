import { Injectable } from '@nestjs/common';
import { CatalogStatus, Prisma, ProgramVersionStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AuthUser } from '../common/current-user';
import { AppError, forbidden, notFound, validationError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../workspace/workspace-context.service';
import {
  CatalogQueryDto, CreateProgramDto, CreateProgramVersionDto, CreateSubjectDto,
  CreateTaskMappingDto, ScoringRuleDto, TaskInputDto, UpdateProgramVersionDto,
} from './program-catalog.dto';

type Actor = { user: AuthUser; role?: string; requestId: string };
type Owner = { workspaceId: string | null };
const revisionError = () => new AppError(412, 'revision_mismatch', 'Запись изменилась. Обновите страницу.');
const invalidState = (message: string) => new AppError(409, 'invalid_state', message);
const duplicate = () => new AppError(409, 'duplicate_catalog_entry', 'Такая запись уже существует.');
const page = <T>(items: T[], total: number, query: CatalogQueryDto) => ({ items, total, page: query.page, pageSize: query.pageSize });
const paging = (query: CatalogQueryDto) => ({ skip: (query.page - 1) * query.pageSize, take: query.pageSize });
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scopeKey = (workspaceId: string | null) => workspaceId ? `w:${workspaceId}` : 'global';

function normalizeError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw duplicate();
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') throw new AppError(409, 'concurrent_update', 'Запись меняется. Повторите запрос.');
  throw error;
}

function taskData(body: TaskInputDto) {
  const criteria = body.criteria || [];
  if (!body.code.trim()) throw validationError('Укажите код задания.');
  if (new Set(criteria.map(item => item.code)).size !== criteria.length) throw validationError('Коды критериев должны быть уникальными.');
  if (criteria.length && criteria.reduce((sum, item) => sum + item.maxScore, 0) !== body.maxScore) {
    throw validationError('Сумма баллов критериев должна равняться максимуму задания.');
  }
  if (body.topics.some(topic => !topic.trim() || topic.length > 100)) throw validationError('Некорректная тема задания.');
  return {
    code: body.code.trim(), title: body.title.trim(), topics: body.topics.map(item => item.trim()),
    position: body.position, kind: body.kind, maxScore: body.maxScore,
    criteria: criteria.map(item => ({ code: item.code, title: item.title.trim(), maxScore: item.maxScore })) as Prisma.InputJsonValue,
  };
}

@Injectable()
export class ProgramCatalogService {
  constructor(private readonly prisma: PrismaService, private readonly contexts: WorkspaceContextService) {}

  private async readScope(actor: Actor, workspaceId?: string) {
    if (workspaceId) await this.contexts.resolve(actor.user, workspaceId, actor.role, actor.requestId);
    return workspaceId || null;
  }

  private async canManage(actor: Actor, owner: Owner) {
    if (owner.workspaceId) {
      if (actor.role !== 'admin') return false;
      try { await this.contexts.resolve(actor.user, owner.workspaceId, actor.role, actor.requestId); return true; }
      catch (error) {
        if (error instanceof AppError && (error.status === 403 || error.status === 404)) return false;
        throw error;
      }
    }
    return Boolean(await this.prisma.catalogGrant.findUnique({ where: { userId: actor.user.id } }));
  }

  private async assertReadable(actor: Actor, owner: Owner, status?: ProgramVersionStatus) {
    if (owner.workspaceId) await this.readScope(actor, owner.workspaceId);
    if (status === 'draft' && !await this.canManage(actor, owner)) throw notFound();
  }

  private async assertManager(actor: Actor, owner: Owner) {
    if (!await this.canManage(actor, owner)) throw forbidden();
  }

  private async managerInTx(tx: Prisma.TransactionClient, actor: Actor, workspaceId: string | null) {
    if (!workspaceId) {
      if (!await tx.catalogGrant.findUnique({ where: { userId: actor.user.id } })) throw forbidden();
      return;
    }
    if (actor.role !== 'admin') throw forbidden();
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`;
    const member = await tx.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: actor.user.id } }, include: { workspace: true, roles: true },
    });
    if (member?.status !== 'active' || member.workspace.status !== 'active' || !member.roles.some(grant => grant.role === 'admin' && !grant.revokedAt)) throw forbidden();
  }

  private async audit(tx: Prisma.TransactionClient, actor: Actor, owner: Owner, action: string, targetType: string, targetId: string, changes: Prisma.InputJsonValue) {
    await tx.catalogAuditEvent.create({ data: {
      workspaceId: owner.workspaceId, actorUserId: actor.user.id, targetType, targetId, action, changes, requestId: actor.requestId,
    } });
    if (owner.workspaceId) await tx.workspaceAuditEvent.create({ data: {
      workspaceId: owner.workspaceId, actorUserId: actor.user.id, targetType, targetId, action, changes, requestId: actor.requestId,
    } });
  }

  private async mutate<T>(actor: Actor, owner: Owner, action: (tx: Prisma.TransactionClient) => Promise<T>) {
    await this.assertManager(actor, owner);
    try {
      return await this.prisma.$transaction(async tx => {
        await this.managerInTx(tx, actor, owner.workspaceId);
        return action(tx);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) { normalizeError(error); }
  }

  private async createOnce<T>(actor: Actor, owner: Owner, route: string, key: string, body: unknown, action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (!key || key.length > 128) throw new AppError(400, 'missing_idempotency_key', 'Нужен Idempotency-Key длиной до 128 символов.');
    const bodyHash = hash(body);
    try {
      return await this.mutate(actor, owner, async tx => {
        const identity = { actorUserId: actor.user.id, route, key };
        const previous = await tx.idempotencyRecord.findUnique({ where: { actorUserId_route_key: identity } });
        if (previous) {
          if (previous.bodyHash !== bodyHash) throw new AppError(409, 'idempotency_conflict', 'Ключ уже применён к другому запросу.');
          return previous.response as T;
        }
        const result = await action(tx);
        await tx.idempotencyRecord.create({ data: { ...identity, bodyHash, response: result as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + 86400000) } });
        return result;
      });
    } catch (error) {
      if ((error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034'))
        || (error instanceof AppError && (error.code === 'duplicate_catalog_entry' || error.code === 'concurrent_update'))) {
        const previous = await this.prisma.idempotencyRecord.findUnique({ where: { actorUserId_route_key: { actorUserId: actor.user.id, route, key } } });
        if (previous?.bodyHash === bodyHash) return previous.response as T;
      }
      throw error;
    }
  }

  async subjects(actor: Actor, query: CatalogQueryDto) {
    const workspaceId = await this.readScope(actor, query.workspaceId);
    const where: Prisma.SubjectWhereInput = {
      AND: [
        workspaceId ? { OR: [{ workspaceId: null }, { workspaceId }] } : { workspaceId: null },
        ...(query.q ? [{ OR: [{ name: { contains: query.q, mode: 'insensitive' as const } }, { code: { contains: query.q, mode: 'insensitive' as const } }] }] : []),
      ],
      status: query.status,
    };
    const [items, total] = await Promise.all([
      this.prisma.subject.findMany({ where, ...paging(query), orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
      this.prisma.subject.count({ where }),
    ]);
    return page(items, total, query);
  }

  async subject(actor: Actor, id: string) {
    const item = await this.prisma.subject.findUnique({ where: { id } });
    if (!item) throw notFound();
    await this.assertReadable(actor, item);
    return { item };
  }

  async createSubject(actor: Actor, body: CreateSubjectDto, key: string) {
    const owner = { workspaceId: body.workspaceId || null };
    return this.createOnce(actor, owner, 'catalog:subjects', key, body, async tx => {
      const item = await tx.subject.create({ data: { scopeKey: scopeKey(owner.workspaceId), workspaceId: owner.workspaceId, code: body.code, name: body.name.trim() } });
      await this.audit(tx, actor, owner, 'subject.created', 'subject', item.id, { code: item.code });
      return { item, changed: ['subjects'], requestId: actor.requestId };
    });
  }

  async updateSubject(actor: Actor, id: string, name: string, revision: number, archive = false) {
    const current = await this.prisma.subject.findUnique({ where: { id } });
    if (!current) throw notFound();
    return this.mutate(actor, current, async tx => {
      const updated = await tx.subject.updateMany({ where: { id, revision, status: 'active' }, data: { ...(archive ? { status: 'archived' as CatalogStatus } : { name: name.trim() }), revision: { increment: 1 } } });
      if (!updated.count) throw revisionError();
      const item = await tx.subject.findUniqueOrThrow({ where: { id } });
      await this.audit(tx, actor, current, archive ? 'subject.archived' : 'subject.updated', 'subject', id, { status: item.status, name: item.name });
      return { item, changed: ['subjects'], requestId: actor.requestId };
    });
  }

  async programs(actor: Actor, query: CatalogQueryDto) {
    const workspaceId = await this.readScope(actor, query.workspaceId);
    const where: Prisma.ExamProgramWhereInput = {
      AND: [
        workspaceId ? { OR: [{ workspaceId: null }, { workspaceId }] } : { workspaceId: null },
        ...(query.q ? [{ OR: [{ name: { contains: query.q, mode: 'insensitive' as const } }, { code: { contains: query.q, mode: 'insensitive' as const } }] }] : []),
      ],
      subjectId: query.subjectId, examType: query.examType, variant: query.variant, status: query.status,
    };
    const [items, total] = await Promise.all([
      this.prisma.examProgram.findMany({ where, include: { subject: { select: { code: true, name: true } } }, ...paging(query), orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
      this.prisma.examProgram.count({ where }),
    ]);
    return page(items, total, query);
  }

  async program(actor: Actor, id: string) {
    const item = await this.prisma.examProgram.findUnique({ where: { id }, include: { subject: { select: { code: true, name: true } } } });
    if (!item) throw notFound();
    await this.assertReadable(actor, item);
    return { item };
  }

  async createProgram(actor: Actor, body: CreateProgramDto, key: string) {
    const owner = { workspaceId: body.workspaceId || null };
    return this.createOnce(actor, owner, 'catalog:programs', key, body, async tx => {
      const subject = await tx.subject.findUnique({ where: { id: body.subjectId } });
      if (!subject || subject.status !== 'active' || (subject.workspaceId && subject.workspaceId !== owner.workspaceId) || (!owner.workspaceId && subject.workspaceId)) throw validationError('Предмет недоступен.');
      const item = await tx.examProgram.create({ data: {
        scopeKey: scopeKey(owner.workspaceId), workspaceId: owner.workspaceId, subjectId: body.subjectId,
        code: body.code, examType: body.examType, variant: body.variant, name: body.name.trim(),
      } });
      await this.audit(tx, actor, owner, 'program.created', 'program', item.id, { code: item.code, subjectId: item.subjectId, examType: item.examType, variant: item.variant });
      return { item, changed: ['programs'], requestId: actor.requestId };
    });
  }

  async updateProgram(actor: Actor, id: string, name: string, revision: number, archive = false) {
    const current = await this.prisma.examProgram.findUnique({ where: { id } });
    if (!current) throw notFound();
    return this.mutate(actor, current, async tx => {
      const updated = await tx.examProgram.updateMany({ where: { id, revision, status: 'active' }, data: { ...(archive ? { status: 'archived' as CatalogStatus } : { name: name.trim() }), revision: { increment: 1 } } });
      if (!updated.count) throw revisionError();
      const item = await tx.examProgram.findUniqueOrThrow({ where: { id } });
      await this.audit(tx, actor, current, archive ? 'program.archived' : 'program.updated', 'program', id, { status: item.status, name: item.name });
      return { item, changed: ['programs'], requestId: actor.requestId };
    });
  }

  async versions(actor: Actor, programId: string, query: CatalogQueryDto) {
    const program = await this.prisma.examProgram.findUnique({ where: { id: programId } });
    if (!program) throw notFound();
    await this.assertReadable(actor, program);
    const manager = await this.canManage(actor, program);
    if (query.versionStatus === 'draft' && !manager) return page([], 0, query);
    const where: Prisma.ProgramVersionWhereInput = {
      programId, period: query.period, status: query.versionStatus || (manager ? undefined : { in: ['published', 'archived'] }),
    };
    const [items, total] = await Promise.all([
      this.prisma.programVersion.findMany({ where, ...paging(query), orderBy: [{ period: 'desc' }, { revisionNumber: 'desc' }, { id: 'desc' }] }),
      this.prisma.programVersion.count({ where }),
    ]);
    return page(items, total, query);
  }

  private async versionForRead(actor: Actor, id: string) {
    const row = await this.prisma.programVersion.findUnique({ where: { id }, include: { program: true, scoringRule: true } });
    if (!row) throw notFound();
    await this.assertReadable(actor, row.program, row.status);
    return row;
  }

  async version(actor: Actor, id: string) { return { item: await this.versionForRead(actor, id) }; }

  async createVersion(actor: Actor, programId: string, body: CreateProgramVersionDto, key: string) {
    const program = await this.prisma.examProgram.findUnique({ where: { id: programId } });
    if (!program) throw notFound();
    return this.createOnce(actor, program, `catalog:versions:${programId}`, key, body, async tx => {
      const current = await tx.examProgram.findUniqueOrThrow({ where: { id: programId }, include: { subject: true } });
      if (current.status !== 'active' || current.subject.status !== 'active') throw invalidState('Архивная программа или предмет не допускают новую версию.');
      const item = await tx.programVersion.create({ data: {
        programId, period: body.period, revisionNumber: body.revisionNumber, sourceUrl: body.sourceUrl, notes: body.notes?.trim() || '',
      } });
      await this.audit(tx, actor, program, 'version.created', 'program_version', item.id, { period: item.period, revisionNumber: item.revisionNumber });
      return { item, changed: ['program-versions'], requestId: actor.requestId };
    });
  }

  private async editDraft<T>(actor: Actor, id: string, revision: number, action: (tx: Prisma.TransactionClient, owner: Owner) => Promise<T>) {
    const current = await this.prisma.programVersion.findUnique({ where: { id }, include: { program: true } });
    if (!current) throw notFound();
    return this.mutate(actor, current.program, async tx => {
      const row = await tx.programVersion.findUniqueOrThrow({ where: { id } });
      if (row.revision !== revision) throw revisionError();
      if (row.status !== 'draft') throw invalidState('Редактировать можно только черновик.');
      const update = await tx.programVersion.updateMany({ where: { id, revision, status: 'draft' }, data: { revision: { increment: 1 } } });
      if (!update.count) throw revisionError();
      return action(tx, current.program);
    });
  }

  async updateVersion(actor: Actor, id: string, body: UpdateProgramVersionDto, revision: number) {
    if (body.sourceUrl === undefined && body.notes === undefined) throw validationError('Укажите изменяемое поле.');
    return this.editDraft(actor, id, revision, async (tx, owner) => {
      const item = await tx.programVersion.update({ where: { id }, data: { sourceUrl: body.sourceUrl, notes: body.notes?.trim() } });
      await this.audit(tx, actor, owner, 'version.updated', 'program_version', id, { sourceUrl: item.sourceUrl, notes: item.notes });
      return { item, changed: ['program-versions'], requestId: actor.requestId };
    });
  }

  async tasks(actor: Actor, id: string, query: CatalogQueryDto) {
    await this.versionForRead(actor, id);
    const where = { programVersionId: id };
    const [items, total] = await Promise.all([
      this.prisma.taskDefinition.findMany({ where, ...paging(query), orderBy: [{ position: 'asc' }, { id: 'asc' }] }),
      this.prisma.taskDefinition.count({ where }),
    ]);
    return page(items, total, query);
  }

  async createTask(actor: Actor, id: string, body: TaskInputDto, revision: number) {
    const data = taskData(body);
    return this.editDraft(actor, id, revision, async (tx, owner) => {
      const item = await tx.taskDefinition.create({ data: { programVersionId: id, ...data } });
      await this.audit(tx, actor, owner, 'task.created', 'task', item.id, { versionId: id, code: item.code });
      const version = await tx.programVersion.findUniqueOrThrow({ where: { id } });
      return { item, versionRevision: version.revision, changed: ['tasks', 'program-versions'], requestId: actor.requestId };
    });
  }

  async updateTask(actor: Actor, id: string, taskId: string, body: TaskInputDto, revision: number) {
    const data = taskData(body);
    return this.editDraft(actor, id, revision, async (tx, owner) => {
      const existing = await tx.taskDefinition.findFirst({ where: { id: taskId, programVersionId: id } });
      if (!existing) throw notFound();
      const item = await tx.taskDefinition.update({ where: { id: taskId }, data });
      await this.audit(tx, actor, owner, 'task.updated', 'task', item.id, { versionId: id, code: item.code });
      const version = await tx.programVersion.findUniqueOrThrow({ where: { id } });
      return { item, versionRevision: version.revision, changed: ['tasks', 'program-versions'], requestId: actor.requestId };
    });
  }

  async deleteTask(actor: Actor, id: string, taskId: string, revision: number) {
    return this.editDraft(actor, id, revision, async (tx, owner) => {
      const existing = await tx.taskDefinition.findFirst({ where: { id: taskId, programVersionId: id } });
      if (!existing) throw notFound();
      await tx.taskDefinition.delete({ where: { id: taskId } });
      await this.audit(tx, actor, owner, 'task.deleted', 'task', taskId, { versionId: id, code: existing.code });
      const version = await tx.programVersion.findUniqueOrThrow({ where: { id } });
      return { item: { id: taskId }, versionRevision: version.revision, changed: ['tasks', 'program-versions'], requestId: actor.requestId };
    });
  }

  async setScoringRule(actor: Actor, id: string, body: ScoringRuleDto, revision: number) {
    if (body.kind === 'verified_reference' && !body.sourceUrl) throw validationError('Для подтверждённого правила нужен источник.');
    return this.editDraft(actor, id, revision, async (tx, owner) => {
      const item = await tx.scoringRule.upsert({
        where: { programVersionId: id },
        create: { programVersionId: id, kind: body.kind, code: body.code, description: body.description.trim(), sourceUrl: body.sourceUrl },
        update: { kind: body.kind, code: body.code, description: body.description.trim(), sourceUrl: body.sourceUrl || null },
      });
      await this.audit(tx, actor, owner, 'scoring_rule.set', 'scoring_rule', item.id, { versionId: id, kind: item.kind, code: item.code });
      const version = await tx.programVersion.findUniqueOrThrow({ where: { id } });
      return { item, versionRevision: version.revision, changed: ['program-versions'], requestId: actor.requestId };
    });
  }

  async publish(actor: Actor, id: string, revision: number) {
    const current = await this.prisma.programVersion.findUnique({ where: { id }, include: { program: true } });
    if (!current) throw notFound();
    return this.mutate(actor, current.program, async tx => {
      const version = await tx.programVersion.findUniqueOrThrow({ where: { id }, include: { program: { include: { subject: true } }, tasks: true, scoringRule: true } });
      if (version.revision !== revision) throw revisionError();
      if (version.status !== 'draft') throw invalidState('Опубликовать можно только черновик.');
      if (version.program.status !== 'active' || version.program.subject.status !== 'active') throw invalidState('Программа или предмет архивированы.');
      if (!version.sourceUrl) throw validationError('Для публикации нужен источник программы.');
      if (!version.tasks.length) throw validationError('Добавьте хотя бы одно задание.');
      if (version.tasks.some(task => !task.maxScore)) throw validationError('Укажите баллы всех заданий.');
      const item = await tx.programVersion.update({ where: { id }, data: { status: 'published', publishedAt: new Date(), revision: { increment: 1 } } });
      await this.audit(tx, actor, current.program, 'version.published', 'program_version', id, { period: item.period, revisionNumber: item.revisionNumber, taskCount: version.tasks.length });
      return { item, changed: ['program-versions'], requestId: actor.requestId };
    });
  }

  async archiveVersion(actor: Actor, id: string, revision: number) {
    const current = await this.prisma.programVersion.findUnique({ where: { id }, include: { program: true } });
    if (!current) throw notFound();
    return this.mutate(actor, current.program, async tx => {
      const updated = await tx.programVersion.updateMany({ where: { id, revision, status: 'published' }, data: { status: 'archived', revision: { increment: 1 } } });
      if (!updated.count) throw revisionError();
      const item = await tx.programVersion.findUniqueOrThrow({ where: { id } });
      await this.audit(tx, actor, current.program, 'version.archived', 'program_version', id, { status: item.status });
      return { item, changed: ['program-versions'], requestId: actor.requestId };
    });
  }

  async mappings(actor: Actor, fromVersionId: string, toVersionId: string, query: CatalogQueryDto) {
    const from = await this.versionForRead(actor, fromVersionId);
    const to = await this.versionForRead(actor, toVersionId);
    if (from.programId !== to.programId) throw validationError('Сопоставление возможно только внутри одной программы.');
    if (query.includeRevoked && !await this.canManage(actor, from.program)) throw forbidden();
    const where: Prisma.TaskMappingWhereInput = { fromTask: { programVersionId: fromVersionId }, toTask: { programVersionId: toVersionId }, ...(query.includeRevoked ? {} : { revokedAt: null }) };
    const [items, total] = await Promise.all([
      this.prisma.taskMapping.findMany({ where, include: { fromTask: { select: { code: true, title: true } }, toTask: { select: { code: true, title: true } } }, ...paging(query), orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      this.prisma.taskMapping.count({ where }),
    ]);
    return page(items, total, query);
  }

  async createMapping(actor: Actor, body: CreateTaskMappingDto, key: string) {
    const [from, to] = await Promise.all([
      this.prisma.taskDefinition.findUnique({ where: { id: body.fromTaskId }, include: { programVersion: { include: { program: true } } } }),
      this.prisma.taskDefinition.findUnique({ where: { id: body.toTaskId }, include: { programVersion: { include: { program: true } } } }),
    ]);
    if (!from || !to) throw notFound();
    if (from.programVersionId === to.programVersionId || from.programVersion.programId !== to.programVersion.programId) throw validationError('Нужны задания разных версий одной программы.');
    if (from.programVersion.status === 'draft' || to.programVersion.status === 'draft') throw validationError('Сопоставлять можно опубликованные версии.');
    const owner = from.programVersion.program;
    return this.createOnce(actor, owner, 'catalog:task-mappings', key, body, async tx => {
      const item = await tx.taskMapping.create({ data: { fromTaskId: body.fromTaskId, toTaskId: body.toTaskId, reason: body.reason.trim(), createdById: actor.user.id } });
      await this.audit(tx, actor, owner, 'task_mapping.created', 'task_mapping', item.id, { fromTaskId: item.fromTaskId, toTaskId: item.toTaskId });
      return { item, changed: ['task-mappings'], requestId: actor.requestId };
    });
  }

  async revokeMapping(actor: Actor, id: string, reason: string, revision: number) {
    const current = await this.prisma.taskMapping.findUnique({ where: { id }, include: { fromTask: { include: { programVersion: { include: { program: true } } } } } });
    if (!current) throw notFound();
    const owner = current.fromTask.programVersion.program;
    return this.mutate(actor, owner, async tx => {
      const updated = await tx.taskMapping.updateMany({ where: { id, revision, revokedAt: null }, data: {
        revision: { increment: 1 }, revokedAt: new Date(), revokedById: actor.user.id, revocationReason: reason.trim(),
      } });
      if (!updated.count) {
        const row = await tx.taskMapping.findUniqueOrThrow({ where: { id } });
        if (row.revision !== revision) throw revisionError();
        throw invalidState('Сопоставление уже отозвано.');
      }
      const item = await tx.taskMapping.findUniqueOrThrow({ where: { id } });
      await this.audit(tx, actor, owner, 'task_mapping.revoked', 'task_mapping', id, { reason: item.revocationReason });
      return { item, changed: ['task-mappings'], requestId: actor.requestId };
    });
  }
}
