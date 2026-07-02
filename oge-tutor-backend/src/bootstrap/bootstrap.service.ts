import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ROLE } from '../common/contracts';
import { notFound } from '../common/app-error';
import { calculateProgressSummary } from './progress-summary';
import { buildFileDownloadUrl } from '../files/file-url';

type JsonLike = unknown;

function iso(value: Date | null | undefined): string {
  return value ? value.toISOString() : '';
}

function asArray(value: JsonLike): any[] {
  return Array.isArray(value) ? value : [];
}

function resolveHomeworkStatus(homework: any): string {
  if (homework.status === 'assigned' && homework.dueAt && new Date(homework.dueAt).getTime() < Date.now()) return 'overdue';
  return homework.status;
}

@Injectable()
export class BootstrapService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}


  async buildSessionForUser(userId: string) {
    const user = await this.prisma.user.findUnique({ include: { teacherProfile: true, studentProfile: true }, where: { id: userId } });
    if (!user) throw notFound('Пользователь не найден.');

    const profileId = user.role === ROLE.TEACHER ? user.teacherProfile?.id : user.studentProfile?.id;
    if (!profileId) throw notFound('Профиль пользователя не найден.');

    return {
      id: profileId,
      userId: user.id,
      role: user.role,
      email: user.email,
      token: '',
    };
  }

  async buildForUser(userId: string) {
    const user = await this.prisma.user.findUnique({ include: { teacherProfile: true, studentProfile: true }, where: { id: userId } });
    if (!user) throw notFound('Пользователь не найден.');
    if (user.role === ROLE.TEACHER && user.teacherProfile) return this.buildForTeacher(user.teacherProfile.id);
    if (user.role === ROLE.STUDENT && user.studentProfile) return this.buildForStudent(user.studentProfile.id);
    throw notFound('Профиль пользователя не найден.');
  }

  async buildForTeacher(teacherId: string) {
    const teacher = await this.prisma.teacherProfile.findUnique({ include: { user: true }, where: { id: teacherId } });
    if (!teacher) throw notFound('Преподаватель не найден.');

    const [students, lessons, homeworks, topics, notifications] = await Promise.all([
      this.prisma.studentProfile.findMany({ where: { teacherId }, include: this.studentInclude(), orderBy: { createdAt: 'desc' } }),
      this.prisma.lesson.findMany({ where: { teacherId }, orderBy: { startAt: 'asc' } }),
      this.prisma.homework.findMany({ where: { teacherId }, include: { attempts: { include: { fileResource: true }, orderBy: { submittedAt: 'desc' } } }, orderBy: { dueAt: 'asc' } }),
      this.prisma.materialTopic.findMany({ where: { teacherId }, include: { files: { include: { file: true }, orderBy: { createdAt: 'desc' } } }, orderBy: { taskNumber: 'asc' } }),
      this.prisma.notification.findMany({ where: { teacherId }, orderBy: { createdAt: 'desc' } }),
    ]);

    return {
      teacher: this.mapTeacher(teacher),
      students: students.map((student) => this.mapStudent(student)),
      lessons: lessons.map((lesson) => this.mapLesson(lesson)),
      homeworks: homeworks.map((homework) => this.mapHomework(homework)),
      materials: topics.map((topic) => this.mapMaterialTopic(topic)),
      notifications: notifications.map((notice) => this.mapNotification(notice)),
    };
  }

  async buildForStudent(studentId: string) {
    const student = await this.prisma.studentProfile.findUnique({ where: { id: studentId }, include: this.studentInclude() });
    if (!student) throw notFound('Ученик не найден.');

    const [lessons, homeworks, notifications] = await Promise.all([
      this.prisma.lesson.findMany({ where: { studentId }, orderBy: { startAt: 'asc' } }),
      this.prisma.homework.findMany({ where: { studentId }, include: { attempts: { include: { fileResource: true }, orderBy: { submittedAt: 'desc' } } }, orderBy: { dueAt: 'asc' } }),
      this.prisma.notification.findMany({ where: { studentId }, orderBy: { createdAt: 'desc' } }),
    ]);

    const accessibleTasks = [...new Set([
      ...student.progress.map((progress) => progress.taskNumber),
      ...homeworks.flatMap((homework) => homework.taskNumbers),
      ...lessons.flatMap((lesson) => lesson.focusTaskNumbers),
    ])];

    const topics = accessibleTasks.length
      ? await this.prisma.materialTopic.findMany({
        where: { teacherId: student.teacherId, taskNumber: { in: accessibleTasks } },
        include: { files: { include: { file: true }, orderBy: { createdAt: 'desc' } } },
        orderBy: { taskNumber: 'asc' },
      })
      : [];

    return {
      teacher: null,
      students: [this.mapStudent(student)],
      lessons: lessons.map((lesson) => this.mapLesson(lesson)),
      homeworks: homeworks.map((homework) => this.mapHomework(homework)),
      materials: topics.map((topic) => this.mapMaterialTopic(topic)),
      notifications: notifications.map((notice) => this.mapNotification(notice)),
    };
  }

  studentInclude() {
    return {
      user: true,
      progress: { include: { history: { orderBy: { createdAt: 'desc' as const } } }, orderBy: { taskNumber: 'asc' as const } },
    };
  }

  mapTeacher(profile: any) {
    return {
      id: profile.id,
      role: ROLE.TEACHER,
      name: profile.name,
      email: profile.user.email,
      avatar: profile.avatar,
      bg: profile.bg,
      settings: profile.settings || {},
      createdAt: iso(profile.createdAt),
      updatedAt: iso(profile.updatedAt),
    };
  }

  mapStudent(profile: any) {
    const progressByTask = (profile.progress || []).map((progress: any) => this.mapProgress(progress));
    const summary = calculateProgressSummary(progressByTask);
    return {
      id: profile.id,
      teacherId: profile.teacherId,
      role: ROLE.STUDENT,
      name: profile.name,
      email: profile.user.email,
      grade: profile.grade,
      goal: profile.goal,
      note: profile.note || '',
      avatar: profile.avatar,
      bg: profile.bg,
      access: profile.access,
      settings: profile.settings || {},
      progressByTask,
      ...summary,
      createdAt: iso(profile.createdAt),
      updatedAt: iso(profile.updatedAt),
    };
  }

  mapLesson(lesson: any) {
    return {
      id: lesson.id,
      teacherId: lesson.teacherId,
      studentId: lesson.studentId,
      topic: lesson.topic,
      focusTaskNumbers: lesson.focusTaskNumbers || [],
      startAt: iso(lesson.startAt),
      endAt: iso(lesson.endAt),
      timezone: lesson.timezone,
      durationMinutes: lesson.durationMinutes,
      status: lesson.status,
      source: lesson.source,
      completedAt: iso(lesson.completedAt),
      completionComment: lesson.completionComment || '',
      note: lesson.note || '',
      materials: asArray(lesson.materials),
      createdAt: iso(lesson.createdAt),
      updatedAt: iso(lesson.updatedAt),
    };
  }

  mapHomework(homework: any) {
    return {
      id: homework.id,
      teacherId: homework.teacherId,
      studentId: homework.studentId,
      title: homework.title,
      topic: homework.topic || '',
      taskNumbers: homework.taskNumbers || [],
      dueAt: iso(homework.dueAt),
      assignedAt: iso(homework.assignedAt),
      submittedAt: iso(homework.submittedAt),
      reviewedAt: iso(homework.reviewedAt),
      closedAt: iso(homework.closedAt),
      status: resolveHomeworkStatus(homework),
      description: homework.description || '',
      materials: asArray(homework.materials),
      reviewMaterials: asArray(homework.reviewMaterials),
      attempts: (homework.attempts || []).map((attempt: any) => this.mapSubmission(attempt)),
      solutionFile: homework.solutionFile || '',
      teacherComment: homework.teacherComment || '',
      createdAt: iso(homework.createdAt),
      updatedAt: iso(homework.updatedAt),
    };
  }

  mapSubmission(attempt: any) {
    return {
      id: attempt.id,
      homeworkId: attempt.homeworkId,
      studentId: attempt.studentId,
      file: attempt.fileResource?.originalName || '',
      fileResource: this.mapFileResource(attempt.fileResource),
      reviewStatus: attempt.reviewStatus,
      submittedAt: iso(attempt.submittedAt),
      reviewedAt: iso(attempt.reviewedAt),
      teacherComment: attempt.teacherComment || '',
    };
  }

  mapFileResource(file: any) {
    if (!file) return null;
    return {
      id: file.id,
      originalName: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      url: buildFileDownloadUrl(this.config, file.id),
      uploadedAt: iso(file.uploadedAt),
    };
  }

  mapMaterialTopic(topic: any) {
    return {
      id: topic.id,
      taskNumber: topic.taskNumber,
      title: topic.title,
      files: (topic.files || []).map((file: any) => this.mapMaterialAttachment(file)),
    };
  }

  mapMaterialAttachment(attachment: any) {
    return {
      id: attachment.id,
      type: attachment.type,
      source: attachment.source,
      title: attachment.title,
      url: attachment.file ? buildFileDownloadUrl(this.config, attachment.file.id) : attachment.url || '',
      fileId: attachment.fileId || '',
      originalName: attachment.originalName || attachment.file?.originalName || '',
      fileName: attachment.fileName || attachment.file?.originalName || '',
      mimeType: attachment.mimeType || attachment.file?.mimeType || '',
      size: attachment.size || attachment.file?.size || 0,
      uploadedAt: iso(attachment.uploadedAt || attachment.createdAt),
      fileResource: attachment.file ? this.mapFileResource(attachment.file) : undefined,
    };
  }

  mapProgress(progress: any) {
    return {
      taskNumber: progress.taskNumber,
      coverageStatus: progress.coverageStatus,
      masteryLevel: progress.masteryLevel,
      lastAssessedMasteryLevel: progress.lastAssessedMasteryLevel,
      lessonCount: progress.lessonCount,
      lastLessonId: progress.lastLessonId || '',
      lastActivityAt: iso(progress.lastActivityAt),
      lastAssessedAt: iso(progress.lastAssessedAt),
      source: progress.source,
      teacherComment: progress.teacherComment || '',
      recommendedAction: progress.recommendedAction || '',
      history: (progress.history || []).map((event: any) => ({
        id: event.id,
        type: event.type,
        source: event.source,
        taskNumber: event.taskNumber,
        lessonId: event.lessonId || '',
        coverageStatus: event.coverageStatus,
        masteryLevel: event.masteryLevel,
        comment: event.comment || '',
        createdAt: iso(event.createdAt),
      })),
    };
  }

  mapNotification(notice: any) {
    return {
      id: notice.id,
      type: notice.type,
      status: notice.status,
      teacherId: notice.teacherId,
      studentId: notice.studentId || '',
      taskNumber: notice.taskNumber,
      lessonId: notice.lessonId || '',
      title: notice.title,
      message: notice.message,
      createdAt: iso(notice.createdAt),
      resolvedAt: iso(notice.resolvedAt),
    };
  }
}
