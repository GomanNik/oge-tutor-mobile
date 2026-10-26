import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CourseFormat, Prisma } from '@prisma/client';
import { AppError, forbidden, notFound, validationError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceContext } from '../workspace/workspace-context.service';
import { CancelCourseLessonDto, CompleteCourseLessonDto, CorrectLessonAttendanceDto, CreateCourseLessonDto, LessonCalendarQueryDto, UpdateCourseLessonDto } from './course-lessons.dto';
import { lessonConflicts, lockLessonPeople } from './lesson-schedule';
import { LearningEventsService } from '../learning/learning-events.service';

const lessonInclude = {
  course: { select: { title: true, workspaceId: true, legacyMapping: true } },
  lessonTeachers: {
    include: { courseTeacher: { include: { membership: { include: { user: true } } } } },
  },
  participants: {
    include: { enrollment: { include: { membership: { include: { user: true } } } } },
  },
} satisfies Prisma.LessonInclude;
type LessonRow = Prisma.LessonGetPayload<{ include: typeof lessonInclude }>;
type Tx = Prisma.TransactionClient;
const revisionError = () => new AppError(412, 'revision_mismatch', 'Запись изменилась. Обновите страницу.');
const conflict = (code: string, message: string) => new AppError(409, code, message);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const asDate = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw validationError('Некорректное время занятия.');
  return parsed;
};
const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const localDay = (value: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};

function dto(row: LessonRow, ctx: WorkspaceContext) {
  const isStudent = ctx.role === 'student';
  const participants = isStudent
    ? row.participants.filter(item => item.enrollment.membership.userId === ctx.userId)
    : row.participants;
  return {
    id: row.id, courseId: row.courseId, courseTitle: row.course.title,
    topic: row.topic, startAt: row.startAt, endAt: row.endAt, timezone: row.timezone,
    format: row.format, status: row.status, revision: row.revision,
    completedAt: row.completedAt, legacy: Boolean(row.course.legacyMapping),
    ...(isStudent ? {} : { note: row.note, completionComment: row.completionComment }),
    teachers: row.lessonTeachers.map(link => ({
      courseTeacherId: link.courseTeacherId, userId: link.courseTeacher.membership.userId,
      displayName: link.courseTeacher.membership.displayNameOverride || link.courseTeacher.membership.user.displayName,
      role: link.courseTeacher.role,
    })),
    participants: participants.map(link => ({
      enrollmentId: link.enrollmentId,
      ...(isStudent ? {} : {
        userId: link.enrollment.membership.userId,
        displayName: link.enrollment.membership.displayNameOverride || link.enrollment.membership.user.displayName,
      }),
      responseStatus: link.responseStatus, attendance: link.attendance,
    })),
  };
}

@Injectable()
export class CourseLessonsService {
  constructor(private readonly prisma: PrismaService, private readonly learning: LearningEventsService) {}

  private scope(ctx: WorkspaceContext): Prisma.LessonWhereInput {
    const course: Prisma.CourseWhereInput = { workspaceId: ctx.workspaceId };
    if (ctx.role === 'teacher') course.teachers = { some: { status: 'active', membership: { userId: ctx.userId } } };
    if (ctx.role === 'student') return { course, participants: { some: { enrollment: { membership: { userId: ctx.userId }, status: { in: ['active', 'paused', 'completed'] } } } } };
    return { course };
  }

  private async visible(ctx: WorkspaceContext, id: string) {
    const lesson = await this.prisma.lesson.findFirst({ where: { ...this.scope(ctx), id }, include: lessonInclude });
    if (!lesson) throw notFound();
    return lesson;
  }

