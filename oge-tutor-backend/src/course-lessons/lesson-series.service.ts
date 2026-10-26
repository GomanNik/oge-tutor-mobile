import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { getJwtSecret } from '../auth/auth-config';
import { AppError, forbidden, notFound, validationError } from '../common/app-error';
import { checkRevision } from '../assignments/work-access.service';
import { WorkspaceContext } from '../workspace/workspace-context.service';
import { LearningAccessService, LearningTx, learningConflict, teacherCourses } from '../learning/learning-access.service';
import { LearningEventsService } from '../learning/learning-events.service';
import { CourseLessonsService } from './course-lessons.service';
import { lockLessonPeople, lessonConflicts } from './lesson-schedule';
import { SaveSeriesDto, SeriesActionDto, SeriesActionPreviewDto, SeriesPreviewDto, SeriesQueryDto, SeriesRuleDto } from './lesson-series.dto';
import { expandSeries, normalizeSeriesRule, RecurrenceIssue, seriesHasEnded } from './series-recurrence';

const include = { teachers: true, participants: true } satisfies Prisma.LessonSeriesInclude;
type SeriesRow = Prisma.LessonSeriesGetPayload<{ include: typeof include }>;
type Operation = 'create' | 'update' | SeriesActionPreviewDto['action'];
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ruleFor = (row: SeriesRow): SeriesRuleDto => normalizeSeriesRule({ ...row, dstDisambiguation: row.dstDisambiguation as SeriesRuleDto['dstDisambiguation'], teacherLinkIds: row.teachers.map(t => t.courseTeacherId), participantEnrollmentIds: row.participants.map(p => p.enrollmentId) });
export const seriesDto = (row: SeriesRow) => ({ id: row.id, ...ruleFor(row), status: row.status, revision: row.revision, generation: row.generation,
  materializedThrough: row.materializedThrough, failures: row.failures, lastErrorCode: row.lastErrorCode, nextRunAt: row.nextRunAt, createdAt: row.createdAt, updatedAt: row.updatedAt });

@Injectable()
export class LessonSeriesService {
  constructor(private readonly access: LearningAccessService, private readonly lessons: CourseLessonsService, private readonly learning: LearningEventsService, private readonly config: ConfigService) {}

