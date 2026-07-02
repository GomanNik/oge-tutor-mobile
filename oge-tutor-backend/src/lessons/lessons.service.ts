import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/current-user';
import { LESSON_SOURCE, LESSON_STATUS, LessonSource, LessonStatus, NOTIFICATION_STATUS, NOTIFICATION_TYPE, PROGRESS_COVERAGE_STATUS, PROGRESS_SOURCE, ROLE } from '../common/contracts';
import { conflict, forbidden, notFound, validationError } from '../common/app-error';
import { assertFutureDate, assertLessonInterval, cleanText, parseIsoDate, parseOptionalTaskNumbers, requireText } from '../common/validation';
import { FilesService } from '../files/files.service';

const ACTIVE_LESSON_STATUSES: LessonStatus[] = [LESSON_STATUS.PLANNED, LESSON_STATUS.RESCHEDULED];

@Injectable()
export class LessonsService {
  constructor(private readonly prisma: PrismaService, private readonly files: FilesService) {}

  assertTeacher(user: AuthUser) {
    if (user.role !== ROLE.TEACHER || !user.teacherId) throw forbidden();
    return user.teacherId;
  }

  async assertStudentBelongsToTeacher(teacherId: string, studentId: string) {
    const student = await this.prisma.studentProfile.findFirst({ where: { id: studentId, teacherId } });
    if (!student) throw notFound('Ученик не найден.');
    return student;
  }

  async assertLessonBelongsToTeacher(teacherId: string, lessonId: string) {
    const lesson = await this.prisma.lesson.findFirst({ where: { id: lessonId, teacherId } });
    if (!lesson) throw notFound('Урок не найден.');
    return lesson;
  }

  async assertNoConflict(studentId: string, startAt: Date, endAt: Date, lessonId?: string) {
    const conflictLesson = await this.prisma.lesson.findFirst({
      where: {
        studentId,
        id: lessonId ? { not: lessonId } : undefined,
        status: { in: ACTIVE_LESSON_STATUSES },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
    });
    if (conflictLesson) throw conflict('У ученика уже есть занятие в это время.', { startAt: 'lesson_conflict' });
  }

  private parseLessonSource(value: unknown): LessonSource {
    const source = cleanText(value) || LESSON_SOURCE.MANUAL;
    if (!Object.values(LESSON_SOURCE).includes(source as any)) throw validationError('Некорректный источник урока.', { source: 'invalid' });
    return source as LessonSource;
  }

  async create(user: AuthUser, payload: any) {
    const teacherId = this.assertTeacher(user);
    const studentId = requireText(payload.studentId, 'studentId');
    await this.assertStudentBelongsToTeacher(teacherId, studentId);
    const startAt = parseIsoDate(payload.startAt, 'startAt');
    const endAt = parseIsoDate(payload.endAt, 'endAt');
    const durationMinutes = assertLessonInterval(startAt, endAt);
    assertFutureDate(startAt, 'startAt');
    await this.assertNoConflict(studentId, startAt, endAt);
    const materials = await this.files.normalizeEmbeddedAttachments(user, payload.materials, 'materials');
    return this.prisma.lesson.create({
      data: {
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
  }

  async update(user: AuthUser, lessonId: string, patch: any) {
    const teacherId = this.assertTeacher(user);
    const lesson = await this.assertLessonBelongsToTeacher(teacherId, lessonId);
    const studentId = patch.studentId !== undefined && cleanText(patch.studentId) !== lesson.studentId
      ? requireText(patch.studentId, 'studentId')
      : lesson.studentId;
    if (studentId !== lesson.studentId) await this.assertStudentBelongsToTeacher(teacherId, studentId);
    const startAt = patch.startAt !== undefined ? parseIsoDate(patch.startAt, 'startAt') : lesson.startAt;
    const endAt = patch.endAt !== undefined ? parseIsoDate(patch.endAt, 'endAt') : lesson.endAt;
    const durationMinutes = assertLessonInterval(startAt, endAt);
    const scheduleChanged = studentId !== lesson.studentId || patch.startAt !== undefined || patch.endAt !== undefined;
    if (scheduleChanged) {
      assertFutureDate(startAt, 'startAt');
      await this.assertNoConflict(studentId, startAt, endAt, lessonId);
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
    return this.prisma.lesson.update({
      where: { id: lessonId },
      data: {
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
      },
    });
  }

  async complete(user: AuthUser, lessonId: string, payload: any) {
    const teacherId = this.assertTeacher(user);
    const lesson = await this.assertLessonBelongsToTeacher(teacherId, lessonId);
    if (!ACTIVE_LESSON_STATUSES.includes(lesson.status as any)) {
      throw conflict('Завершить можно только активный запланированный урок.', { status: 'invalid_status' });
    }
    const completedAt = new Date();
    const comment = cleanText(payload?.completionComment || payload?.comment);
    const focusTaskNumbers = payload?.focusTaskNumbers !== undefined
      ? parseOptionalTaskNumbers(payload.focusTaskNumbers, 'focusTaskNumbers')
      : (lesson.focusTaskNumbers || []);

    return this.prisma.$transaction(async (tx) => {
      await tx.lesson.update({
        where: { id: lessonId },
        data: {
          status: LESSON_STATUS.COMPLETED,
          completedAt,
          completionComment: comment,
          focusTaskNumbers,
        },
      });

      for (const taskNumber of focusTaskNumbers) {
        const existing = await tx.studentTaskProgress.findUnique({ where: { studentId_taskNumber: { studentId: lesson.studentId, taskNumber } } });
        const lastAssessedMasteryLevel = existing?.masteryLevel || existing?.lastAssessedMasteryLevel || null;
        const progress = await tx.studentTaskProgress.upsert({
          where: { studentId_taskNumber: { studentId: lesson.studentId, taskNumber } },
          create: {
            studentId: lesson.studentId,
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
            studentId: lesson.studentId,
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
            studentId: lesson.studentId,
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
