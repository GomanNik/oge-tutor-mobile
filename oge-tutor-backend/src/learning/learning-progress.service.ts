import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { LearningProgressEvent, Prisma } from '@prisma/client';
import { AppError, forbidden, notFound, validationError } from '../common/app-error';
import { WorkspaceContext } from '../workspace/workspace-context.service';
import { CreateAssessmentDto, ProgressEventsQueryDto } from './learning.dto';
import { LearningAccessService, learningConflict, learningCursor, LearningTx, parseLearningCursor } from './learning-access.service';
import { LearningEventsService } from './learning-events.service';

const author = { author: { select: { displayName: true } }, replacement: { select: { id: true } } } satisfies Prisma.LearningProgressEventInclude;
type EventRow = LearningProgressEvent & { author?: { displayName: string } | null; replacement?: { id: string } | null };
export const progressEventDto = (row: EventRow) => ({ id: row.id, enrollmentId: row.enrollmentId, taskDefinitionId: row.taskDefinitionId,
  source: row.source, kind: row.kind, authorUserId: row.authorUserId, authorName: row.author?.displayName || null, visibility: row.visibility,
  score: row.score, maxScore: row.maxScore, coverageStatus: row.coverageStatus, masteryLevel: row.masteryLevel,
  comment: row.comment, basis: row.basis, reason: row.reason, evidence: row.evidence, supersedesId: row.supersedesId, replacedById: row.replacement?.id || null, occurredAt: row.occurredAt, recordedAt: row.recordedAt,
});

