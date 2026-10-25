import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/current-user';
import { LESSON_SOURCE, LESSON_STATUS, LessonSource, LessonStatus, NOTIFICATION_STATUS, NOTIFICATION_TYPE, PROGRESS_COVERAGE_STATUS, PROGRESS_SOURCE, ROLE } from '../common/contracts';
import { conflict, forbidden, notFound, validationError } from '../common/app-error';
import { assertFutureDate, assertLessonInterval, cleanText, parseIsoDate, parseOptionalTaskNumbers, requireText } from '../common/validation';
import { FilesService } from '../files/files.service';
import { lessonConflicts, lockLessonPeople } from '../course-lessons/lesson-schedule';

const ACTIVE_LESSON_STATUSES: LessonStatus[] = [LESSON_STATUS.PLANNED, LESSON_STATUS.RESCHEDULED];

@Injectable()
export class LessonsService {
  constructor(private readonly prisma: PrismaService, private readonly files: FilesService) {}

  assertTeacher(user: AuthUser) {
    if (user.role !== ROLE.TEACHER || !user.teacherId) throw forbidden();
    return user.teacherId;
  }

  private withTeacherLock<T>(teacherId: string, action: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(async (tx) => {
      // Lock even an empty schedule; all lesson mutations share this lock.
      const teachers = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "TeacherProfile" WHERE "id" = ${teacherId} FOR UPDATE`;
      if (!teachers.length) throw notFound('Преподаватель не найден.');
      return action(tx);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async assertStudentBelongsToTeacher(teacherId: string, studentId: string, tx: Prisma.TransactionClient = this.prisma) {
    const student = await tx.studentProfile.findFirst({ where: { id: studentId, teacherId } });
    if (!student) throw notFound('Ученик не найден.');
    return student;
  }

  async assertLessonBelongsToTeacher(teacherId: string, lessonId: string, tx: Prisma.TransactionClient = this.prisma) {
    const lesson = await tx.lesson.findFirst({ where: { id: lessonId, teacherId } });
    if (!lesson || !lesson.studentId) throw notFound('Урок не найден.');
    return { ...lesson, studentId: lesson.studentId };
  }

  private async assertNoConflict(tx: Prisma.TransactionClient, teacherId: string, studentId: string, startAt: Date, endAt: Date, lessonId?: string, extraUserIds: string[] = []) {
    const [teacher, student] = await Promise.all([
      tx.teacherProfile.findUniqueOrThrow({ where: { id: teacherId }, select: { userId: true } }),
      tx.studentProfile.findUniqueOrThrow({ where: { id: studentId }, select: { userId: true } }),
    ]);
    await lockLessonPeople(tx, [teacher.userId, student.userId, ...extraUserIds]);
    if ((await lessonConflicts(tx, startAt, endAt, [teacher.userId], [student.userId], lessonId)).length)
      throw conflict('У преподавателя или ученика уже есть занятие в это время.', { startAt: 'lesson_conflict' });
  }

  private parseLessonSource(value: unknown): LessonSource {
    const source = cleanText(value) || LESSON_SOURCE.MANUAL;
    if (!Object.values(LESSON_SOURCE).includes(source as any)) throw validationError('Некорректный источник урока.', { source: 'invalid' });
    return source as LessonSource;
  }

  async create(user: AuthUser, payload: any) {
    const teacherId = this.assertTeacher(user);
    const studentId = requireText(payload.studentId, 'studentId');
    const startAt = parseIsoDate(payload.startAt, 'startAt');
    const endAt = parseIsoDate(payload.endAt, 'endAt');
    const durationMinutes = assertLessonInterval(startAt, endAt);
    assertFutureDate(startAt, 'startAt');
    const materials = await this.files.normalizeEmbeddedAttachments(user, payload.materials, 'materials');
    return this.withTeacherLock(teacherId, async (tx) => {
      await this.assertStudentBelongsToTeacher(teacherId, studentId, tx);
      assertFutureDate(startAt, 'startAt');
      const mapping = await tx.legacyCourseMapping.findUnique({ where: { studentProfileId: studentId } });
      if (!mapping) throw notFound('Курс ученика не найден.');
      await this.assertNoConflict(tx, teacherId, studentId, startAt, endAt);
      const lesson = await tx.lesson.create({
      data: {
        courseId: mapping.courseId,
        teacherId,
        studentId,
        topic: requireText(payload.topic, 'topic'),
        focusTaskNumbers: parseOptionalTaskNumbers(payload.focusTaskNumbers, 'focusTaskNumbers'),
        startAt,
        endAt,
        timezone: cleanText(payload.timezone) || 'Europe/Moscow',
        durationMinutes,
        source: this.parseLessonSource(payload.source),
        status: LESSON_STATUS.PLANNED,
        note: cleanText(payload.note),
        materials,
      },
      });
      await tx.lessonTeacher.create({ data: { lessonId: lesson.id, courseId: mapping.courseId, courseTeacherId: `legacy-course-teacher-${studentId}` } });
      await tx.lessonParticipant.create({ data: { lessonId: lesson.id, courseId: mapping.courseId, enrollmentId: mapping.enrollmentId, responseStatus: 'accepted' } });
      return lesson;
    });
  }

  async update(user: AuthUser, lessonId: string, patch: any) {
    const teacherId = this.assertTeacher(user);
    return this.withTeacherLock(teacherId, async (tx) => {
    const lesson = await this.assertLessonBelongsToTeacher(teacherId, lessonId, tx);
    const studentId = patch.studentId !== undefined && cleanText(patch.studentId) !== lesson.studentId
      ? requireText(patch.studentId, 'studentId')
      : lesson.studentId;
    if (studentId !== lesson.studentId) {
      if (lesson.status === LESSON_STATUS.COMPLETED) throw conflict('Нельзя менять ученика проведённого урока.');
      await this.assertStudentBelongsToTeacher(teacherId, studentId, tx);
    }
    const startAt = patch.startAt !== undefined ? parseIsoDate(patch.startAt, 'startAt') : lesson.startAt;
    const endAt = patch.endAt !== undefined ? parseIsoDate(patch.endAt, 'endAt') : lesson.endAt;
    const durationMinutes = assertLessonInterval(startAt, endAt);
    const scheduleChanged = studentId !== lesson.studentId || patch.startAt !== undefined || patch.endAt !== undefined;
    if (scheduleChanged) {
      assertFutureDate(startAt, 'startAt');
    }
    const materials = patch.materials !== undefined
      ? await this.files.normalizeEmbeddedAttachments(user, patch.materials, 'materials')
      : undefined;
    const source = patch.source !== undefined ? this.parseLessonSource(patch.source) : undefined;
    const status = patch.status !== undefined ? cleanText(patch.status) : undefined;
    if (status && status !== lesson.status && status === LESSON_STATUS.COMPLETED) {
      throw validationError('Завершайте урок через действие completeLesson.', { status: 'use_complete_endpoint' });
    }
    if (status && !Object.values(LESSON_STATUS).includes(status as any)) throw validationError('Некорректный статус урока.', { status: 'invalid' });
    const nextStatus = (status || lesson.status) as LessonStatus;
    const oldStudent = await tx.studentProfile.findUniqueOrThrow({ where: { id: lesson.studentId }, select: { userId: true } });
    if (ACTIVE_LESSON_STATUSES.includes(nextStatus) && (scheduleChanged || nextStatus !== lesson.status)) {
      await this.assertNoConflict(tx, teacherId, studentId, startAt, endAt, lessonId, [oldStudent.userId]);
    }
    const mapping = studentId !== lesson.studentId ? await tx.legacyCourseMapping.findUnique({ where: { studentProfileId: studentId } }) : null;
    if (studentId !== lesson.studentId && !mapping) throw notFound('Курс ученика не найден.');
    if (mapping) {
      await tx.lessonTeacher.deleteMany({ where: { lessonId } });
      await tx.lessonParticipant.deleteMany({ where: { lessonId } });
    }
    const updated = await tx.lesson.update({
      where: { id: lessonId },
      data: {
        courseId: mapping?.courseId,
        studentId: studentId !== lesson.studentId ? studentId : undefined,
        topic: patch.topic !== undefined ? requireText(patch.topic, 'topic') : undefined,
        focusTaskNumbers: patch.focusTaskNumbers !== undefined ? parseOptionalTaskNumbers(patch.focusTaskNumbers, 'focusTaskNumbers') : undefined,
        startAt,
        endAt,
        timezone: patch.timezone !== undefined ? cleanText(patch.timezone) || 'Europe/Moscow' : undefined,
        durationMinutes,
        status: (status as LessonStatus | undefined) || undefined,
        source,
        note: patch.note !== undefined ? cleanText(patch.note) : undefined,
        materials,
        revision: { increment: 1 },
      },
    });
    if (mapping) {
      await tx.lessonTeacher.create({ data: { lessonId, courseId: mapping.courseId, courseTeacherId: `legacy-course-teacher-${studentId}` } });
      await tx.lessonParticipant.create({ data: { lessonId, courseId: mapping.courseId, enrollmentId: mapping.enrollmentId, responseStatus: 'accepted' } });
    }
    return updated;
    });
  }

  async complete(user: AuthUser, lessonId: string, payload: any) {
    const teacherId = this.assertTeacher(user);
    return this.withTeacherLock(teacherId, async (tx) => {
    const lesson = await this.assertLessonBelongsToTeacher(teacherId, lessonId, tx);
    const studentId = lesson.studentId;
    if (!ACTIVE_LESSON_STATUSES.includes(lesson.status as any)) {
      throw conflict('Завершить можно только активный запланированный урок.', { status: 'invalid_status' });
    }
    const completedAt = new Date();
    if (lesson.startAt > completedAt) {
      throw validationError('Будущий урок нельзя отметить проведённым до его начала.', { startAt: 'future_date' });
    }
    const comment = cleanText(payload?.completionComment || payload?.comment);
    const focusTaskNumbers = payload?.focusTaskNumbers !== undefined
      ? parseOptionalTaskNumbers(payload.focusTaskNumbers, 'focusTaskNumbers')
      : (lesson.focusTaskNumbers || []);

      await tx.lesson.update({
        where: { id: lessonId },
        data: {
          status: LESSON_STATUS.COMPLETED,
          completedAt,
          completionComment: comment,
          focusTaskNumbers,
          revision: { increment: 1 },
        },
      });

      for (const taskNumber of focusTaskNumbers) {
        const existing = await tx.studentTaskProgress.findUnique({ where: { studentId_taskNumber: { studentId, taskNumber } } });
        const lastAssessedMasteryLevel = existing?.masteryLevel || existing?.lastAssessedMasteryLevel || null;
        const progress = await tx.studentTaskProgress.upsert({
          where: { studentId_taskNumber: { studentId, taskNumber } },
          create: {
            studentId,
            taskNumber,
            coverageStatus: PROGRESS_COVERAGE_STATUS.ASSESSMENT_NEEDED,
            masteryLevel: null,
            lastAssessedMasteryLevel,
            lessonCount: 1,
            lastLessonId: lesson.id,
            lastActivityAt: completedAt,
            source: PROGRESS_SOURCE.LESSON_COMPLETED,
            teacherComment: comment,
          },
          update: {
            coverageStatus: PROGRESS_COVERAGE_STATUS.ASSESSMENT_NEEDED,
            masteryLevel: null,
            lastAssessedMasteryLevel,
            lessonCount: { increment: 1 },
            lastLessonId: lesson.id,
            lastActivityAt: completedAt,
            source: PROGRESS_SOURCE.LESSON_COMPLETED,
            teacherComment: comment,
          },
        });
        await tx.progressHistory.create({
          data: {
            studentId,
            taskProgressId: progress.id,
            taskNumber,
            lessonId: lesson.id,
            type: 'lesson_completed',
            source: PROGRESS_SOURCE.LESSON_COMPLETED,
            coverageStatus: PROGRESS_COVERAGE_STATUS.ASSESSMENT_NEEDED,
            masteryLevel: null,
            comment,
          },
        });
        await tx.notification.create({
          data: {
            type: NOTIFICATION_TYPE.PROGRESS_ASSESSMENT_REQUIRED,
            status: NOTIFICATION_STATUS.UNREAD,
            teacherId,
            studentId,
            taskNumber,
            lessonId: lesson.id,
            title: `Оцените освоение задания ${taskNumber}`,
            message: `После занятия по заданию ${taskNumber} нужно выставить уровень освоения.`,
          },
        });
      }
      return true;
    });
  }
}
