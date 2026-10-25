import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CourseStatus, EnrollmentStatus, Prisma } from '@prisma/client';
import { AppError, forbidden, notFound, validationError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceContext, WorkspaceContextService } from '../workspace/workspace-context.service';
import { AddCourseTeacherDto, CourseQueryDto, CreateCourseDto, CreateEnrollmentDto, EnrollmentBatchDto, UpdateCourseDto, UpdateCourseTeacherDto, UpdateEnrollmentDto } from './courses.dto';

const courseInclude = {
  programVersion: { include: { program: { include: { subject: true } } } },
  legacyMapping: true,
  _count: { select: { enrollments: { where: { status: { in: ['active', 'paused'] as EnrollmentStatus[] } } } } },
} satisfies Prisma.CourseInclude;
type CourseRow = Prisma.CourseGetPayload<{ include: typeof courseInclude }>;

const teacherInclude = { membership: { include: { user: true } } } satisfies Prisma.CourseTeacherInclude;
type TeacherRow = Prisma.CourseTeacherGetPayload<{ include: typeof teacherInclude }>;
const enrollmentInclude = { membership: { include: { user: true } } } satisfies Prisma.EnrollmentInclude;
type EnrollmentRow = Prisma.EnrollmentGetPayload<{ include: typeof enrollmentInclude }>;