  private scope(ctx: WorkspaceContext): Prisma.LessonSeriesWhereInput {
    if (ctx.role === 'student') throw forbidden();
    return { course: ctx.role === 'teacher' ? teacherCourses(ctx) : { workspaceId: ctx.workspaceId } };
  }
  private async find(tx: LearningTx, ctx: WorkspaceContext, id: string, lock = false) {
    const row = await tx.lessonSeries.findFirst({ where: { id, ...this.scope(ctx) }, include });
    if (!row) throw notFound();
    if (lock) await tx.$queryRaw`SELECT id FROM "LessonSeries" WHERE id=${id} FOR UPDATE`;
    return row;
  }
  async list(ctx: WorkspaceContext, query: SeriesQueryDto) {
    return this.access.transaction(ctx, async tx => {
      const where = { ...this.scope(ctx), courseId: query.courseId, status: query.status };
      const [rows, total] = await Promise.all([tx.lessonSeries.findMany({ where, include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.lessonSeries.count({ where })]);
      return { items: rows.map(seriesDto), total, page: query.page, pageSize: query.pageSize };
    });
  }
  async get(ctx: WorkspaceContext, id: string) { return this.access.transaction(ctx, async tx => ({ item: seriesDto(await this.find(tx, ctx, id)) })); }

  private sign(payload: string) { return createHmac('sha256', getJwtSecret(this.config)).update(`lesson-series:${payload}`).digest('base64url'); }
  private token(planDigest: string, asOf: Date) {
    const payload = Buffer.from(JSON.stringify({ digest: planDigest, asOf: asOf.toISOString() })).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }
  private tokenData(value: string) {
    try {
      const [payload, signature, extra] = value.split('.');
      const expected = Buffer.from(this.sign(payload));
      const supplied = Buffer.from(signature || '');
      if (extra || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error();
      const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (!parsed || typeof parsed !== 'object' || !('asOf' in parsed) || !('digest' in parsed) || typeof parsed.asOf !== 'string' || typeof parsed.digest !== 'string') throw new Error();
      const asOf = new Date(parsed.asOf);
      if (!Number.isFinite(asOf.getTime()) || asOf > new Date() || Date.now() - asOf.getTime() > 300000) throw new Error();
      return { asOf, digest: parsed.digest };
    } catch { throw learningConflict('stale_preview', 'Предпросмотр истёк или недействителен. Выполните проверку заново.'); }
  }
  private async plan(tx: LearningTx, ctx: WorkspaceContext, operation: Operation, input: SeriesRuleDto, asOf: Date, current?: SeriesRow, reason = '') {
    this.scope(ctx);
    const rule = normalizeSeriesRule(input);
    if (current && ['canceled', 'completed'].includes(current.status)) throw learningConflict('series_canceled', 'Закрытую серию нельзя возобновить. Создайте новую.');
    if (operation === 'materialize' && current?.status === 'paused') throw learningConflict('invalid_state', 'Сначала возобновите серию.');
    if (current && (operation === 'resume' && current.status !== 'paused' || operation === 'pause' && current.status !== 'active')) throw learningConflict('invalid_state', 'Статус серии уже изменился.');
    if (current && (operation === 'update' || ['pause', 'resume', 'cancel'].includes(operation)) && reason.trim().length < 5) throw validationError('Укажите причину изменения серии от 5 символов.');
    if (current && current.courseId !== rule.courseId) throw validationError('Серия не переносится в другой курс.');
    const prepared = await this.lessons.prepareSeries(tx, ctx, rule.courseId, rule.teacherLinkIds, rule.participantEnrollmentIds, ['cancel', 'pause'].includes(operation));
    const existing = current ? await tx.lesson.findMany({ where: { seriesId: current.id }, select: { id: true, revision: true, startAt: true, endAt: true, status: true, seriesRevision: true, seriesOccurrenceKey: true, seriesException: true }, orderBy: { id: 'asc' }, take: 1001 }) : [];
    if (existing.length > 1000) throw validationError('Серия превышает лимит 1000 исторических экземпляров. Создайте следующую серию.');
    const cancelLessons = existing.filter(row => row.startAt > asOf && ['planned', 'rescheduled'].includes(row.status) && (operation === 'cancel' || operation === 'update' && !row.seriesException));
    const generation = operation === 'update' ? current!.generation + 1 : current?.generation || 0;
    const preservedKeys = new Set(existing.filter(row => row.seriesException || row.status === 'completed' || row.startAt <= asOf).map(row => row.seriesOccurrenceKey));
    const generatedKeys = new Set(existing.filter(row => row.seriesRevision === generation).map(row => row.seriesOccurrenceKey));
    const expanded = expandSeries(rule, asOf);
    const generates = ['create', 'update', 'materialize', 'resume'].includes(operation) && (current?.status !== 'paused' || operation === 'resume');
    const occurrences = generates ? expanded.occurrences.filter(row => !preservedKeys.has(row.key) && !generatedKeys.has(row.key)) : [];
    const issues: (RecurrenceIssue & { conflicts?: { userId: string; kind: 'teacher' | 'student' }[] })[] = generates ? [...expanded.issues] : [];
    if (cancelLessons.length > 200) throw validationError('Изменение затрагивает более 200 будущих занятий.');
    const canceledIds = cancelLessons.map(row => row.id);
    for (const occurrence of occurrences) {
      try { this.lessons.seriesSchedule(prepared, occurrence.startAt, occurrence.endAt, rule.timezone, rule.format); }
      catch (error) { if (!(error instanceof AppError) || error.status !== 422) throw error; issues.push({ occurrenceKey: occurrence.key, code: 'outside_course_or_membership_period' }); continue; }
      const conflicts = await lessonConflicts(tx, occurrence.startAt, occurrence.endAt, prepared.selected.teacherUserIds, prepared.selected.studentUserIds, canceledIds);
      if (conflicts.length) issues.push({ occurrenceKey: occurrence.key, code: 'lesson_conflict', conflicts });
    }
    if (occurrences.some((row, index) => index > 0 && occurrences[index - 1].endAt > row.startAt)) issues.push({ occurrenceKey: '', code: 'series_self_overlap' });
    const publicPlan = { operation, canApply: !issues.length, occurrences, cancelLessons: cancelLessons.map(({ id, revision, startAt }) => ({ id, revision, startAt })),
      preservedCount: existing.length - cancelLessons.length, issues, through: expanded.through };
    const planDigest = digest({ ctx: { userId: ctx.userId, workspaceId: ctx.workspaceId, role: ctx.role }, id: current?.id || null, revision: current?.revision ?? null,
      rule, reason: reason.trim(), publicPlan, existing: existing.map(row => ({ id: row.id, revision: row.revision, status: row.status, seriesException: row.seriesException })) });
    return { ...publicPlan, digest: planDigest, rule, prepared, generation };
  }
  async preview(ctx: WorkspaceContext, input: SeriesPreviewDto, id?: string, revision?: number) {
    return this.access.transaction(ctx, async tx => {
      const current = id ? await this.find(tx, ctx, id) : undefined;
      if (current) checkRevision(current.revision, revision!);
      const asOf = new Date();
      const plan = await this.plan(tx, ctx, id ? 'update' : 'create', input, asOf, current, input.reason);
      return this.previewDto(plan, asOf);
    }, 60000);
  }
  async previewAction(ctx: WorkspaceContext, id: string, input: SeriesActionPreviewDto, revision: number) {
    return this.access.transaction(ctx, async tx => {
      const current = await this.find(tx, ctx, id);
      checkRevision(current.revision, revision);
      const asOf = new Date();
      return this.previewDto(await this.plan(tx, ctx, input.action, ruleFor(current), asOf, current, input.reason), asOf);
    }, 60000);
  }
  private previewDto(plan: Awaited<ReturnType<LessonSeriesService['plan']>>, asOf: Date) {
    return { operation: plan.operation, canApply: plan.canApply, occurrences: plan.occurrences, cancelLessons: plan.cancelLessons,
      preservedCount: plan.preservedCount, issues: plan.issues, through: plan.through, previewToken: this.token(plan.digest, asOf), expiresAt: new Date(asOf.getTime() + 300000) };
  }
  private async apply(tx: LearningTx, ctx: WorkspaceContext, plan: Awaited<ReturnType<LessonSeriesService['plan']>>, reason: string, current?: SeriesRow, worker = false) {
    if (!plan.canApply) throw learningConflict('series_conflict', 'Пакет не применён: устраните конфликты из предпросмотра.');
    const { teacherLinkIds, participantEnrollmentIds, ...fields } = plan.rule;
    const state = plan.operation === 'cancel' ? 'canceled' : plan.operation === 'pause' ? 'paused' : plan.operation === 'resume' ? 'active' : current?.status || 'active';
    const hasChanges = !worker || plan.occurrences.length > 0;
    const data = { status: state, generation: plan.generation, operatorUserId: ctx.userId, operatorRole: ctx.role,
      nextRunAt: new Date(Date.now() + 900000), failures: 0, lastErrorCode: '',
      materializedThrough: plan.operation === 'update' && current?.status === 'paused' ? null : ['pause', 'cancel'].includes(plan.operation) ? current?.materializedThrough || null : plan.through } as const;
    const row = current ? await tx.lessonSeries.update({ where: { id: current.id }, data: { ...data, ...(plan.operation === 'update' ? fields : {}), revision: { increment: hasChanges ? 1 : 0 } }, include })
      : await tx.lessonSeries.create({ data: { ...fields, ...data }, include });
    if (!current || plan.operation === 'update') {
      if (current) {
        await tx.lessonSeriesTeacher.deleteMany({ where: { seriesId: row.id } });
        await tx.lessonSeriesParticipant.deleteMany({ where: { seriesId: row.id } });
      }
      await tx.lessonSeriesTeacher.createMany({ data: teacherLinkIds.map(courseTeacherId => ({ seriesId: row.id, courseId: row.courseId, courseTeacherId })) });
      await tx.lessonSeriesParticipant.createMany({ data: participantEnrollmentIds.map(enrollmentId => ({ seriesId: row.id, courseId: row.courseId, enrollmentId })) });
    }
    for (const lesson of plan.cancelLessons) {
      if (lesson.startAt <= new Date()) throw learningConflict('stale_preview', 'Одно из занятий уже началось. Повторите предпросмотр.');
      await tx.lesson.update({ where: { id: lesson.id }, data: { status: 'canceled', revision: { increment: 1 } } });
      await this.learning.lessonChanged(tx, ctx, lesson.id, 'canceled');
      await tx.workspaceAuditEvent.create({ data: { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, targetType: 'lesson', targetId: lesson.id, action: 'lesson.series_canceled', changes: { seriesId: row.id }, reason, requestId: ctx.requestId } });
    }
    for (const occurrence of plan.occurrences) {
      const schedule = this.lessons.seriesSchedule(plan.prepared, occurrence.startAt, occurrence.endAt, plan.rule.timezone, plan.rule.format);
      await this.lessons.insertPlanned(tx, ctx, { ...plan.rule, startAt: occurrence.startAt.toISOString(), endAt: occurrence.endAt.toISOString() }, plan.prepared.selected, schedule,
        { seriesId: row.id, seriesRevision: row.generation, seriesOccurrenceKey: occurrence.key });
    }
    if (hasChanges) await tx.workspaceAuditEvent.create({ data: { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, targetType: 'lesson_series', targetId: row.id,
      action: `lesson_series.${plan.operation}`, changes: { createdCount: plan.occurrences.length, canceledCount: plan.cancelLessons.length, generation: row.generation }, reason: reason || undefined, requestId: ctx.requestId } });
    const updated = await tx.lessonSeries.findUniqueOrThrow({ where: { id: row.id }, include });
    return { item: seriesDto(updated), createdCount: plan.occurrences.length, canceledCount: plan.cancelLessons.length, changed: ['lessonSeries', 'lessons', 'notifications'], requestId: ctx.requestId };
  }
  async save(ctx: WorkspaceContext, input: SaveSeriesDto | SeriesActionDto, key: string, id?: string, revision?: number) {
    if (!key || key.length > 128) throw new AppError(400, 'missing_idempotency_key', 'Нужен Idempotency-Key длиной до 128 символов.');
    return this.access.transaction(ctx, async tx => {
      const current = id ? await this.find(tx, ctx, id, true) : undefined;
      const operation: Operation = 'action' in input ? input.action : id ? 'update' : 'create';
      this.scope(ctx);
      await this.access.target(tx, ctx, 'course', current?.courseId || (input as SaveSeriesDto).courseId);
      const identity = { actorUserId: ctx.userId, route: `series:${ctx.workspaceId}:${id || 'new'}:${operation}`, key };
      const bodyHash = digest({ input, revision });
      const prior = await tx.idempotencyRecord.findUnique({ where: { actorUserId_route_key: identity } });
      if (prior && prior.expiresAt > new Date()) {
        if (prior.bodyHash !== bodyHash) throw learningConflict('idempotency_conflict', 'Ключ уже использован с другим запросом.');
        return prior.response;
      }
      if (prior) await tx.idempotencyRecord.delete({ where: { id: prior.id } });
      if (current) checkRevision(current.revision, revision!);
      const token = this.tokenData(input.previewToken);
      const rule = 'action' in input ? ruleFor(current!) : input;
      const selected = await this.lessons.prepareSeries(tx, ctx, rule.courseId, rule.teacherLinkIds, rule.participantEnrollmentIds, ['cancel', 'pause'].includes(operation));
      const oldPeople = current ? await tx.lesson.findMany({
        where: { seriesId: current.id, startAt: { gt: token.asOf }, status: { in: ['planned', 'rescheduled'] } },
        select: {
          lessonTeachers: { select: { courseTeacher: { select: { membership: { select: { userId: true } } } } } },
          participants: { select: { enrollment: { select: { membership: { select: { userId: true } } } } } },
        },
      }) : [];
      await lockLessonPeople(tx, [...selected.selected.teacherUserIds, ...selected.selected.studentUserIds, ...oldPeople.flatMap(l => [...l.lessonTeachers.map(t => t.courseTeacher.membership.userId), ...l.participants.map(p => p.enrollment.membership.userId)])]);
      const plan = await this.plan(tx, ctx, operation, rule, token.asOf, current, input.reason);
      if (plan.digest !== token.digest) throw learningConflict('stale_preview', 'Расписание изменилось после предпросмотра. Проверьте пакет заново.');
      const result = await this.apply(tx, ctx, plan, input.reason?.trim() || '', current);
      await tx.idempotencyRecord.create({ data: { ...identity, bodyHash, response: json(result), expiresAt: new Date(Date.now() + 86400000) } });
      return result;
    }, 60000);
  }
  async materializeWorker(id: string) {
    const row = await this.access.prisma.lessonSeries.findUnique({ where: { id } });
    if (!row || row.status !== 'active' || row.nextRunAt > new Date()) return 0;
    const ctx: WorkspaceContext = { userId: row.operatorUserId, workspaceId: '', role: row.operatorRole, sessionId: '', requestId: `series-worker:${id}` };
    const course = await this.access.prisma.course.findUniqueOrThrow({ where: { id: row.courseId } });
    ctx.workspaceId = course.workspaceId;
    if (seriesHasEnded(row)) {
      await this.access.prisma.$transaction(async tx => {
        const result = await tx.lessonSeries.updateMany({ where: { id, status: 'active', revision: row.revision }, data: { status: 'completed', revision: { increment: 1 }, lastErrorCode: '', failures: 0 } });
        if (result.count) await tx.workspaceAuditEvent.create({ data: { workspaceId: ctx.workspaceId, actorKind: 'system', action: 'lesson_series.finished', targetType: 'lesson_series', targetId: id, changes: {}, requestId: ctx.requestId } });
      });
      return 0;
    }
    try {
      return await this.access.transaction(ctx, async tx => {
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "LessonSeries" WHERE id=${id} AND status='active' AND "nextRunAt"<=NOW() FOR UPDATE SKIP LOCKED`;
        if (!locked.length) return 0;
        const current = await this.find(tx, ctx, id);
        const rule = ruleFor(current);
        const selected = await this.lessons.prepareSeries(tx, ctx, rule.courseId, rule.teacherLinkIds, rule.participantEnrollmentIds);
        await lockLessonPeople(tx, [...selected.selected.teacherUserIds, ...selected.selected.studentUserIds]);
        const plan = await this.plan(tx, ctx, 'materialize', rule, new Date(), current);
        return (await this.apply(tx, ctx, plan, 'Плановое продление горизонта', current, true)).createdCount;
      }, 60000);
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'materialization_failed';
      await this.access.prisma.lessonSeries.updateMany({ where: { id, revision: row.revision, nextRunAt: { lte: new Date() } }, data: { failures: { increment: 1 }, lastErrorCode: code,
        nextRunAt: new Date(Date.now() + Math.min(3600000, 60000 * 2 ** Math.min(row.failures, 6))), ...(row.failures >= 4 ? { status: 'paused', revision: { increment: 1 } } : {}) } });
      return 0;
    }
  }
}
