import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/current-user';
import { HOMEWORK_REVIEW_ACTION, HOMEWORK_STATUS, NOTIFICATION_STATUS, NOTIFICATION_TYPE, PROGRESS_COVERAGE_STATUS, PROGRESS_SOURCE, ROLE, SUBMISSION_STATUS } from '../common/contracts';
import { forbidden, notFound, validationError } from '../common/app-error';
import { assertFutureDate, cleanText, parseIsoDate, parseTaskNumbers, requireText } from '../common/validation';
import { logDb, logDomain } from '../common/app-logger';
import { FilesService } from '../files/files.service';

@Injectable()
export class HomeworksService {
  constructor(private readonly prisma: PrismaService, private readonly files: FilesService) {}

  assertTeacher(user: AuthUser) {
    if (user.role !== ROLE.TEACHER || !user.teacherId) throw forbidden();
    return user.teacherId;
  }

  async requireTeacherHomework(teacherId: string, homeworkId: string) {
    const homework = await this.prisma.homework.findFirst({ where: { id: homeworkId, teacherId } });
    if (!homework) throw notFound('Домашнее задание не найдено.');
    return homework;
  }

  async requireStudentHomework(user: AuthUser, homeworkId: string) {
    if (user.role !== ROLE.STUDENT || !user.studentId) throw forbidden();
    const homework = await this.prisma.homework.findFirst({ where: { id: homeworkId, studentId: user.studentId } });
    if (!homework) throw notFound('Домашнее задание не найдено.');
    return homework;
  }

  async assertStudentBelongsToTeacher(teacherId: string, studentId: string) {
    const student = await this.prisma.studentProfile.findFirst({ where: { id: studentId, teacherId } });
    if (!student) throw notFound('Ученик не найден.');
  }

  private homeworkInclude() {
    return { attempts: { include: { fileResource: true }, orderBy: { submittedAt: 'desc' as const } } };
  }

  async loadHomework(homeworkId: string) {
    return this.prisma.homework.findUnique({ where: { id: homeworkId }, include: this.homeworkInclude() });
  }

  async create(user: AuthUser, payload: any) {
    const teacherId = this.assertTeacher(user);
    const studentId = requireText(payload.studentId, 'studentId');
    await this.assertStudentBelongsToTeacher(teacherId, studentId);
    const dueAt = parseIsoDate(payload.dueAt, 'dueAt');
    assertFutureDate(dueAt, 'dueAt');
    const materials = await this.files.normalizeEmbeddedAttachments(user, payload.materials, 'materials');
    const homework = await this.prisma.homework.create({
      data: {
        teacherId,
        studentId,
        title: requireText(payload.title, 'title'),
        description: cleanText(payload.description),
        topic: cleanText(payload.topic),
        taskNumbers: parseTaskNumbers(payload.taskNumbers, 'taskNumbers'),
        dueAt,
        status: HOMEWORK_STATUS.ASSIGNED,
        materials,
      },
      include: this.homeworkInclude(),
    });
    logDb('create homework', { id: homework.id, studentId, teacherId });
    logDomain('homework.created', { homeworkId: homework.id, studentId, teacherId, taskNumbers: homework.taskNumbers });
    return homework;
  }

  async update(user: AuthUser, homeworkId: string, patch: any) {
    const teacherId = this.assertTeacher(user);
    const homework = await this.requireTeacherHomework(teacherId, homeworkId);
    const data: any = {};
    if (patch.studentId !== undefined && cleanText(patch.studentId) !== homework.studentId) {
      const studentId = requireText(patch.studentId, 'studentId');
      await this.assertStudentBelongsToTeacher(teacherId, studentId);
      data.studentId = studentId;
    }
    if (patch.title !== undefined) data.title = requireText(patch.title, 'title');
    if (patch.description !== undefined) data.description = cleanText(patch.description);
    if (patch.topic !== undefined) data.topic = cleanText(patch.topic);
    if (patch.taskNumbers !== undefined) data.taskNumbers = parseTaskNumbers(patch.taskNumbers, 'taskNumbers');
    if (patch.dueAt !== undefined) {
      data.dueAt = parseIsoDate(patch.dueAt, 'dueAt');
      if (data.dueAt.getTime() !== homework.dueAt.getTime()) assertFutureDate(data.dueAt, 'dueAt');
    }
    if (patch.materials !== undefined) data.materials = await this.files.normalizeEmbeddedAttachments(user, patch.materials, 'materials');
    if (patch.status !== undefined) {
      const status = cleanText(patch.status);
      if (!Object.values(HOMEWORK_STATUS).includes(status as any)) throw validationError('Некорректный статус ДЗ.', { status: 'invalid' });
      data.status = status;
    }
    const updated = await this.prisma.homework.update({ where: { id: homeworkId }, data, include: this.homeworkInclude() });
    logDb('update homework', { id: homeworkId, teacherId });
    return updated;
  }

  async submit(user: AuthUser, homeworkId: string, file: Express.Multer.File) {
    const homework = await this.requireStudentHomework(user, homeworkId);
    if (!file) throw validationError('Выберите файл решения.', { file: 'required' });
    const fileResource = await this.files.saveUploadedFile(user, file, { context: 'homework-submission' });
    const submission = await this.prisma.homeworkSubmission.create({
      data: {
        homeworkId,
        studentId: homework.studentId,
        fileResourceId: fileResource.id,
        reviewStatus: SUBMISSION_STATUS.SUBMITTED,
      },
    });
    const updated = await this.prisma.homework.update({ where: { id: homeworkId }, data: { status: HOMEWORK_STATUS.SUBMITTED, submittedAt: new Date(), solutionFile: fileResource.originalName }, include: this.homeworkInclude() });
    logDb('create homeworkSubmission', { id: submission.id, homeworkId, studentId: homework.studentId, fileId: fileResource.id });
    logDomain('homework.submitted', { homeworkId, studentId: homework.studentId, fileId: fileResource.id });
    return updated;
  }

