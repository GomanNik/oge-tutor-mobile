import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CONFIRM_VALUE = 'docker-demo';
const TEACHER_EMAIL = 'demo.teacher@example.com';
const TEACHER_PASSWORD = 'DemoTeacher123';
const ACTIVE_STUDENT_PASSWORD = 'DemoStudent123';
const INVITE_TOKEN = 'demo-invite-artem-2026';
const TIMEZONE = 'Asia/Omsk';

const ROLE = { TEACHER: 'teacher', STUDENT: 'student' } as const;
const ACCESS = { ACTIVE: 'active', INVITE_SENT: 'invite_sent' } as const;
const LESSON_STATUS = { PLANNED: 'planned', COMPLETED: 'completed' } as const;
const LESSON_SOURCE = { MANUAL: 'manual' } as const;
const HOMEWORK_STATUS = { ASSIGNED: 'assigned', SUBMITTED: 'submitted' } as const;
const SUBMISSION_STATUS = { SUBMITTED: 'submitted' } as const;
const FILE_SCOPE = { PRIVATE_SUBMISSION: 'private_submission' } as const;
const MATERIAL_TYPE = { LINK: 'link', LIBRARY: 'library' } as const;
const MATERIAL_SOURCE = { LINK: 'link', LIBRARY: 'library' } as const;
const PROGRESS_COVERAGE = { IN_PROGRESS: 'in_progress', ASSESSMENT_NEEDED: 'assessment_needed', ASSESSED: 'assessed' } as const;
const PROGRESS_MASTERY = { WEAK: 'weak', MEDIUM: 'medium', GOOD: 'good' } as const;
const PROGRESS_SOURCE = { MANUAL: 'manual', LESSON_COMPLETED: 'lesson_completed', HOMEWORK_RESULT: 'homework_result' } as const;
const NOTIFICATION_TYPE = { PROGRESS_ASSESSMENT_REQUIRED: 'progress_assessment_required' } as const;
const NOTIFICATION_STATUS = { UNREAD: 'unread' } as const;
const TOKEN_TYPE = { INVITE: 'invite' } as const;

type Args = Record<string, string>;

function parseArgs(argv: string[]): Args {
  const values: Args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;

    const rawArg = arg.slice(2);
    const equalsIndex = rawArg.indexOf('=');
    const key = equalsIndex >= 0 ? rawArg.slice(0, equalsIndex) : rawArg;
    const inlineValue = equalsIndex >= 0 ? rawArg.slice(equalsIndex + 1) : undefined;
    const nextValue = argv[index + 1];
    const value = inlineValue ?? (nextValue && !nextValue.startsWith('--') ? nextValue : '');
    values[key] = value;
    if (inlineValue === undefined && value) index += 1;
  }

  return values;
}

function assertDevOnly(args: Args) {
  const confirm = args.confirm || process.env.DEMO_SEED_CONFIRM;
  const databaseUrl = process.env.DATABASE_URL || '';
  const nodeEnv = process.env.NODE_ENV || 'development';

  if (nodeEnv === 'production') {
    throw new Error('Demo seed refused to run with NODE_ENV=production.');
  }

  if (confirm !== CONFIRM_VALUE) {
    throw new Error(`Demo seed requires --confirm=${CONFIRM_VALUE} or DEMO_SEED_CONFIRM=${CONFIRM_VALUE}.`);
  }

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  if (/prod|production|supabase|railway|render|amazonaws|azure|gcp/i.test(databaseUrl)) {
    throw new Error('DATABASE_URL looks production-like. Demo seed refused to run.');
  }
}

