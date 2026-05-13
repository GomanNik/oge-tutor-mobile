import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/current-user';
import { NOTIFICATION_STATUS, PROGRESS_COVERAGE_STATUS, PROGRESS_SOURCE, ROLE } from '../common/contracts';
import { forbidden, notFound } from '../common/app-error';
import { assertProgressConsistency, cleanText, parseTaskNumbers } from '../common/validation';
import { logDb, logDomain } from '../common/app-logger';

@Injectable()
export class ProgressService {
  constructor(private readonly prisma: PrismaService) {}

  assertTeacher(user: AuthUser) {
    if (user.role !== ROLE.TEACHER || !user.teacherId) throw forbidden();
    return user.teacherId;
  }

  async requireStudent(teacherId: string, studentId: string) {
    const student = await this.prisma.studentProfile.findFirst({ where: { id: studentId, teacherId } });
    if (!student) throw notFound('Ученик не найден.');
  }

  async replaceProgress(user: AuthUser, studentId: string, payload: any) {
    const teacherId = this.assertTeacher(user);
    await this.requireStudent(teacherId, studentId);
    const items = Array.isArray(payload.progressByTask) ? payload.progressByTask : Array.isArray(payload) ? payload : [];
    for (const item of items) await this.updateTask(user, studentId, item.taskNumber, item);
  }

  async updateTask(user: AuthUser, studentId: string, taskNumberInput: unknown, payload: any) {
    const teacherId = this.assertTeacher(user);
    await this.requireStudent(teacherId, studentId);
    const [taskNumber] = parseTaskNumbers([taskNumberInput], 'taskNumber');
    const coverageStatus = cleanText(payload.coverageStatus) || PROGRESS_COVERAGE_STATUS.IN_PROGRESS;
    const masteryLevel = payload.masteryLevel === undefined || payload.masteryLevel === '' ? null : cleanText(payload.masteryLevel);
    assertProgressConsistency(coverageStatus, masteryLevel);
    const now = new Date();

    const progress = await this.prisma.studentTaskProgress.upsert({
      where: { studentId_taskNumber: { studentId, taskNumber } },
      create: {
        studentId,
        taskNumber,
        coverageStatus,
        masteryLevel,
        lastAssessedMasteryLevel: coverageStatus === PROGRESS_COVERAGE_STATUS.ASSESSED ? masteryLevel : null,
        lastAssessedAt: coverageStatus === PROGRESS_COVERAGE_STATUS.ASSESSED ? now : null,
        lastActivityAt: now,
        source: PROGRESS_SOURCE.MANUAL,
        teacherComment: cleanText(payload.teacherComment),
        recommendedAction: cleanText(payload.recommendedAction),
      },
      update: {
        coverageStatus,
        masteryLevel,
        lastAssessedMasteryLevel: coverageStatus === PROGRESS_COVERAGE_STATUS.ASSESSED ? masteryLevel : undefined,
        lastAssessedAt: coverageStatus === PROGRESS_COVERAGE_STATUS.ASSESSED ? now : undefined,
        lastActivityAt: now,
        source: PROGRESS_SOURCE.MANUAL,
        teacherComment: cleanText(payload.teacherComment),
        recommendedAction: cleanText(payload.recommendedAction),
      },
    });

    const history = await this.prisma.progressHistory.create({ data: { studentId, taskProgressId: progress.id, taskNumber, type: 'manual_update', source: PROGRESS_SOURCE.MANUAL, coverageStatus, masteryLevel, comment: cleanText(payload.teacherComment) } });
    logDb('update progress', { studentId, taskNumber, coverageStatus, masteryLevel });
    logDomain('progress.assessed', { studentId, taskNumber, coverageStatus, masteryLevel, historyId: history.id });
    return progress;
  }

  async resolveAssessment(user: AuthUser, studentId: string, taskNumberInput: unknown, payload: any) {
    const [taskNumber] = parseTaskNumbers([taskNumberInput], 'taskNumber');
    const progress = await this.updateTask(user, studentId, taskNumber, { ...payload, coverageStatus: PROGRESS_COVERAGE_STATUS.ASSESSED });
    const result = await this.prisma.notification.updateMany({
      where: { studentId, taskNumber, status: { not: NOTIFICATION_STATUS.RESOLVED } },
      data: { status: NOTIFICATION_STATUS.RESOLVED, resolvedAt: new Date() },
    });
    logDb('resolve assessment notifications', { studentId, taskNumber, count: result.count });
    return progress;
  }
}
