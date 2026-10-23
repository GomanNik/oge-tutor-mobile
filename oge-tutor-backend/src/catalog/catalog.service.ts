import { Injectable } from '@nestjs/common';
import { Prisma, AccessStatus, HomeworkStatus, LessonStatus, NotificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BootstrapService } from '../bootstrap/bootstrap.service';
import { AuthUser } from '../common/current-user';
import { forbidden, notFound, validationError } from '../common/app-error';
import { ROLE } from '../common/contracts';
import { CatalogQueryDto, UpdateNotificationDto } from './catalog.dto';

function pagination(query: CatalogQueryDto) {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

function page<T>(items: T[], total: number, query: CatalogQueryDto) {
  return { items, total, page: query.page, pageSize: query.pageSize };
}

function enumFilter<T extends string>(value: string | undefined, values: Record<string, T>): T | undefined {
  if (value === undefined) return undefined;
  if (!Object.values(values).includes(value as T)) throw validationError('Некорректный статус.', { status: 'invalid' });
  return value as T;
}

function dateRange(query: CatalogQueryDto) {
  const gte = query.from ? new Date(query.from) : undefined;
  const lte = query.to ? new Date(query.to) : undefined;
  if (gte && lte && gte > lte) throw validationError('Начало периода должно быть раньше конца.', { to: 'invalid_range' });
  return gte || lte ? { gte, lte } : undefined;
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService, private readonly mapper: BootstrapService) {}

  private scope(user: AuthUser, studentId?: string) {
    if (user.role === ROLE.TEACHER && user.teacherId) return { teacherId: user.teacherId, studentId };
    if (user.role === ROLE.STUDENT && user.studentId) {
      if (studentId && studentId !== user.studentId) throw forbidden();
      return { studentId: user.studentId };
    }
    throw forbidden();
  }

  private studentScope(user: AuthUser): Prisma.StudentProfileWhereInput {
    if (user.role === ROLE.TEACHER && user.teacherId) return { teacherId: user.teacherId };
    if (user.role === ROLE.STUDENT && user.studentId) return { id: user.studentId };
    throw forbidden();
  }

  private studentInclude() {
    return { user: true, progress: { orderBy: { taskNumber: 'asc' as const } } };
  }

  private mapStudent(user: AuthUser, student: Prisma.StudentProfileGetPayload<{ include: { user: true; progress: true } }>) {
    const item = this.mapper.mapStudent(student);
    if (user.role === ROLE.STUDENT) item.note = '';
    return item;
  }

  async students(user: AuthUser, query = new CatalogQueryDto()) {
    const where: Prisma.StudentProfileWhereInput = {
      ...this.studentScope(user),
      access: enumFilter(query.status, AccessStatus),
      ...(query.q ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { user: { email: { contains: query.q, mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.studentProfile.findMany({ where, ...pagination(query), include: this.studentInclude(), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      this.prisma.studentProfile.count({ where }),
    ]);
    return page(rows.map(row => this.mapStudent(user, row)), total, query);
  }

  async student(user: AuthUser, id: string) {
    const row = await this.prisma.studentProfile.findFirst({ where: { ...this.studentScope(user), id }, include: this.studentInclude() });
    if (!row) throw notFound('Ученик не найден.');
    return this.mapStudent(user, row);
  }

  async lessons(user: AuthUser, query = new CatalogQueryDto()) {
    const where: Prisma.LessonWhereInput = {
      ...this.scope(user, query.studentId), status: enumFilter(query.status, LessonStatus), startAt: dateRange(query),
      ...(query.taskNumber ? { focusTaskNumbers: { has: query.taskNumber } } : {}),
      ...(query.q ? { topic: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.lesson.findMany({ where, ...pagination(query), orderBy: [{ startAt: 'desc' }, { id: 'desc' }] }),
      this.prisma.lesson.count({ where }),
    ]);
    return page(rows.map(row => this.mapper.mapLesson(row)), total, query);
  }

  async lesson(user: AuthUser, id: string) {
    const row = await this.prisma.lesson.findFirst({ where: { ...this.scope(user), id } });
    if (!row) throw notFound('Урок не найден.');
    return this.mapper.mapLesson(row);
  }

  private homeworkInclude() {
    return { attempts: { include: { fileResource: true }, orderBy: { submittedAt: 'desc' as const }, take: 20 } };
  }

  async homeworks(user: AuthUser, query = new CatalogQueryDto()) {
    const status = enumFilter(query.status, HomeworkStatus);
    const now = new Date();
    const where: Prisma.HomeworkWhereInput = {
      ...this.scope(user, query.studentId), dueAt: dateRange(query),
      ...(status === 'overdue' ? { OR: [{ status: 'overdue' }, { status: 'assigned', dueAt: { lt: now } }] }
        : status === 'assigned' ? { status, AND: [{ dueAt: { gte: now } }] } : { status }),
      ...(query.taskNumber ? { taskNumbers: { has: query.taskNumber } } : {}),
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.homework.findMany({ where, ...pagination(query), include: this.homeworkInclude(), orderBy: [{ dueAt: 'desc' }, { id: 'desc' }] }),
      this.prisma.homework.count({ where }),
    ]);
    return page(rows.map(row => this.mapper.mapHomework(row)), total, query);
  }

  async homework(user: AuthUser, id: string) {
    const row = await this.prisma.homework.findFirst({ where: { ...this.scope(user), id }, include: this.homeworkInclude() });
    if (!row) throw notFound('Домашняя работа не найдена.');
    return this.mapper.mapHomework(row);
  }

  private async materialScope(user: AuthUser): Promise<Prisma.MaterialTopicWhereInput> {
    if (user.role === ROLE.TEACHER && user.teacherId) return { teacherId: user.teacherId };
    if (user.role !== ROLE.STUDENT || !user.studentId) throw forbidden();
    const student = await this.prisma.studentProfile.findUnique({ where: { id: user.studentId }, select: { teacherId: true } });
    if (!student) throw notFound('Ученик не найден.');
    // Only 25 task numbers can exist, regardless of the student's lesson/history count.
    const tasks = await this.prisma.$queryRaw<Array<{ taskNumber: number }>>`
      SELECT "taskNumber" FROM "StudentTaskProgress" WHERE "studentId" = ${user.studentId}
      UNION SELECT unnest("taskNumbers") FROM "Homework" WHERE "studentId" = ${user.studentId}
      UNION SELECT unnest("focusTaskNumbers") FROM "Lesson" WHERE "studentId" = ${user.studentId}`;
    return { teacherId: student.teacherId, taskNumber: { in: tasks.map(task => task.taskNumber) } };
  }

  async materials(user: AuthUser, query = new CatalogQueryDto()) {
    const scope = await this.materialScope(user);
    const where: Prisma.MaterialTopicWhereInput = { AND: [scope, { taskNumber: query.taskNumber }], ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.materialTopic.findMany({ where, ...pagination(query), include: { files: { include: { file: true }, orderBy: { id: 'asc' } } }, orderBy: [{ taskNumber: 'asc' }, { id: 'asc' }] }),
      this.prisma.materialTopic.count({ where }),
    ]);
    return page(rows.map(row => this.mapper.mapMaterialTopic(row)), total, query);
  }

  async material(user: AuthUser, id: string) {
    const row = await this.prisma.materialTopic.findFirst({ where: { ...await this.materialScope(user), id }, include: { files: { include: { file: true }, orderBy: { id: 'asc' } } } });
    if (!row) throw notFound('Тема материалов не найдена.');
    return this.mapper.mapMaterialTopic(row);
  }

  async notifications(user: AuthUser, query = new CatalogQueryDto()) {
    const where: Prisma.NotificationWhereInput = {
      ...this.scope(user, query.studentId), status: enumFilter(query.status, NotificationStatus),
      taskNumber: query.taskNumber, createdAt: dateRange(query),
    };
    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({ where, ...pagination(query), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      this.prisma.notification.count({ where }),
    ]);
    return page(rows.map(row => this.mapper.mapNotification(row)), total, query);
  }

  async updateNotification(user: AuthUser, id: string, body: UpdateNotificationDto) {
    // Assessment notices belong to the teacher's workflow; students may view but cannot dismiss them.
    if (user.role !== ROLE.TEACHER) throw forbidden();
    const result = await this.prisma.notification.updateMany({ where: { id, ...this.scope(user) }, data: { status: body.status, resolvedAt: body.status === 'resolved' ? new Date() : null } });
    if (!result.count) throw notFound('Уведомление не найдено.');
    const row = await this.prisma.notification.findFirstOrThrow({ where: { id, ...this.scope(user) } });
    return { changes: { notifications: [this.mapper.mapNotification(row)] } };
  }

  async readAllNotifications(user: AuthUser) {
    if (user.role !== ROLE.TEACHER) throw forbidden();
    await this.prisma.notification.updateMany({ where: { ...this.scope(user), status: 'unread' }, data: { status: 'read' } });
    return { changes: {}, invalidated: ['notifications'] };
  }

  async history(user: AuthUser, studentId: string, query = new CatalogQueryDto()) {
    const exists = await this.prisma.studentProfile.findFirst({ where: { ...this.studentScope(user), id: studentId }, select: { id: true } });
    if (!exists) throw notFound('Ученик не найден.');
    const where: Prisma.ProgressHistoryWhereInput = { studentId, taskNumber: query.taskNumber, source: query.source, createdAt: dateRange(query) };
    const [rows, total] = await Promise.all([
      this.prisma.progressHistory.findMany({ where, ...pagination(query), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      this.prisma.progressHistory.count({ where }),
    ]);
    return page(rows.map(row => ({ ...row, lessonId: row.lessonId || '', createdAt: row.createdAt.toISOString() })), total, query);
  }

  async teacher(user: AuthUser) {
    if (user.role !== ROLE.TEACHER || !user.teacherId) throw forbidden();
    const row = await this.prisma.teacherProfile.findUnique({ where: { id: user.teacherId }, include: { user: true } });
    if (!row) throw notFound('Преподаватель не найден.');
    return this.mapper.mapTeacher(row);
  }

  async initialForUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { teacherProfile: true, studentProfile: true } });
    if (!user) throw notFound('Пользователь не найден.');
    return this.initial({ id, email: user.email, role: user.role, teacherId: user.teacherProfile?.id || user.studentProfile?.teacherId, studentId: user.studentProfile?.id });
  }

  async initial(user: AuthUser) {
    const [teacher, students, lessons, homeworks, materials, notifications] = await Promise.all([
      user.role === ROLE.TEACHER ? this.teacher(user) : null,
      this.students(user), this.lessons(user), this.homeworks(user), this.materials(user), this.notifications(user),
    ]);
    const collections = { students, lessons, homeworks, materials, notifications };
    return {
      data: { teacher, students: students.items, lessons: lessons.items, homeworks: homeworks.items, materials: materials.items, notifications: notifications.items },
      pagination: Object.fromEntries(Object.entries(collections).map(([key, value]) => [key, { total: value.total, page: value.page, pageSize: value.pageSize }])),
    };
  }
}
