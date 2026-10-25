import { Injectable } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { WorkspaceContext } from '../workspace/workspace-context.service';
import { LearningTx } from './learning-access.service';

type Target = { type: 'lesson' | 'assignment' | 'material' | 'progress' | 'course'; id: string };
type Recipient = { userId: string; role: WorkspaceRole };

@Injectable()
export class LearningEventsService {
  async notify(tx: LearningTx, ctx: WorkspaceContext, eventKey: string, recipients: Recipient[], type: string, target: Target, title: string, message = '') {
    const unique = new Map(recipients.filter(r => r.userId !== ctx.userId).map(r => [r.userId, r]));
    for (const recipient of unique.values()) {
      await tx.learningNotification.upsert({ where: { recipientUserId_eventKey: { recipientUserId: recipient.userId, eventKey: `${ctx.workspaceId}:${eventKey}` } }, update: {}, create: {
        workspaceId: ctx.workspaceId, recipientUserId: recipient.userId, recipientRole: recipient.role, eventKey: `${ctx.workspaceId}:${eventKey}`,
        type, targetType: target.type, targetId: target.id, title, message, delivery: { create: {} },
      } });
    }
  }
  async notifyEnrollments(tx: LearningTx, ctx: WorkspaceContext, eventKey: string, courseId: string, ids: string[], type: string, target: Target, title: string) {
    const [rows, course] = await Promise.all([tx.enrollment.findMany({ where: { courseId, id: { in: ids } }, include: { membership: true } }), tx.course.findUniqueOrThrow({ where: { id: courseId }, select: { title: true } })]);
    await this.notify(tx, ctx, eventKey, rows.map(r => ({ userId: r.membership.userId, role: 'student' })), type, target, title, course.title);
  }
  async notifyTeachers(tx: LearningTx, ctx: WorkspaceContext, eventKey: string, courseId: string, type: string, target: Target, title: string) {
    const [rows, course] = await Promise.all([tx.courseTeacher.findMany({ where: { courseId, status: 'active', membership: { status: 'active', roles: { some: { role: 'teacher', revokedAt: null } } } }, include: { membership: true } }), tx.course.findUniqueOrThrow({ where: { id: courseId }, select: { title: true } })]);
    await this.notify(tx, ctx, eventKey, rows.map(r => ({ userId: r.membership.userId, role: 'teacher' })), type, target, title, course.title);
  }
  async lessonChanged(tx: LearningTx, ctx: WorkspaceContext, lessonId: string, action: string, enrollmentIds?: string[], reason = '', previousTeacherUserIds: string[] = []) {
    const lesson = await tx.lesson.findUniqueOrThrow({ where: { id: lessonId }, include: { participants: true, lessonTeachers: { include: { courseTeacher: { include: { membership: true } } } } } });
    const titles: Record<string, string> = { created: 'Запланировано занятие', updated: 'Изменено занятие', canceled: 'Занятие отменено', completed: 'Занятие завершено', attendance_corrected: 'Уточнена посещаемость' };
    const key = `lesson:${lessonId}:${lesson.revision}:${action}`;
    await this.notifyEnrollments(tx, ctx, key, lesson.courseId, enrollmentIds || lesson.participants.map(p => p.enrollmentId), `lesson.${action}`, { type: 'lesson', id: lessonId }, titles[action] || 'Изменено занятие');
    await this.notify(tx, ctx, key, [...lesson.lessonTeachers.map(t => ({ userId: t.courseTeacher.membership.userId, role: 'teacher' as const })), ...previousTeacherUserIds.map(userId => ({ userId, role: 'teacher' as const }))], `lesson.${action}`, { type: 'lesson', id: lessonId }, titles[action] || 'Изменено занятие');
    if (['completed', 'attendance_corrected'].includes(action)) await tx.$executeRaw`SELECT learning_record_lesson(${lessonId}, ${reason})`;
  }
  async courseChanged(tx: LearningTx, ctx: WorkspaceContext, courseId: string, eventKey: string, type: string, title: string, extraTeacherUserIds: string[] = []) {
    const enrollments = await tx.enrollment.findMany({ where: { courseId, status: { in: ['active', 'paused'] } }, select: { id: true } });
    const target = { type: 'course' as const, id: courseId };
    await this.notifyEnrollments(tx, ctx, eventKey, courseId, enrollments.map(e => e.id), type, target, title);
    await this.notifyTeachers(tx, ctx, eventKey, courseId, type, target, title);
    await this.notify(tx, ctx, eventKey, extraTeacherUserIds.map(userId => ({ userId, role: 'teacher' })), type, target, title);
  }
  async reviewPublished(tx: LearningTx, ctx: WorkspaceContext, reviewId: string) {
    const review = await tx.assignmentReview.findUniqueOrThrow({ where: { id: reviewId }, include: { submission: { include: { recipient: true } } } });
    const recipient = review.submission.recipient;
    await this.notifyEnrollments(tx, ctx, `review:${reviewId}`, recipient.courseId, [recipient.enrollmentId], 'assignment.review_published', { type: 'assignment', id: recipient.assignmentId }, 'Опубликована проверка работы');
  }
}