  private resolveReviewStatus(payload: any) {
    const requestedStatus = cleanText(payload.status);
    if (requestedStatus === HOMEWORK_STATUS.NEEDS_REVISION) {
      return { status: HOMEWORK_STATUS.NEEDS_REVISION, submissionStatus: SUBMISSION_STATUS.NEEDS_REVISION };
    }
    if (requestedStatus === HOMEWORK_STATUS.REVIEWED) {
      return { status: HOMEWORK_STATUS.REVIEWED, submissionStatus: SUBMISSION_STATUS.REVIEWED };
    }

    const action = cleanText(payload.action || payload.reviewAction || HOMEWORK_REVIEW_ACTION.APPROVE);
    if (action === HOMEWORK_REVIEW_ACTION.REQUEST_REVISION) {
      return { status: HOMEWORK_STATUS.NEEDS_REVISION, submissionStatus: SUBMISSION_STATUS.NEEDS_REVISION };
    }
    if (action === HOMEWORK_REVIEW_ACTION.APPROVE) {
      return { status: HOMEWORK_STATUS.REVIEWED, submissionStatus: SUBMISSION_STATUS.REVIEWED };
    }
    throw validationError('Некорректный результат проверки ДЗ.', { status: 'invalid' });
  }

  async review(user: AuthUser, homeworkId: string, payload: any) {
    const teacherId = this.assertTeacher(user);
    const homework = await this.requireTeacherHomework(teacherId, homeworkId);
    const { status, submissionStatus } = this.resolveReviewStatus(payload);
    const comment = cleanText(payload.teacherComment || payload.comment);
    const reviewedAt = new Date();
    const reviewMaterials = await this.files.normalizeEmbeddedAttachments(user, payload.reviewMaterials, 'reviewMaterials');

    const updated = await this.prisma.$transaction(async (tx) => {
      const reviewedHomework = await tx.homework.update({
        where: { id: homeworkId },
        data: {
          status,
          reviewedAt,
          closedAt: status === HOMEWORK_STATUS.REVIEWED ? reviewedAt : null,
          teacherComment: comment,
          reviewMaterials,
        },
        include: { attempts: { include: { fileResource: true }, orderBy: { submittedAt: 'desc' as const } } },
      });
      const latest = await tx.homeworkSubmission.findFirst({ where: { homeworkId }, orderBy: { submittedAt: 'desc' as const } });
      if (latest) await tx.homeworkSubmission.update({ where: { id: latest.id }, data: { reviewStatus: submissionStatus, reviewedAt, teacherComment: comment } });

      for (const taskNumber of homework.taskNumbers || []) {
        const existing = await tx.studentTaskProgress.findUnique({ where: { studentId_taskNumber: { studentId: homework.studentId, taskNumber } } });
        const lastAssessedMasteryLevel = existing?.masteryLevel || existing?.lastAssessedMasteryLevel || null;
        const progress = await tx.studentTaskProgress.upsert({
          where: { studentId_taskNumber: { studentId: homework.studentId, taskNumber } },
          create: {
            studentId: homework.studentId,
            taskNumber,
            coverageStatus: PROGRESS_COVERAGE_STATUS.ASSESSMENT_NEEDED,
            masteryLevel: null,
            lastAssessedMasteryLevel,
            lastActivityAt: reviewedAt,
            source: PROGRESS_SOURCE.HOMEWORK_RESULT,
            teacherComment: comment,
            recommendedAction: status === HOMEWORK_STATUS.NEEDS_REVISION ? 'Разобрать ошибки и повторить задание.' : 'Оцените освоение после проверки ДЗ.',
          },
          update: {
            coverageStatus: PROGRESS_COVERAGE_STATUS.ASSESSMENT_NEEDED,
            masteryLevel: null,
            lastAssessedMasteryLevel,
            lastActivityAt: reviewedAt,
            source: PROGRESS_SOURCE.HOMEWORK_RESULT,
            teacherComment: comment,
            recommendedAction: status === HOMEWORK_STATUS.NEEDS_REVISION ? 'Разобрать ошибки и повторить задание.' : 'Оцените освоение после проверки ДЗ.',
          },
        });
        await tx.progressHistory.create({
          data: {
            studentId: homework.studentId,
            taskProgressId: progress.id,
            taskNumber,
            type: 'homework_result',
            source: PROGRESS_SOURCE.HOMEWORK_RESULT,
            coverageStatus: PROGRESS_COVERAGE_STATUS.ASSESSMENT_NEEDED,
            masteryLevel: null,
            comment,
          },
        });
        const notification = await tx.notification.create({
          data: {
            type: NOTIFICATION_TYPE.PROGRESS_ASSESSMENT_REQUIRED,
            status: NOTIFICATION_STATUS.UNREAD,
            teacherId,
            studentId: homework.studentId,
            taskNumber,
            title: `Оцените освоение задания ${taskNumber}`,
            message: `После проверки ДЗ по заданию ${taskNumber} нужно выставить уровень освоения.`,
          },
        });
        logDomain('notification.created', { notificationId: notification.id, studentId: homework.studentId, taskNumber });
      }
      return reviewedHomework;
    });
    logDb('review homework', { id: homeworkId, status });
    logDomain('homework.reviewed', { homeworkId, studentId: homework.studentId, status });
    return updated;
  }
}