  async list(ctx: WorkspaceContext, query: LessonCalendarQueryDto) {
    if (ctx.role !== 'admin' && (query.teacherUserId || query.studentUserId)) throw forbidden();
    const from = asDate(query.from);
    const to = asDate(query.to);
    if (to <= from || to.getTime() - from.getTime() > 90 * 86400000) throw validationError('Диапазон календаря должен быть от 1 до 90 дней.');
    const where: Prisma.LessonWhereInput = {
      ...this.scope(ctx), startAt: { lt: to }, endAt: { gt: from }, courseId: query.courseId,
      ...(query.teacherUserId ? {
        lessonTeachers: { some: { courseTeacher: { membership: { userId: query.teacherUserId } } } },
      } : {}),
      ...(query.studentUserId ? {
        participants: { some: { enrollment: { membership: { userId: query.studentUserId } } } },
      } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.lesson.findMany({ where, include: lessonInclude, orderBy: [{ startAt: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.lesson.count({ where }),
    ]);
    return { items: rows.map(row => dto(row, ctx)), total, page: query.page, pageSize: query.pageSize };
  }

  async get(ctx: WorkspaceContext, id: string) { return { item: dto(await this.visible(ctx, id), ctx) }; }

  private async editor(tx: Tx, ctx: WorkspaceContext, courseId: string) {
    if (ctx.role === 'student') throw forbidden();
    const member = await tx.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: ctx.userId } },
      include: { workspace: true, roles: true },
    });
    if (member?.status !== 'active' || member.workspace.status !== 'active'
      || !member.roles.some(role => role.role === ctx.role && !role.revokedAt)) throw forbidden();
    if (ctx.role === 'teacher') {
      const assignment = await tx.courseTeacher.findFirst({ where: { courseId, status: 'active', membershipId: member.id } });
      if (!assignment) throw forbidden();
    }
  }

  private async courseFor(tx: Tx, ctx: WorkspaceContext, id: string) {
    const course = await tx.course.findFirst({ where: { id, workspaceId: ctx.workspaceId }, include: { legacyMapping: true } });
    if (!course) throw notFound();
    if (course.legacyMapping) throw conflict('legacy_course_read_only', 'Исторические занятия пока редактируются в прежнем кабинете.');
    if (course.status !== 'active') throw conflict('course_not_active', 'Для планирования нужен активный курс.');
    await this.editor(tx, ctx, id);
    return course;
  }

  private async selection(tx: Tx, courseId: string, teacherLinkIds: string[], participantEnrollmentIds: string[]) {
    const [teachers, enrollments] = await Promise.all([
      tx.courseTeacher.findMany({ where: { id: { in: teacherLinkIds }, courseId, status: 'active' }, include: { membership: { include: { roles: true } } } }),
      tx.enrollment.findMany({ where: { id: { in: participantEnrollmentIds }, courseId, status: 'active' }, include: { membership: { include: { roles: true } } } }),
    ]);
    if (teachers.length !== teacherLinkIds.length || teachers.some(row => row.membership.status !== 'active' || !row.membership.roles.some(role => role.role === 'teacher' && !role.revokedAt)))
      throw validationError('Выберите действующих преподавателей этого курса.', { teacherLinkIds: 'inactive_or_foreign' });
    if (enrollments.length !== participantEnrollmentIds.length || enrollments.some(row => row.membership.status !== 'active' || !row.membership.roles.some(role => role.role === 'student' && !role.revokedAt)))
      throw validationError('Выберите действующих учеников этого курса.', { participantEnrollmentIds: 'inactive_or_foreign' });
    return { teachers, enrollments, teacherUserIds: teachers.map(row => row.membership.userId), studentUserIds: enrollments.map(row => row.membership.userId) };
  }

  private schedule(course: { startsOn: Date; endsOn: Date | null; timezone: string; defaultFormat: CourseFormat }, startAtInput: string, endAtInput: string, timezone: string, format?: CourseFormat, count?: number) {
    try { new Intl.DateTimeFormat('en', { timeZone: timezone }); }
    catch { throw validationError('Укажите существующий часовой пояс IANA.', { timezone: 'invalid' }); }
    const startAt = asDate(startAtInput);
    const endAt = asDate(endAtInput);
    const duration = (endAt.getTime() - startAt.getTime()) / 60000;
    if (duration < 15 || duration > 480 || !Number.isInteger(duration)) throw validationError('Продолжительность занятия должна быть от 15 минут до 8 часов.');
    if (startAt.getTime() <= Date.now()) throw validationError('Планировать или переносить можно только будущий урок.');
    const startDay = localDay(startAt, course.timezone);
    const endDay = localDay(new Date(endAt.getTime() - 1), course.timezone);
    if (startDay < dateOnly(course.startsOn) || (course.endsOn && endDay > dateOnly(course.endsOn)))
      throw validationError('Занятие выходит за период курса.');
    const chosenFormat = format || course.defaultFormat;
    if (course.defaultFormat === 'individual' && (chosenFormat !== 'individual' || count !== 1)) throw validationError('Индивидуальный курс допускает одного участника.');
    if (chosenFormat === 'individual' && count !== 1) throw validationError('Индивидуальное занятие допускает одного участника.');
    return { startAt, endAt, durationMinutes: duration, format: chosenFormat };
  }