const revisionError = () => new AppError(412, 'revision_mismatch', 'Запись изменилась. Обновите страницу.');
const conflict = (code: string, message: string) => new AppError(409, code, message);
const day = (value: Date) => value.toISOString().slice(0, 10);
const dayInZone = (value: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};
const today = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
const date = (value: string) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || day(parsed) !== value) throw validationError('Некорректная календарная дата.');
  return parsed;
};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function courseDto(row: CourseRow, role: WorkspaceContext['role']) {
  return {
    id: row.id, workspaceId: row.workspaceId, programVersionId: row.programVersionId,
    program: {
      id: row.programVersion.program.id, name: row.programVersion.program.name,
      examType: row.programVersion.program.examType, variant: row.programVersion.program.variant,
      subjectId: row.programVersion.program.subjectId, subjectName: row.programVersion.program.subject.name,
      period: row.programVersion.period, revisionNumber: row.programVersion.revisionNumber,
    },
    title: row.title, defaultFormat: row.defaultFormat, capacity: row.capacity,
    startsOn: day(row.startsOn), endsOn: row.endsOn ? day(row.endsOn) : null,
    timezone: row.timezone, status: row.status, revision: row.revision,
    activeEnrollmentCount: role === 'student' ? null : row._count.enrollments, legacy: Boolean(row.legacyMapping),
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function teacherDto(row: TeacherRow) {
  return {
    id: row.id, teacherUserId: row.membership.userId,
    displayName: row.membership.displayNameOverride || row.membership.user.displayName,
    role: row.role, status: row.status, startsOn: day(row.startsOn),
    endsOn: row.endsOn ? day(row.endsOn) : null, revision: row.revision,
  };
}

function enrollmentDto(row: EnrollmentRow, role: WorkspaceContext['role']) {
  return {
    id: row.id, studentUserId: row.membership.userId,
    displayName: row.membership.displayNameOverride || row.membership.user.displayName,
    status: row.status, startsOn: row.startsOn ? day(row.startsOn) : null,
    endsOn: row.endsOn ? day(row.endsOn) : null, goal: row.goal,
    ...(role === 'student' ? {} : { note: row.note }), revision: row.revision,
  };
}

@Injectable()
export class CoursesService {
  constructor(private readonly prisma: PrismaService, private readonly contexts: WorkspaceContextService) {}

  private scope(ctx: WorkspaceContext): Prisma.CourseWhereInput {
    if (ctx.role === 'admin') return { workspaceId: ctx.workspaceId };
    if (ctx.role === 'teacher') return { workspaceId: ctx.workspaceId, teachers: { some: { status: 'active', membership: { userId: ctx.userId } } } };
    return { workspaceId: ctx.workspaceId, enrollments: { some: { membership: { userId: ctx.userId }, status: { in: ['active', 'paused', 'completed'] } } } };
  }

  private async visible(ctx: WorkspaceContext, courseId: string) {
    const row = await this.prisma.course.findFirst({ where: { ...this.scope(ctx), id: courseId }, include: courseInclude });
    if (!row) throw notFound();
    return row;
  }

  private async adminInTx(tx: Prisma.TransactionClient, ctx: WorkspaceContext) {
    this.contexts.requireAdmin(ctx);
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${ctx.workspaceId} FOR UPDATE`;
    const member = await tx.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: ctx.userId } },
      include: { workspace: true, roles: true },
    });
    if (member?.status !== 'active' || member.workspace.status !== 'active' || !member.roles.some(grant => grant.role === 'admin' && !grant.revokedAt)) throw forbidden();
  }

  private async mutate<T>(ctx: WorkspaceContext, action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    this.contexts.requireAdmin(ctx);
    try {
      return await this.prisma.$transaction(async tx => {
        await this.adminInTx(tx, ctx);
        return action(tx);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') throw conflict('concurrent_update', 'Параллельное изменение. Повторите запрос.');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('duplicate_link', 'Такая связь уже существует.');
      throw error;
    }
  }

  private async once<T>(ctx: WorkspaceContext, route: string, key: string, body: unknown, action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (!key || key.length > 128) throw new AppError(400, 'missing_idempotency_key', 'Нужен Idempotency-Key длиной до 128 символов.');
    const bodyHash = hash(body);
    const identity = { actorUserId: ctx.userId, route, key };
    try {
      return await this.mutate(ctx, async tx => {
        const prior = await tx.idempotencyRecord.findUnique({ where: { actorUserId_route_key: identity } });
        if (prior) {
          if (prior.expiresAt > new Date()) {
            if (prior.bodyHash !== bodyHash) throw conflict('idempotency_conflict', 'Ключ уже использован с другим телом.');
            return prior.response as T;
          }
          await tx.idempotencyRecord.delete({ where: { id: prior.id } });
        }
        const result = await action(tx);
        await tx.idempotencyRecord.create({ data: { ...identity, bodyHash, response: result as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + 86400000) } });
        return result;
      });
    } catch (error) {
      if (error instanceof AppError && ['concurrent_update', 'duplicate_link'].includes(error.code)) {
        const prior = await this.prisma.idempotencyRecord.findUnique({ where: { actorUserId_route_key: identity } });
        if (prior?.bodyHash === bodyHash && prior.expiresAt > new Date()) return prior.response as T;
      }
      throw error;
    }
  }

  private async audit(tx: Prisma.TransactionClient, ctx: WorkspaceContext, targetType: string, targetId: string, action: string, changes: Prisma.InputJsonValue) {
    await tx.workspaceAuditEvent.create({ data: {
      workspaceId: ctx.workspaceId, actorUserId: ctx.userId, targetType, targetId, action,
      changes, requestId: ctx.requestId,
    } });
  }

  private async editable(tx: Prisma.TransactionClient, ctx: WorkspaceContext, id: string) {
    const course = await tx.course.findFirst({ where: { id, workspaceId: ctx.workspaceId }, include: { legacyMapping: true } });
    if (!course) throw notFound();
    if (course.legacyMapping) throw conflict('legacy_course_read_only', 'Исторический курс редактируется в прежнем кабинете до переноса занятий и работ.');
    return course;
  }

  private async activeMember(tx: Prisma.TransactionClient, ctx: WorkspaceContext, userId: string, role: 'teacher' | 'student') {
    const member = await tx.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId } }, include: { roles: true },
    });
    if (member?.status !== 'active' || !member.roles.some(grant => grant.role === role && !grant.revokedAt)) throw validationError(`Выберите активного участника с ролью «${role === 'teacher' ? 'преподаватель' : 'ученик'}».`);
    return member;
  }

  private async hasSeat(tx: Prisma.TransactionClient, courseId: string, capacity: number) {
    const reserved = await tx.enrollment.count({ where: { courseId, status: { in: ['active', 'paused'] } } });
    if (reserved >= capacity) throw conflict('course_full', 'В курсе нет свободных мест.');
  }

  async list(ctx: WorkspaceContext, query: CourseQueryDto) {
    if (ctx.role !== 'admin' && (query.teacherUserId || query.studentUserId)) throw forbidden();
    const where: Prisma.CourseWhereInput = {
      ...this.scope(ctx), status: query.status, defaultFormat: query.format, programVersionId: query.programVersionId,
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.teacherUserId ? { teachers: { some: { status: 'active', membership: { userId: query.teacherUserId } } } } : {}),
      ...(query.studentUserId ? { enrollments: { some: { membership: { userId: query.studentUserId }, status: { in: ['active', 'paused', 'completed'] } } } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.course.findMany({ where, include: courseInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.course.count({ where }),
    ]);
    return { items: rows.map(row => courseDto(row, ctx.role)), total, page: query.page, pageSize: query.pageSize };
  }

  async get(ctx: WorkspaceContext, id: string) { return { item: courseDto(await this.visible(ctx, id), ctx.role) }; }

  async create(ctx: WorkspaceContext, body: CreateCourseDto, key: string) {
    return this.once(ctx, `courses:${ctx.workspaceId}`, key, body, async tx => {
      const startsOn = date(body.startsOn);
      const endsOn = date(body.endsOn);
      if (endsOn < startsOn) throw validationError('Дата окончания раньше начала.');
      if (body.defaultFormat === 'individual' && body.capacity !== 1) throw validationError('Индивидуальный курс рассчитан на одного ученика.');
      try { new Intl.DateTimeFormat('ru', { timeZone: body.timezone }); }
      catch { throw validationError('Укажите существующий часовой пояс IANA.'); }
      const version = await tx.programVersion.findUnique({ where: { id: body.programVersionId }, include: { program: { include: { subject: true } } } });
      if (!version || version.status !== 'published' || version.program.status !== 'active' || version.program.subject.status !== 'active'
        || (version.program.workspaceId && version.program.workspaceId !== ctx.workspaceId)) throw validationError('Опубликованная версия программы недоступна.');
      const lead = await this.activeMember(tx, ctx, body.leadTeacherUserId, 'teacher');
      const course = await tx.course.create({ data: {
        workspaceId: ctx.workspaceId, programVersionId: version.id, title: body.title.trim(),
        defaultFormat: body.defaultFormat, capacity: body.capacity, startsOn, endsOn, timezone: body.timezone,
      } });
      await tx.courseTeacher.create({ data: { workspaceId: ctx.workspaceId, courseId: course.id, membershipId: lead.id, role: 'lead', startsOn } });
      await this.audit(tx, ctx, 'course', course.id, 'course.created', { programVersionId: version.id, leadTeacherUserId: body.leadTeacherUserId });
      return { item: courseDto(await tx.course.findUniqueOrThrow({ where: { id: course.id }, include: courseInclude }), ctx.role), changed: ['courses'], requestId: ctx.requestId };
    });
  }

  async update(ctx: WorkspaceContext, id: string, body: UpdateCourseDto, revision: number) {
    return this.mutate(ctx, async tx => {
      const course = await this.editable(tx, ctx, id);
      if (course.revision !== revision) throw revisionError();
      if (course.status === 'archived' || course.status === 'completed') throw conflict('invalid_state', 'Завершённый курс нельзя редактировать.');
      if (body.title === undefined && body.capacity === undefined && body.endsOn === undefined) throw validationError('Нет изменений.');
      if (body.capacity !== undefined) {
        if (course.defaultFormat === 'individual' && body.capacity !== 1) throw validationError('Индивидуальный курс рассчитан на одного ученика.');
        const reserved = await tx.enrollment.count({ where: { courseId: id, status: { in: ['active', 'paused'] } } });
        if (body.capacity < reserved) throw conflict('capacity_below_enrollment', 'Вместимость меньше числа действующих зачислений.');
      }
      const endsOn = body.endsOn ? date(body.endsOn) : undefined;
      if (endsOn && endsOn < course.startsOn) throw validationError('Дата окончания раньше начала.');
      if (endsOn) {
        const latest = await tx.lesson.findFirst({
          where: { courseId: id, status: { in: ['planned', 'rescheduled', 'completed'] } },
          orderBy: { endAt: 'desc' }, select: { endAt: true },
        });
        if (latest && dayInZone(new Date(latest.endAt.getTime() - 1), course.timezone) > day(endsOn))
          throw conflict('lessons_after_course_end', 'Новая дата окончания раньше уже назначенного или проведённого урока.');
      }
      const updated = await tx.course.updateMany({ where: { id, revision }, data: {
        ...(body.title !== undefined ? { title: body.title.trim() } : {}),
        ...(body.capacity !== undefined ? { capacity: body.capacity } : {}),
        ...(endsOn ? { endsOn } : {}), revision: { increment: 1 },
      } });
      if (!updated.count) throw revisionError();
      await this.audit(tx, ctx, 'course', id, 'course.updated', { title: body.title || course.title, capacity: body.capacity ?? course.capacity });
      return { item: courseDto(await tx.course.findUniqueOrThrow({ where: { id }, include: courseInclude }), ctx.role), changed: ['courses'], requestId: ctx.requestId };
    });
  }

  async transition(ctx: WorkspaceContext, id: string, action: 'activate' | 'pause' | 'complete' | 'archive', revision: number) {
    return this.mutate(ctx, async tx => {
      const course = await this.editable(tx, ctx, id);
      if (course.revision !== revision) throw revisionError();
      const next: CourseStatus = { activate: 'active', pause: 'paused', complete: 'completed', archive: 'archived' }[action] as CourseStatus;
      const allowed: Record<typeof action, CourseStatus[]> = {
        activate: ['draft', 'paused'], pause: ['active'], complete: ['active', 'paused'], archive: ['draft', 'completed'],
      };
      if (!allowed[action].includes(course.status)) throw conflict('invalid_state', 'Недопустимый переход курса.');
      if (action === 'complete' && await tx.lesson.count({ where: { courseId: id, status: { in: ['planned', 'rescheduled'] }, endAt: { gt: new Date() } } }))
        throw conflict('future_lessons', 'Перед завершением курса отмените или проведите будущие занятия.');
      if (action === 'activate') {
        const lead = await tx.courseTeacher.count({ where: { courseId: id, role: 'lead', status: 'active', membership: { status: 'active', roles: { some: { role: 'teacher', revokedAt: null } } } } });
        if (!lead) throw conflict('missing_lead', 'Для активации нужен действующий ведущий преподаватель.');
        if (course.status === 'draft') {
          const version = await tx.programVersion.findUnique({ where: { id: course.programVersionId } });
          if (version?.status !== 'published') throw conflict('program_unavailable', 'Версия программы больше не опубликована.');
        }
      }
      const changed = await tx.course.updateMany({ where: { id, revision }, data: { status: next, revision: { increment: 1 } } });
      if (!changed.count) throw revisionError();
      if (action === 'complete' || action === 'archive') {
        if (action === 'complete') await tx.enrollment.updateMany({ where: { courseId: id, status: { in: ['active', 'paused'] } }, data: { status: 'completed', endsOn: today(), revision: { increment: 1 } } });
        await tx.enrollment.updateMany({ where: { courseId: id, status: 'invited' }, data: { status: 'withdrawn', endsOn: today(), revision: { increment: 1 } } });
      }
      await this.audit(tx, ctx, 'course', id, `course.${action}`, { from: course.status, to: next });
      return { item: courseDto(await tx.course.findUniqueOrThrow({ where: { id }, include: courseInclude }), ctx.role), changed: ['courses', ...(['complete', 'archive'].includes(action) ? ['enrollments'] : [])], requestId: ctx.requestId };
    });
  }

  async teachers(ctx: WorkspaceContext, courseId: string) {
    await this.visible(ctx, courseId);
    const rows = await this.prisma.courseTeacher.findMany({ where: { courseId, ...(ctx.role === 'student' ? { status: 'active' as const } : {}) }, include: teacherInclude, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    return { items: rows.map(teacherDto), total: rows.length };
  }

  async addTeacher(ctx: WorkspaceContext, courseId: string, body: AddCourseTeacherDto, key: string) {
    return this.once(ctx, `courses:${courseId}:teachers`, key, body, async tx => {
      const course = await this.editable(tx, ctx, courseId);
      if (course.status === 'completed' || course.status === 'archived') throw conflict('invalid_state', 'Курс уже завершён.');
      const member = await this.activeMember(tx, ctx, body.teacherUserId, 'teacher');
      if (await tx.courseTeacher.count({ where: { courseId, membershipId: member.id, status: 'active' } })) throw conflict('duplicate_link', 'Преподаватель уже назначен.');
      const row = await tx.courseTeacher.create({ data: { workspaceId: ctx.workspaceId, courseId, membershipId: member.id, role: body.role, startsOn: today() }, include: teacherInclude });
      await this.audit(tx, ctx, 'course_teacher', row.id, 'course.teacher_added', { courseId, teacherUserId: body.teacherUserId, role: body.role });
      return { item: teacherDto(row), changed: ['courseTeachers'], requestId: ctx.requestId };
    });
  }

  async updateTeacher(ctx: WorkspaceContext, courseId: string, linkId: string, body: UpdateCourseTeacherDto, revision: number) {
    return this.mutate(ctx, async tx => {
      const course = await this.editable(tx, ctx, courseId);
      const current = await tx.courseTeacher.findFirst({ where: { id: linkId, courseId, workspaceId: ctx.workspaceId } });
      if (!current) throw notFound();
      if (current.revision !== revision) throw revisionError();
      if (current.status !== 'active' || (!body.role && !body.status)) throw conflict('invalid_state', 'Назначение нельзя изменить.');
      if (body.status && body.status !== 'ended') throw validationError('Завершённое назначение создаётся заново.');
      if (body.status === 'ended' && await tx.lessonTeacher.count({ where: { courseTeacherId: linkId, lesson: { status: { in: ['planned', 'rescheduled'] }, endAt: { gt: new Date() } } } }))
        throw conflict('future_lessons', 'Сначала замените преподавателя в будущих занятиях.');
      if (current.role === 'lead' && (body.role && body.role !== 'lead' || body.status === 'ended') && ['active', 'paused'].includes(course.status)) {
        const leads = await tx.courseTeacher.count({ where: { courseId, role: 'lead', status: 'active', membership: { status: 'active', roles: { some: { role: 'teacher', revokedAt: null } } } } });
        if (leads <= 1) throw conflict('last_lead', 'Нельзя снять последнего ведущего действующего курса.');
      }
      const changed = await tx.courseTeacher.updateMany({ where: { id: linkId, revision }, data: {
        ...(body.role ? { role: body.role } : {}), ...(body.status ? { status: body.status, endsOn: today() } : {}), revision: { increment: 1 },
      } });
      if (!changed.count) throw revisionError();
      const row = await tx.courseTeacher.findUniqueOrThrow({ where: { id: linkId }, include: teacherInclude });
      await this.audit(tx, ctx, 'course_teacher', linkId, 'course.teacher_updated', { role: row.role, status: row.status });
      return { item: teacherDto(row), changed: ['courseTeachers'], requestId: ctx.requestId };
    });
  }

  async enrollments(ctx: WorkspaceContext, courseId: string) {
    await this.visible(ctx, courseId);
    const rows = await this.prisma.enrollment.findMany({ where: { courseId, ...(ctx.role === 'student' ? { membership: { userId: ctx.userId } } : {}) }, include: enrollmentInclude, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    return { items: rows.map(row => enrollmentDto(row, ctx.role)), total: rows.length };
  }

  async enrollment(ctx: WorkspaceContext, courseId: string, id: string) {
    await this.visible(ctx, courseId);
    const row = await this.prisma.enrollment.findFirst({ where: { id, courseId, ...(ctx.role === 'student' ? { membership: { userId: ctx.userId } } : {}) }, include: enrollmentInclude });
    if (!row) throw notFound();
    return { item: enrollmentDto(row, ctx.role) };
  }

  async addEnrollment(ctx: WorkspaceContext, courseId: string, body: CreateEnrollmentDto, key: string) {
    return this.once(ctx, `courses:${courseId}:enrollments`, key, body, async tx => {
      const course = await this.editable(tx, ctx, courseId);
      if (course.status === 'completed' || course.status === 'archived') throw conflict('invalid_state', 'Курс уже завершён.');
      const member = await this.activeMember(tx, ctx, body.studentUserId, 'student');
      if (await tx.enrollment.count({ where: { courseId, membershipId: member.id, status: { in: ['invited', 'active', 'paused'] } } })) throw conflict('duplicate_enrollment', 'Ученик уже состоит в курсе или приглашён.');
      const status = body.status || 'invited';
      if (status === 'active') {
        if (course.status !== 'active') throw conflict('course_not_active', 'Сначала активируйте курс.');
        await this.hasSeat(tx, courseId, course.capacity);
      }
      const row = await tx.enrollment.create({ data: {
        workspaceId: ctx.workspaceId, courseId, membershipId: member.id, status,
        startsOn: status === 'active' ? today() : null,
        goal: body.goal?.trim() || '', note: body.note?.trim() || '', createdByUserId: ctx.userId,
      }, include: enrollmentInclude });
      await this.audit(tx, ctx, 'enrollment', row.id, 'course.enrollment_added', { courseId, studentUserId: body.studentUserId, status });
      return { item: enrollmentDto(row, ctx.role), changed: ['enrollments', 'courses'], requestId: ctx.requestId };
    });
  }

  async updateEnrollment(ctx: WorkspaceContext, courseId: string, id: string, body: UpdateEnrollmentDto, revision: number) {
    return this.mutate(ctx, async tx => {
      const course = await this.editable(tx, ctx, courseId);
      const current = await tx.enrollment.findFirst({ where: { id, courseId, workspaceId: ctx.workspaceId } });
      if (!current) throw notFound();
      if (current.revision !== revision) throw revisionError();
      if (body.status === undefined && body.goal === undefined && body.note === undefined) throw validationError('Нет изменений.');
      const transitions: Record<EnrollmentStatus, EnrollmentStatus[]> = {
        invited: ['active', 'withdrawn'], active: ['paused', 'completed', 'withdrawn'], paused: ['active', 'completed', 'withdrawn'], completed: [], withdrawn: [],
      };
      if (body.status && !transitions[current.status].includes(body.status)) throw conflict('invalid_state', 'Недопустимый переход зачисления.');
      if (body.status && ['paused', 'completed', 'withdrawn'].includes(body.status)
        && await tx.lessonParticipant.count({ where: { enrollmentId: id, lesson: { status: { in: ['planned', 'rescheduled'] }, endAt: { gt: new Date() } } } }))
        throw conflict('future_lessons', 'Сначала измените состав будущих занятий.');
      if (body.status === 'active') {
        if (course.status !== 'active') throw conflict('course_not_active', 'Курс не активен.');
        await this.activeMember(tx, ctx, (await tx.workspaceMembership.findUniqueOrThrow({ where: { id: current.membershipId } })).userId, 'student');
        if (current.status === 'invited') await this.hasSeat(tx, courseId, course.capacity);
      }
      const changed = await tx.enrollment.updateMany({ where: { id, revision }, data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.status === 'active' && !current.startsOn ? { startsOn: today() } : {}),
        ...(body.status === 'completed' || body.status === 'withdrawn' ? { endsOn: today() } : {}),
        ...(body.goal !== undefined ? { goal: body.goal.trim() } : {}),
        ...(body.note !== undefined ? { note: body.note.trim() } : {}), revision: { increment: 1 },
      } });
      if (!changed.count) throw revisionError();
      const row = await tx.enrollment.findUniqueOrThrow({ where: { id }, include: enrollmentInclude });
      await this.audit(tx, ctx, 'enrollment', id, 'course.enrollment_updated', { courseId, status: row.status });
      return { item: enrollmentDto(row, ctx.role), changed: ['enrollments', 'courses'], requestId: ctx.requestId };
    });
  }

  private async assessBatch(db: Prisma.TransactionClient | PrismaService, ctx: WorkspaceContext, body: EnrollmentBatchDto, course: { id: string; status: CourseStatus; capacity: number }) {
    const desired = body.status || 'active';
    const members = await db.workspaceMembership.findMany({
      where: { workspaceId: ctx.workspaceId, userId: { in: body.studentUserIds } },
      include: { roles: true, user: true },
    });
    const existing = await db.enrollment.findMany({
      where: { courseId: course.id, membership: { userId: { in: body.studentUserIds } }, status: { in: ['invited', 'active', 'paused'] } },
      select: { membership: { select: { userId: true } } },
    });
    const byUser = new Map(members.map(member => [member.userId, member]));
    const enrolled = new Set(existing.map(row => row.membership.userId));
    const reserved = await db.enrollment.count({ where: { courseId: course.id, status: { in: ['active', 'paused'] } } });
    let availableSeats = Math.max(0, course.capacity - reserved);
    const items = body.studentUserIds.map(studentUserId => {
      const member = byUser.get(studentUserId);
      let reason: string | null = null;
      if (!member || member.status !== 'active' || !member.roles.some(grant => grant.role === 'student' && !grant.revokedAt)) reason = 'Ученик недоступен в этом пространстве.';
      else if (enrolled.has(studentUserId)) reason = 'Ученик уже состоит в курсе или приглашён.';
      else if (desired === 'active' && course.status !== 'active') reason = 'Курс не активен.';
      else if (desired === 'active' && availableSeats <= 0) reason = 'В курсе нет свободных мест.';
      else if (desired === 'active') availableSeats -= 1;
      return { studentUserId, displayName: member?.displayNameOverride || member?.user.displayName || null, eligible: !reason, reason };
    });
    return { courseId: course.id, status: desired, availableSeats: Math.max(0, course.capacity - reserved), canApply: items.every(item => item.eligible), items };
  }

  async previewBatch(ctx: WorkspaceContext, body: EnrollmentBatchDto) {
    this.contexts.requireAdmin(ctx);
    const course = await this.prisma.course.findFirst({ where: { id: body.courseId, workspaceId: ctx.workspaceId }, include: { legacyMapping: true } });
    if (!course) throw notFound();
    if (course.legacyMapping) throw conflict('legacy_course_read_only', 'Исторический курс редактируется в прежнем кабинете.');
    if (['completed', 'archived'].includes(course.status)) throw conflict('invalid_state', 'Курс уже завершён.');
    return this.assessBatch(this.prisma, ctx, body, course);
  }

  async applyBatch(ctx: WorkspaceContext, body: EnrollmentBatchDto, key: string) {
    return this.once(ctx, `courses:${body.courseId}:batch`, key, body, async tx => {
      const course = await this.editable(tx, ctx, body.courseId);
      if (['completed', 'archived'].includes(course.status)) throw conflict('invalid_state', 'Курс уже завершён.');
      const preview = await this.assessBatch(tx, ctx, body, course);
      if (!preview.canApply) throw new AppError(409, 'batch_conflict', 'Набор не выполнен: исправьте конфликтные строки и повторите предпросмотр.',
        Object.fromEntries(preview.items.flatMap((item, index) => item.reason ? [[`studentUserIds.${index}`, item.reason]] : [])));
      const members = await tx.workspaceMembership.findMany({ where: { workspaceId: ctx.workspaceId, userId: { in: body.studentUserIds } } });
      const byUser = new Map(members.map(member => [member.userId, member.id]));
      const items = [];
      for (const studentUserId of body.studentUserIds) {
        const row = await tx.enrollment.create({ data: {
          workspaceId: ctx.workspaceId, courseId: course.id, membershipId: byUser.get(studentUserId)!,
          status: preview.status, startsOn: preview.status === 'active' ? today() : null, createdByUserId: ctx.userId,
        }, include: enrollmentInclude });
        items.push(enrollmentDto(row, ctx.role));
      }
      await this.audit(tx, ctx, 'course', course.id, 'course.enrollment_batch_added', { courseId: course.id, count: items.length });
      return { courseId: course.id, items, appliedCount: items.length, changed: ['enrollments', 'courses'], requestId: ctx.requestId };
    });
  }
}