function dateAt(offsetDays: number, hour: number, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function futureInHours(hours: number) {
  const date = new Date(Date.now() + hours * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  return date;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function libraryAttachment(id: string, taskNumber: number, topicTitle: string, title: string, url = '') {
  return {
    id,
    type: MATERIAL_TYPE.LIBRARY,
    source: MATERIAL_SOURCE.LIBRARY,
    title,
    taskNumber,
    topicTitle,
    libraryFileId: id,
    fileName: title,
    url,
  };
}

function linkAttachment(id: string, title: string, url: string) {
  return {
    id,
    type: MATERIAL_TYPE.LINK,
    source: MATERIAL_SOURCE.LINK,
    title,
    url,
  };
}

function ensureDemoSubmissionFile() {
  const fileId = 'demo-file-ivan-graphs-solution';
  const originalName = 'ivan-graphs-solution.txt';
  const uploadDir = process.env.UPLOAD_DIR || 'uploads';
  const absoluteDir = path.resolve(process.cwd(), uploadDir);
  fs.mkdirSync(absoluteDir, { recursive: true });
  const storagePath = path.join(absoluteDir, `${fileId}.txt`);
  const content = 'Demo homework solution for manual Docker frontend review.\n';
  fs.writeFileSync(storagePath, content);

  return {
    id: fileId,
    originalName,
    mimeType: 'text/plain',
    size: Buffer.byteLength(content),
    storagePath,
    url: `${(process.env.PUBLIC_BACKEND_URL || 'http://localhost:3000').replace(/\/$/, '')}/files/${fileId}/download`,
  };
}

async function upsertTeacher(tx: any) {
  const passwordHash = await bcrypt.hash(TEACHER_PASSWORD, 12);
  const user = await tx.user.upsert({
    where: { email: TEACHER_EMAIL },
    update: { passwordHash, role: ROLE.TEACHER },
    create: { email: TEACHER_EMAIL, passwordHash, role: ROLE.TEACHER },
  });

  const teacher = await tx.teacherProfile.upsert({
    where: { userId: user.id },
    update: {
      name: 'Анна Демидова',
      avatar: 'owl',
      bg: 'blue',
      settings: { lessonReminders: true, submittedSolutions: true, overdueHomework: true },
    },
    create: {
      userId: user.id,
      name: 'Анна Демидова',
      avatar: 'owl',
      bg: 'blue',
      settings: { lessonReminders: true, submittedSolutions: true, overdueHomework: true },
    },
  });

  return { user, teacher };
}

async function upsertStudent(tx: any, teacherId: string, input: {
  email: string;
  name: string;
  grade: string;
  goal: string;
  note: string;
  avatar: string;
  bg: string;
  access: string;
}) {
  const passwordHash = await bcrypt.hash(input.access === ACCESS.ACTIVE ? ACTIVE_STUDENT_PASSWORD : 'InvitePending123', 12);
  const user = await tx.user.upsert({
    where: { email: input.email },
    update: { passwordHash, role: ROLE.STUDENT },
    create: { email: input.email, passwordHash, role: ROLE.STUDENT },
  });

  const student = await tx.studentProfile.upsert({
    where: { userId: user.id },
    update: {
      teacherId,
      name: input.name,
      grade: input.grade,
      goal: input.goal,
      note: input.note,
      avatar: input.avatar,
      bg: input.bg,
      access: input.access,
      settings: { lessonReminders: true, homeworkDeadlines: true },
    },
    create: {
      userId: user.id,
      teacherId,
      name: input.name,
      grade: input.grade,
      goal: input.goal,
      note: input.note,
      avatar: input.avatar,
      bg: input.bg,
      access: input.access,
      settings: { lessonReminders: true, homeworkDeadlines: true },
    },
  });

  return { user, student };
}

async function upsertTopicAttachment(tx: any, teacherId: string, taskNumber: number, title: string, attachment: any) {
  const topic = await tx.materialTopic.upsert({
    where: { teacherId_taskNumber: { teacherId, taskNumber } },
    update: { title },
    create: { teacherId, taskNumber, title },
  });

  await tx.materialAttachment.upsert({
    where: { id: attachment.id },
    update: {
      topicId: topic.id,
      type: attachment.type,
      source: attachment.source,
      title: attachment.title,
      url: attachment.url || '',
      fileName: attachment.fileName || '',
    },
    create: {
      id: attachment.id,
      topicId: topic.id,
      type: attachment.type,
      source: attachment.source,
      title: attachment.title,
      url: attachment.url || '',
      fileName: attachment.fileName || '',
    },
  });

  return { topic, attachment };
}

async function upsertLesson(tx: any, teacherId: string, studentId: string, input: any) {
  const existing = await tx.lesson.findFirst({
    where: { teacherId, studentId, topic: input.topic, source: LESSON_SOURCE.MANUAL },
  });

  const data = {
    teacherId,
    studentId,
    topic: input.topic,
    focusTaskNumbers: input.focusTaskNumbers,
    startAt: input.startAt,
    endAt: input.endAt,
    timezone: TIMEZONE,
    durationMinutes: input.durationMinutes,
    status: input.status,
    source: LESSON_SOURCE.MANUAL,
    completedAt: input.completedAt || null,
    completionComment: input.completionComment || '',
    note: input.note || '',
    materials: input.materials || [],
  };

  if (existing) return tx.lesson.update({ where: { id: existing.id }, data });
  return tx.lesson.create({ data });
}

async function upsertHomework(tx: any, teacherId: string, studentId: string, input: any) {
  const existing = await tx.homework.findFirst({ where: { teacherId, studentId, title: input.title } });
  const data = {
    teacherId,
    studentId,
    title: input.title,
    description: input.description,
    topic: input.topic,
    taskNumbers: input.taskNumbers,
    dueAt: input.dueAt,
    assignedAt: input.assignedAt,
    submittedAt: input.submittedAt || null,
    status: input.status,
    materials: input.materials || [],
    reviewMaterials: input.reviewMaterials || [],
    solutionFile: input.solutionFile || '',
    teacherComment: input.teacherComment || '',
  };

  if (existing) return tx.homework.update({ where: { id: existing.id }, data });
  return tx.homework.create({ data });
}

async function upsertProgress(tx: any, studentId: string, input: any) {
  const progress = await tx.studentTaskProgress.upsert({
    where: { studentId_taskNumber: { studentId, taskNumber: input.taskNumber } },
    update: {
      coverageStatus: input.coverageStatus,
      masteryLevel: input.masteryLevel,
      lastAssessedMasteryLevel: input.lastAssessedMasteryLevel || input.masteryLevel || null,
      lessonCount: input.lessonCount,
      lastLessonId: input.lastLessonId || null,
      lastActivityAt: input.lastActivityAt,
      lastAssessedAt: input.lastAssessedAt || null,
      source: input.source,
      teacherComment: input.teacherComment,
      recommendedAction: input.recommendedAction,
    },
    create: {
      studentId,
      taskNumber: input.taskNumber,
      coverageStatus: input.coverageStatus,
      masteryLevel: input.masteryLevel,
      lastAssessedMasteryLevel: input.lastAssessedMasteryLevel || input.masteryLevel || null,
      lessonCount: input.lessonCount,
      lastLessonId: input.lastLessonId || null,
      lastActivityAt: input.lastActivityAt,
      lastAssessedAt: input.lastAssessedAt || null,
      source: input.source,
      teacherComment: input.teacherComment,
      recommendedAction: input.recommendedAction,
    },
  });

  const existingHistory = await tx.progressHistory.findFirst({
    where: { studentId, taskNumber: input.taskNumber, type: input.historyType, comment: input.historyComment },
  });
  const historyData = {
    studentId,
    taskProgressId: progress.id,
    taskNumber: input.taskNumber,
    type: input.historyType,
    source: input.source,
    coverageStatus: input.coverageStatus,
    masteryLevel: input.masteryLevel,
    comment: input.historyComment,
    createdAt: input.lastActivityAt,
  };

  if (existingHistory) await tx.progressHistory.update({ where: { id: existingHistory.id }, data: historyData });
  else await tx.progressHistory.create({ data: historyData });

  return progress;
}

async function upsertNotification(tx: any, teacherId: string, studentId: string, input: any) {
  const existing = await tx.notification.findFirst({
    where: { teacherId, studentId, taskNumber: input.taskNumber, title: input.title },
  });
  const data = {
    type: NOTIFICATION_TYPE.PROGRESS_ASSESSMENT_REQUIRED,
    status: NOTIFICATION_STATUS.UNREAD,
    teacherId,
    studentId,
    taskNumber: input.taskNumber,
    lessonId: input.lessonId || null,
    title: input.title,
    message: input.message,
    createdAt: input.createdAt,
  };

  if (existing) return tx.notification.update({ where: { id: existing.id }, data });
  return tx.notification.create({ data });
}

async function seedDemoData() {
  const submissionFile = ensureDemoSubmissionFile();
  const teacherPasswordHash = await bcrypt.hash(TEACHER_PASSWORD, 12);

  return prisma.$transaction(async (tx) => {
    const { user: teacherUser, teacher } = await upsertTeacher(tx);
    await tx.user.update({ where: { id: teacherUser.id }, data: { passwordHash: teacherPasswordHash } });

    const ivan = await upsertStudent(tx, teacher.id, {
      email: 'demo.ivan@example.com',
      name: 'Иван Демин',
      grade: '9 класс',
      goal: 'ОГЭ на 4',
      note: 'Активный ученик для проверки расписания, ДЗ и прогресса.',
      avatar: 'bear',
      bg: 'blue',
      access: ACCESS.ACTIVE,
    });
    const maria = await upsertStudent(tx, teacher.id, {
      email: 'demo.maria@example.com',
      name: 'Мария Орлова',
      grade: '9 класс',
      goal: 'ОГЭ на 5',
      note: 'Активный ученик с сильным прогрессом и активным ДЗ.',
      avatar: 'fox',
      bg: 'violet',
      access: ACCESS.ACTIVE,
    });
    const artem = await upsertStudent(tx, teacher.id, {
      email: 'demo.artem@example.com',
      name: 'Артём Новиков',
      grade: '9 класс',
      goal: 'Активировать доступ',
      note: 'Invite_sent ученик для проверки действий доступа.',
      avatar: 'rocket',
      bg: 'amber',
      access: ACCESS.INVITE_SENT,
    });

    await tx.accessToken.upsert({
      where: { tokenHash: tokenHash(INVITE_TOKEN) },
      update: {
        userId: artem.user.id,
        type: TOKEN_TYPE.INVITE,
        expiresAt: dateAt(7, 23, 59),
        usedAt: null,
      },
      create: {
        userId: artem.user.id,
        type: TOKEN_TYPE.INVITE,
        tokenHash: tokenHash(INVITE_TOKEN),
        expiresAt: dateAt(7, 23, 59),
      },
    });

    const graphsTheory = libraryAttachment('demo-mat-graphs-theory', 4, 'Графики и функции', 'Графики: теория', 'https://example.com/oge/graphs-theory');
    const graphsVideo = linkAttachment('demo-mat-graphs-video', 'Видеоразбор графиков', 'https://example.com/oge/graphs-video');
    const inequalityMemo = libraryAttachment('demo-mat-inequality-memo', 7, 'Неравенства', 'Неравенства: памятка', 'https://example.com/oge/inequality-memo');
    const percentDrill = libraryAttachment('demo-mat-percent-drill', 12, 'Проценты', 'Проценты: тренажёр', 'https://example.com/oge/percent-drill');
    const wordProblems = libraryAttachment('demo-mat-word-problems', 22, 'Текстовые задачи', 'Текстовые задачи: алгоритм', 'https://example.com/oge/word-problems');

    await upsertTopicAttachment(tx, teacher.id, 4, 'Графики и функции', graphsTheory);
    await upsertTopicAttachment(tx, teacher.id, 4, 'Графики и функции', graphsVideo);
    await upsertTopicAttachment(tx, teacher.id, 7, 'Неравенства', inequalityMemo);
    await upsertTopicAttachment(tx, teacher.id, 12, 'Проценты', percentDrill);
    await upsertTopicAttachment(tx, teacher.id, 22, 'Текстовые задачи', wordProblems);

    const upcomingIvanStart = futureInHours(3);
    const upcomingMariaStart = dateAt(1, 17, 0);
    const completedIvanStart = dateAt(-1, 16, 0);
    const completedMariaStart = dateAt(-3, 18, 0);

    const upcomingIvanLesson = await upsertLesson(tx, teacher.id, ivan.student.id, {
      topic: 'Графики и функции',
      focusTaskNumbers: [4],
      startAt: upcomingIvanStart,
      endAt: addMinutes(upcomingIvanStart, 60),
      durationMinutes: 60,
      status: LESSON_STATUS.PLANNED,
      materials: [graphsTheory],
      note: 'Проверка будущего урока и guard на завершение.',
    });
    await upsertLesson(tx, teacher.id, maria.student.id, {
      topic: 'Неравенства',
      focusTaskNumbers: [7],
      startAt: upcomingMariaStart,
      endAt: addMinutes(upcomingMariaStart, 60),
      durationMinutes: 60,
      status: LESSON_STATUS.PLANNED,
      materials: [inequalityMemo],
      note: 'Ближайший урок для недельного расписания.',
    });
    const completedIvanLesson = await upsertLesson(tx, teacher.id, ivan.student.id, {
      topic: 'Текстовые задачи',
      focusTaskNumbers: [22],
      startAt: completedIvanStart,
      endAt: addMinutes(completedIvanStart, 60),
      durationMinutes: 60,
      status: LESSON_STATUS.COMPLETED,
      completedAt: addMinutes(completedIvanStart, 65),
      completionComment: 'Нужно оценить освоение текстовых задач.',
      materials: [wordProblems],
    });
    await upsertLesson(tx, teacher.id, maria.student.id, {
      topic: 'Проценты',
      focusTaskNumbers: [12],
      startAt: completedMariaStart,
      endAt: addMinutes(completedMariaStart, 60),
      durationMinutes: 60,
      status: LESSON_STATUS.COMPLETED,
      completedAt: addMinutes(completedMariaStart, 65),
      completionComment: 'Мария уверенно решает базовые проценты.',
      materials: [percentDrill],
    });

    const submittedHomework = await upsertHomework(tx, teacher.id, ivan.student.id, {
      title: 'Графики: работа на проверку',
      description: 'Проверить чтение графика и построение зависимости.',
      topic: 'Графики и функции',
      taskNumbers: [4],
      dueAt: dateAt(1, 20, 0),
      assignedAt: dateAt(-2, 10, 0),
      submittedAt: dateAt(0, 9, 0),
      status: HOMEWORK_STATUS.SUBMITTED,
      materials: [graphsTheory, graphsVideo],
      solutionFile: submissionFile.originalName,
    });
    await upsertHomework(tx, teacher.id, maria.student.id, {
      title: 'Неравенства: самостоятельная практика',
      description: 'Решить 8 коротких неравенств и отметить вопросы к уроку.',
      topic: 'Неравенства',
      taskNumbers: [7],
      dueAt: dateAt(4, 20, 0),
      assignedAt: dateAt(0, 8, 0),
      status: HOMEWORK_STATUS.ASSIGNED,
      materials: [inequalityMemo],
    });

    const fileResource = await tx.fileResource.upsert({
      where: { id: submissionFile.id },
      update: {
        ownerId: ivan.user.id,
        scope: FILE_SCOPE.PRIVATE_SUBMISSION,
        originalName: submissionFile.originalName,
        mimeType: submissionFile.mimeType,
        size: submissionFile.size,
        url: submissionFile.url,
        storagePath: submissionFile.storagePath,
      },
      create: {
        id: submissionFile.id,
        ownerId: ivan.user.id,
        scope: FILE_SCOPE.PRIVATE_SUBMISSION,
        originalName: submissionFile.originalName,
        mimeType: submissionFile.mimeType,
        size: submissionFile.size,
        url: submissionFile.url,
        storagePath: submissionFile.storagePath,
      },
    });

    const existingSubmission = await tx.homeworkSubmission.findFirst({
      where: { homeworkId: submittedHomework.id, fileResourceId: fileResource.id },
    });
    const submissionData = {
      homeworkId: submittedHomework.id,
      studentId: ivan.student.id,
      fileResourceId: fileResource.id,
      reviewStatus: SUBMISSION_STATUS.SUBMITTED,
      submittedAt: dateAt(0, 9, 0),
      teacherComment: '',
    };
    if (existingSubmission) await tx.homeworkSubmission.update({ where: { id: existingSubmission.id }, data: submissionData });
    else await tx.homeworkSubmission.create({ data: submissionData });

    await upsertProgress(tx, ivan.student.id, {
      taskNumber: 4,
      coverageStatus: PROGRESS_COVERAGE.ASSESSMENT_NEEDED,
      masteryLevel: null,
      lastAssessedMasteryLevel: PROGRESS_MASTERY.WEAK,
      lessonCount: 1,
      lastLessonId: upcomingIvanLesson.id,
      lastActivityAt: dateAt(0, 9, 0),
      source: PROGRESS_SOURCE.HOMEWORK_RESULT,
      teacherComment: 'Работа сдана, нужна оценка освоения.',
      recommendedAction: 'Проверить работу и выставить уровень.',
      historyType: 'homework_submitted',
      historyComment: 'Демо-работа ожидает проверки.',
    });
    await upsertProgress(tx, ivan.student.id, {
      taskNumber: 22,
      coverageStatus: PROGRESS_COVERAGE.ASSESSMENT_NEEDED,
      masteryLevel: null,
      lastAssessedMasteryLevel: PROGRESS_MASTERY.MEDIUM,
      lessonCount: 1,
      lastLessonId: completedIvanLesson.id,
      lastActivityAt: completedIvanLesson.completedAt,
      source: PROGRESS_SOURCE.LESSON_COMPLETED,
      teacherComment: 'После урока нужна ручная оценка.',
      recommendedAction: 'Оценить освоение в карточке ученика.',
      historyType: 'lesson_completed',
      historyComment: 'Демо-урок завершён.',
    });
    await upsertProgress(tx, maria.student.id, {
      taskNumber: 12,
      coverageStatus: PROGRESS_COVERAGE.ASSESSED,
      masteryLevel: PROGRESS_MASTERY.GOOD,
      lessonCount: 2,
      lastActivityAt: dateAt(-3, 19, 0),
      lastAssessedAt: dateAt(-3, 19, 0),
      source: PROGRESS_SOURCE.MANUAL,
      teacherComment: 'Уверенно решает проценты.',
      recommendedAction: 'Дать задачу повышенной сложности.',
      historyType: 'manual_update',
      historyComment: 'Демо-оценка прогресса.',
    });
    await upsertProgress(tx, maria.student.id, {
      taskNumber: 7,
      coverageStatus: PROGRESS_COVERAGE.IN_PROGRESS,
      masteryLevel: null,
      lessonCount: 1,
      lastActivityAt: dateAt(0, 8, 0),
      source: PROGRESS_SOURCE.MANUAL,
      teacherComment: 'Тема начата, ждём домашнюю работу.',
      recommendedAction: 'Проверить активное ДЗ после отправки.',
      historyType: 'manual_update',
      historyComment: 'Демо-тема начата.',
    });

    await upsertNotification(tx, teacher.id, ivan.student.id, {
      taskNumber: 4,
      title: 'Оцените освоение задания 4',
      message: 'Иван сдал демо-работу по графикам, нужно проверить и выставить уровень.',
      createdAt: dateAt(0, 9, 30),
    });
    await upsertNotification(tx, teacher.id, ivan.student.id, {
      taskNumber: 22,
      lessonId: completedIvanLesson.id,
      title: 'Оцените освоение задания 22',
      message: 'После прошедшего урока по текстовым задачам нужно выставить уровень освоения.',
      createdAt: dateAt(-1, 17, 20),
    });

    return {
      teacher: TEACHER_EMAIL,
      activeStudents: ['demo.ivan@example.com', 'demo.maria@example.com'],
      inviteStudent: 'demo.artem@example.com',
      lessons: 4,
      homeworks: 2,
      materialTopics: 4,
      notifications: 2,
      progressRows: 4,
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertDevOnly(args);
  const result = await seedDemoData();
  console.log('Docker demo data is ready.');
  console.log(JSON.stringify(result, null, 2));
  console.log(`Teacher login: ${TEACHER_EMAIL} / ${TEACHER_PASSWORD}`);
  console.log(`Active student login: demo.ivan@example.com / ${ACTIVE_STUDENT_PASSWORD}`);
  console.log(`Invite setup token: ${INVITE_TOKEN}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Demo seed failed.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