@Injectable()
export class LearningProgressService {
  constructor(private readonly access: LearningAccessService, private readonly eventsService: LearningEventsService) {}
  private eventScope(ctx: WorkspaceContext): Prisma.LearningProgressEventWhereInput {
    return ctx.role === 'teacher' ? { OR: [{ visibility: 'published' }, { authorUserId: ctx.userId }] } : { visibility: 'published' };
  }
  private async projection(tx: LearningTx, ctx: WorkspaceContext, enrollmentId: string) {
    const enrollment = await this.access.enrollment(tx, ctx, enrollmentId);
    const [tasks, projections, privateIds] = await Promise.all([
      tx.taskDefinition.findMany({ where: { programVersionId: enrollment.course.programVersionId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] }),
      tx.learningProgressProjection.findMany({ where: { enrollmentId }, include: { event: { include: author } } }),
      ctx.role === 'teacher' ? tx.$queryRaw<{ id: string }[]>`SELECT DISTINCT ON (e."taskDefinitionId") e.id FROM "LearningProgressEvent" e
        WHERE e."enrollmentId"=${enrollmentId} AND e."authorUserId"=${ctx.userId} AND e.visibility='private' AND e.kind<>'retraction' AND e."taskDefinitionId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "LearningProgressEvent" child WHERE child."supersedesId"=e.id)
        ORDER BY e."taskDefinitionId",e."occurredAt" DESC,e."recordedAt" DESC,e.id DESC` : [],
    ]);
    const privateEvents = privateIds.length ? await tx.learningProgressEvent.findMany({ where: { id: { in: privateIds.map(e => e.id) } }, include: author }) : [];
    return { enrollmentId, courseId: enrollment.courseId, courseTitle: enrollment.course.title, programVersionId: enrollment.course.programVersionId,
      studentUserId: enrollment.membership.userId, studentName: enrollment.membership.displayNameOverride || enrollment.membership.user.displayName,
      algorithmVersion: 'latest-published-v1', asOf: new Date(),
      tasks: tasks.map(task => ({ taskDefinitionId: task.id, code: task.code, title: task.title, maxScore: task.maxScore,
        event: projections.find(p => p.taskDefinitionId === task.id)?.event ? progressEventDto(projections.find(p => p.taskDefinitionId === task.id)!.event) : null,
        privateEvents: privateEvents.filter(e => e.taskDefinitionId === task.id).map(progressEventDto),
      })),
    };
  }
  async progress(ctx: WorkspaceContext, enrollmentId: string) { return this.access.transaction(ctx, async tx => ({ item: await this.projection(tx, ctx, enrollmentId) })); }
  async events(ctx: WorkspaceContext, enrollmentId: string, query: ProgressEventsQueryDto) {
    return this.access.transaction(ctx, async tx => {
      await this.access.enrollment(tx, ctx, enrollmentId);
      const cursor = parseLearningCursor(query.cursor);
      if (query.from && query.to && new Date(query.from) >= new Date(query.to)) throw validationError('Некорректный диапазон истории.');
      const rows = await tx.learningProgressEvent.findMany({ where: { AND: [this.eventScope(ctx), { enrollmentId, taskDefinitionId: query.taskDefinitionId, source: query.source,
        ...(query.from || query.to ? { occurredAt: { gte: query.from ? new Date(query.from) : undefined, lt: query.to ? new Date(query.to) : undefined } } : {}),
        ...(cursor ? { OR: [{ recordedAt: { lt: cursor.at } }, { recordedAt: cursor.at, id: { lt: cursor.id } }] } : {}),
      }] }, include: author, orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }], take: query.limit + 1 });
      const items = rows.slice(0, query.limit);
      return { items: items.map(progressEventDto), pageInfo: { nextCursor: rows.length > query.limit ? learningCursor(items[items.length - 1]) : null, hasMore: rows.length > query.limit } };
    });
  }
  async assess(ctx: WorkspaceContext, enrollmentId: string, body: CreateAssessmentDto, key: string) {
    if (ctx.role !== 'teacher') throw forbidden();
    if (!key || key.length > 128) throw new AppError(400, 'missing_idempotency_key', 'Нужен Idempotency-Key длиной до 128 символов.');
    return this.access.transaction(ctx, async tx => {
      const enrollment = await this.access.enrollment(tx, ctx, enrollmentId);
      const identity = { actorUserId: ctx.userId, route: `progress:${ctx.workspaceId}:${enrollmentId}`, key };
      const bodyHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
      const prior = await tx.idempotencyRecord.findUnique({ where: { actorUserId_route_key: identity } });
      if (prior && prior.expiresAt > new Date()) {
        if (prior.bodyHash !== bodyHash) throw learningConflict('idempotency_conflict', 'Ключ уже использован с другим запросом.');
        return prior.response;
      }
      if (prior) await tx.idempotencyRecord.delete({ where: { id: prior.id } });
      if (enrollment.status !== 'active' || enrollment.course.status !== 'active') throw learningConflict('inactive_enrollment', 'Оценка доступна для активного зачисления и курса.');
      const today = new Date().toISOString().slice(0, 10);
      if (enrollment.startsOn && enrollment.startsOn.toISOString().slice(0, 10) > today || enrollment.endsOn && enrollment.endsOn.toISOString().slice(0, 10) < today) throw learningConflict('inactive_enrollment', 'Период зачисления не включает текущую дату.');
      const task = await tx.taskDefinition.findFirst({ where: { id: body.taskDefinitionId, programVersionId: enrollment.course.programVersionId } });
      if (!task) throw validationError('Задание должно принадлежать версии программы курса.');
      const parent = body.replacesEventId ? await tx.learningProgressEvent.findFirst({ where: { id: body.replacesEventId, enrollmentId, taskDefinitionId: task.id, authorUserId: ctx.userId, source: { in: ['manual', 'diagnostic'] }, replacement: null } }) : null;
      if (body.replacesEventId && !parent) throw notFound('Исходная оценка недоступна или уже исправлена.');
      if ((parent || body.retract) && (!parent || (body.reason?.trim().length || 0) < 5)) throw validationError('Для исправления нужны исходное событие и причина от 5 символов.');
      if (body.basis.trim().length < 5) throw validationError('Основание должно содержать не менее 5 символов.');
      if (parent?.visibility === 'published' && body.visibility !== 'published') throw validationError('Опубликованное исправление должно остаться опубликованным.');
      if (!body.retract && body.score === undefined && !body.masteryLevel && !body.coverageStatus) throw validationError('Укажите оценку или состояние изучения.');
      if (!body.retract && body.coverageStatus === 'assessed' && body.score === undefined && !body.masteryLevel) throw validationError('Для состояния «Оценено» нужен балл или уровень освоения.');
      if (body.score !== undefined && (task.maxScore === null || body.score > task.maxScore)) throw validationError('Балл превышает максимум задания или у задания нет балльной шкалы.');
      if (body.masteryLevel && body.coverageStatus && body.coverageStatus !== 'assessed') throw validationError('Уровень освоения требует состояния «Оценено».');
      if (body.score !== undefined && body.coverageStatus && body.coverageStatus !== 'assessed') throw validationError('Балл требует состояния «Оценено».');
      const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
      if (occurredAt.getTime() > Date.now() + 1000) throw validationError('Время оценки не может быть в будущем.');
      const row = await tx.learningProgressEvent.create({ data: { enrollmentId, taskDefinitionId: task.id, source: body.source, sourceKey: `manual:${randomUUID()}`, kind: body.retract ? 'retraction' : 'assessment',
        authorUserId: ctx.userId, visibility: body.visibility, score: body.retract ? null : body.score, maxScore: body.score !== undefined && !body.retract ? task.maxScore : null,
        coverageStatus: body.retract ? null : body.coverageStatus || (body.masteryLevel || body.score !== undefined ? 'assessed' : null), masteryLevel: body.retract ? null : body.masteryLevel,
        basis: body.basis.trim(), comment: body.comment.trim(), reason: body.reason?.trim() || '', supersedesId: parent?.id, occurredAt,
      }, include: author });
      if (row.visibility === 'published') await this.eventsService.notifyEnrollments(tx, ctx, `progress:${row.id}`, enrollment.courseId, [enrollmentId], 'progress.updated', { type: 'progress', id: enrollmentId }, 'Обновлён прогресс по курсу');
      await tx.workspaceAuditEvent.create({ data: { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, targetType: 'progress_event', targetId: row.id, action: 'progress.assessed', changes: { enrollmentId, visibility: row.visibility, supersedesId: row.supersedesId }, reason: row.reason || undefined, requestId: ctx.requestId } });
      const result = { item: progressEventDto(row), changed: ['progress', 'notifications'], requestId: ctx.requestId };
      await tx.idempotencyRecord.create({ data: { ...identity, bodyHash, response: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + 86400000) } });
      return result;
    });
  }
  async programProgress(ctx: WorkspaceContext, userId: string, versionId: string) {
    if (ctx.role === 'student' && ctx.userId !== userId) throw notFound();
    return this.access.transaction(ctx, async tx => {
      const enrollments = await tx.enrollment.findMany({ where: { ...this.access.enrollmentScope(ctx), membership: { userId }, course: { AND: [ctx.role === 'teacher' ? this.access.enrollmentScope(ctx).course || {} : {}, { programVersionId: versionId }] } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 101 });
      if (!enrollments.length) throw notFound();
      if (enrollments.length > 100) throw validationError('Для этой сводки выберите отдельный курс: превышен лимит 100 зачислений.');
      const courses = [];
      for (const enrollment of enrollments) courses.push(await this.projection(tx, ctx, enrollment.id));
      return { item: { studentUserId: userId, programVersionId: versionId, algorithmVersion: 'separate-courses-v1', asOf: new Date(), courses } };
    });
  }
  async rebuildProgress() {
    return this.access.prisma.$transaction(async tx => {
      await tx.learningProgressProjection.deleteMany();
      await tx.$executeRaw`SELECT learning_rebuild_progress()`;
      return tx.learningProgressProjection.count();
    }, { timeout: 60000, isolationLevel: 'Serializable' });
  }
}