  private activeAtLesson(selected: Awaited<ReturnType<CourseLessonsService['selection']>>, startAt: Date, endAt: Date, timezone: string) {
    const first = localDay(startAt, timezone);
    const last = localDay(new Date(endAt.getTime() - 1), timezone);
    if (selected.teachers.some(link => first < dateOnly(link.startsOn) || (link.endsOn && last > dateOnly(link.endsOn))))
      throw validationError('Назначение преподавателя не покрывает дату занятия.', { teacherLinkIds: 'outside_assignment' });
    if (selected.enrollments.some(link => (link.startsOn && first < dateOnly(link.startsOn)) || (link.endsOn && last > dateOnly(link.endsOn))))
      throw validationError('Зачисление ученика не покрывает дату занятия.', { participantEnrollmentIds: 'outside_enrollment' });
  }

  private async mutate<T>(action: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.prisma.$transaction(action, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
          continue;
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') throw conflict('concurrent_update', 'Параллельное изменение расписания. Повторите запрос.');
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('duplicate_link', 'Запись уже существует.');
        throw error;
      }
    }
  }

  private async audit(tx: Tx, ctx: WorkspaceContext, id: string, action: string, changes: Prisma.InputJsonValue) {
    await tx.workspaceAuditEvent.create({ data: { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, targetType: 'lesson', targetId: id, action, changes, requestId: ctx.requestId } });
  }

  async preview(ctx: WorkspaceContext, body: CreateCourseLessonDto) {
    return this.prisma.$transaction(async tx => {
      const course = await this.courseFor(tx, ctx, body.courseId);
      const selected = await this.selection(tx, course.id, body.teacherLinkIds, body.participantEnrollmentIds);
      const schedule = this.schedule(course, body.startAt, body.endAt, body.timezone, body.format, selected.enrollments.length);
      this.activeAtLesson(selected, schedule.startAt, schedule.endAt, course.timezone);
      const conflicts = await lessonConflicts(tx, schedule.startAt, schedule.endAt, selected.teacherUserIds, selected.studentUserIds);
      return { canCreate: conflicts.length === 0, conflicts, participantCount: selected.enrollments.length, teacherCount: selected.teachers.length };
    });
  }

  async create(ctx: WorkspaceContext, body: CreateCourseLessonDto, key: string) {
    if (!key || key.length > 128) throw new AppError(400, 'missing_idempotency_key', 'Нужен Idempotency-Key длиной до 128 символов.');
    const identity = { actorUserId: ctx.userId, route: `lessons:${ctx.workspaceId}`, key };
    const bodyHash = hash(body);
    try {
      return await this.mutate(async tx => {
        const prior = await tx.idempotencyRecord.findUnique({ where: { actorUserId_route_key: identity } });
        if (prior && prior.expiresAt > new Date()) {
          if (prior.bodyHash !== bodyHash) throw conflict('idempotency_conflict', 'Ключ уже использован с другим телом.');
          return prior.response as unknown as { item: ReturnType<typeof dto>; changed: string[]; requestId: string };
        }
        if (prior) await tx.idempotencyRecord.delete({ where: { id: prior.id } });
        const course = await this.courseFor(tx, ctx, body.courseId);
        const selected = await this.selection(tx, course.id, body.teacherLinkIds, body.participantEnrollmentIds);
        await lockLessonPeople(tx, [...selected.teacherUserIds, ...selected.studentUserIds]);
        const schedule = this.schedule(course, body.startAt, body.endAt, body.timezone, body.format, selected.enrollments.length);
        this.activeAtLesson(selected, schedule.startAt, schedule.endAt, course.timezone);
        if ((await lessonConflicts(tx, schedule.startAt, schedule.endAt, selected.teacherUserIds, selected.studentUserIds)).length)
          throw conflict('lesson_conflict', 'У одного из участников уже есть занятие в это время.');
        const row = await tx.lesson.create({ data: {
          courseId: course.id, topic: body.topic.trim(), startAt: schedule.startAt, endAt: schedule.endAt,
          timezone: body.timezone, durationMinutes: schedule.durationMinutes, format: schedule.format,
          note: body.note?.trim() || '', source: 'manual', status: 'planned',
        } });
        await tx.lessonTeacher.createMany({ data: selected.teachers.map(link => ({ lessonId: row.id, courseId: course.id, courseTeacherId: link.id })) });
        await tx.lessonParticipant.createMany({ data: selected.enrollments.map(link => ({ lessonId: row.id, courseId: course.id, enrollmentId: link.id })) });
        await this.audit(tx, ctx, row.id, 'lesson.created', { courseId: course.id, teacherCount: selected.teachers.length, participantCount: selected.enrollments.length });
        await this.learning.lessonChanged(tx, ctx, row.id, 'created');
        const result = { item: dto(await tx.lesson.findUniqueOrThrow({ where: { id: row.id }, include: lessonInclude }), ctx), changed: ['lessons'], requestId: ctx.requestId };
        await tx.idempotencyRecord.create({ data: { ...identity, bodyHash, response: result as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + 86400000) } });
        return result;
      });
    } catch (error) {
      if (error instanceof AppError && ['concurrent_update', 'duplicate_link'].includes(error.code)) {
        const prior = await this.prisma.idempotencyRecord.findUnique({ where: { actorUserId_route_key: identity } });
        if (prior?.bodyHash === bodyHash && prior.expiresAt > new Date()) return prior.response as unknown as { item: ReturnType<typeof dto>; changed: string[]; requestId: string };
      }
      throw error;
    }
  }

  private async editableLesson(tx: Tx, ctx: WorkspaceContext, id: string) {
    const row = await tx.lesson.findFirst({ where: { id, course: { workspaceId: ctx.workspaceId } }, include: lessonInclude });
    if (!row) throw notFound();
    if (row.course.legacyMapping) throw conflict('legacy_lesson_read_only', 'Исторический урок редактируется в прежнем кабинете.');
    await this.editor(tx, ctx, row.courseId);
    return row;
  }

  async update(ctx: WorkspaceContext, id: string, body: UpdateCourseLessonDto, revision: number) {
    if (!Object.values(body).some(value => value !== undefined)) throw validationError('Нет изменений.');
    return this.mutate(async tx => {
      const current = await this.editableLesson(tx, ctx, id);
      if (current.revision !== revision) throw revisionError();
      if (!['planned', 'rescheduled'].includes(current.status)) throw conflict('invalid_state', 'Проведённый или отменённый урок нельзя менять.');
      const course = await this.courseFor(tx, ctx, current.courseId);
      const teacherLinkIds = body.teacherLinkIds || current.lessonTeachers.map(link => link.courseTeacherId);
      const participantEnrollmentIds = body.participantEnrollmentIds || current.participants.map(link => link.enrollmentId);
      const selected = await this.selection(tx, course.id, teacherLinkIds, participantEnrollmentIds);
      const oldUsers = [
        ...current.lessonTeachers.map(link => link.courseTeacher.membership.userId),
        ...current.participants.map(link => link.enrollment.membership.userId),
      ];
      await lockLessonPeople(tx, [...oldUsers, ...selected.teacherUserIds, ...selected.studentUserIds]);
      const schedule = this.schedule(course, body.startAt || current.startAt.toISOString(), body.endAt || current.endAt.toISOString(), body.timezone || current.timezone, body.format || current.format, selected.enrollments.length);
      this.activeAtLesson(selected, schedule.startAt, schedule.endAt, course.timezone);
      if ((await lessonConflicts(tx, schedule.startAt, schedule.endAt, selected.teacherUserIds, selected.studentUserIds, id)).length)
        throw conflict('lesson_conflict', 'У одного из участников уже есть занятие в это время.');
      const changed = await tx.lesson.updateMany({ where: { id, revision }, data: {
        topic: body.topic?.trim(), startAt: schedule.startAt, endAt: schedule.endAt,
        timezone: body.timezone, durationMinutes: schedule.durationMinutes, format: schedule.format,
        note: body.note?.trim(), status: body.startAt || body.endAt ? 'rescheduled' : undefined,
        revision: { increment: 1 },
      } });
      if (!changed.count) throw revisionError();
      if (body.teacherLinkIds) {
        await tx.lessonTeacher.deleteMany({ where: { lessonId: id } });
        await tx.lessonTeacher.createMany({ data: selected.teachers.map(link => ({ lessonId: id, courseId: course.id, courseTeacherId: link.id })) });
      }
      if (body.participantEnrollmentIds) {
        await tx.lessonParticipant.deleteMany({ where: { lessonId: id } });
        await tx.lessonParticipant.createMany({ data: selected.enrollments.map(link => ({ lessonId: id, courseId: course.id, enrollmentId: link.id })) });
      }
      await this.audit(tx, ctx, id, 'lesson.updated', { courseId: course.id, participantCount: selected.enrollments.length, teacherCount: selected.teachers.length });
      await this.learning.lessonChanged(tx, ctx, id, 'updated', [...new Set([...current.participants.map(p => p.enrollmentId), ...participantEnrollmentIds])], '', current.lessonTeachers.map(t => t.courseTeacher.membership.userId));
      return { item: dto(await tx.lesson.findUniqueOrThrow({ where: { id }, include: lessonInclude }), ctx), changed: ['lessons'], requestId: ctx.requestId };
    });
  }

  async cancel(ctx: WorkspaceContext, id: string, body: CancelCourseLessonDto, revision: number) {
    return this.mutate(async tx => {
      const current = await this.editableLesson(tx, ctx, id);
      if (current.revision !== revision) throw revisionError();
      if (!['planned', 'rescheduled'].includes(current.status)) throw conflict('invalid_state', 'Урок уже завершён или отменён.');
      const changed = await tx.lesson.updateMany({ where: { id, revision }, data: { status: 'canceled', revision: { increment: 1 } } });
      if (!changed.count) throw revisionError();
      await this.audit(tx, ctx, id, 'lesson.canceled', { reason: body.reason.trim() });
      await this.learning.lessonChanged(tx, ctx, id, 'canceled');
      return { item: dto(await tx.lesson.findUniqueOrThrow({ where: { id }, include: lessonInclude }), ctx), changed: ['lessons'], requestId: ctx.requestId };
    });
  }

  async complete(ctx: WorkspaceContext, id: string, body: CompleteCourseLessonDto, revision: number) {
    return this.mutate(async tx => {
      const current = await this.editableLesson(tx, ctx, id);
      if (current.revision !== revision) throw revisionError();
      if (!['planned', 'rescheduled'].includes(current.status)) throw conflict('invalid_state', 'Урок уже завершён или отменён.');
      if (current.startAt > new Date()) throw validationError('Будущий урок нельзя отметить проведённым.');
      const selected = new Set(current.participants.map(link => link.enrollmentId));
      if (body.attendance.length !== selected.size || body.attendance.some(item => !selected.has(item.enrollmentId)))
        throw validationError('Отметьте посещаемость каждого приглашённого ученика.', { attendance: 'incomplete' });
      const now = new Date();
      for (const item of body.attendance) {
        await tx.lessonParticipant.update({ where: { lessonId_enrollmentId: { lessonId: id, enrollmentId: item.enrollmentId } }, data: {
          attendance: item.attendance, attendanceMarkedAt: now, attendanceMarkedByUserId: ctx.userId,
        } });
      }
      const changed = await tx.lesson.updateMany({ where: { id, revision }, data: {
        status: 'completed', completedAt: now, completionComment: body.completionComment?.trim() || '', revision: { increment: 1 },
      } });
      if (!changed.count) throw revisionError();
      await this.audit(tx, ctx, id, 'lesson.completed', { attendance: body.attendance.map(item => ({ enrollmentId: item.enrollmentId, attendance: item.attendance })) });
      await this.learning.lessonChanged(tx, ctx, id, 'completed');
      return { item: dto(await tx.lesson.findUniqueOrThrow({ where: { id }, include: lessonInclude }), ctx), changed: ['lessons'], requestId: ctx.requestId };
    });
  }

  async correctAttendance(ctx: WorkspaceContext, id: string, body: CorrectLessonAttendanceDto, revision: number) {
    return this.mutate(async tx => {
      const current = await this.editableLesson(tx, ctx, id);
      if (current.revision !== revision) throw revisionError();
      if (current.status !== 'completed') throw conflict('invalid_state', 'Исправление доступно только после завершения урока.');
      const participant = current.participants.find(item => item.enrollmentId === body.enrollmentId);
      if (!participant) throw notFound();
      await tx.lessonParticipant.update({ where: { id: participant.id }, data: {
        attendance: body.attendance, attendanceMarkedAt: new Date(), attendanceMarkedByUserId: ctx.userId,
      } });
      const changed = await tx.lesson.updateMany({ where: { id, revision }, data: { revision: { increment: 1 } } });
      if (!changed.count) throw revisionError();
      await this.audit(tx, ctx, id, 'lesson.attendance_corrected', { enrollmentId: body.enrollmentId, from: participant.attendance, to: body.attendance, reason: body.reason.trim() });
      await this.learning.lessonChanged(tx, ctx, id, 'attendance_corrected', [body.enrollmentId], body.reason.trim());
      return { item: dto(await tx.lesson.findUniqueOrThrow({ where: { id }, include: lessonInclude }), ctx), changed: ['lessons'], requestId: ctx.requestId };
    });
  }
}
