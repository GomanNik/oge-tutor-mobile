import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('123456', 12);

  await prisma.notification.deleteMany();
  await prisma.progressHistory.deleteMany();
  await prisma.studentTaskProgress.deleteMany();
  await prisma.homeworkSubmission.deleteMany();
  await prisma.homework.deleteMany();
  await prisma.lesson.deleteMany();
  await prisma.materialAttachment.deleteMany();
  await prisma.materialTopic.deleteMany();
  await prisma.fileResource.deleteMany();
  await prisma.studentProfile.deleteMany();
  await prisma.teacherProfile.deleteMany();
  await prisma.user.deleteMany();

  const teacherUser = await prisma.user.create({ data: { email: 'teacher@mail.ru', passwordHash, role: 'teacher' } });
  const teacher = await prisma.teacherProfile.create({
    data: {
      userId: teacherUser.id,
      name: 'Анна Сергеева',
      avatar: 'owl',
      bg: 'blue',
      settings: {
        lessonReminders: true,
        submittedSolutions: true,
        overdueHomework: true,
      },
    },
  });

  const ivanUser = await prisma.user.create({ data: { email: 'ivan@mail.ru', passwordHash, role: 'student' } });
  const ivan = await prisma.studentProfile.create({
    data: {
      userId: ivanUser.id,
      teacherId: teacher.id,
      name: 'Иван Петров',
      grade: '9 класс',
      goal: 'ОГЭ на 4',
      note: 'Сильнее алгебра, геометрию лучше закреплять короткими блоками.',
      avatar: 'bear',
      bg: 'blue',
      access: 'active',
      settings: { lessonReminders: true, homeworkDeadlines: true },
    },
  });

  const mariaUser = await prisma.user.create({ data: { email: 'maria@mail.ru', passwordHash, role: 'student' } });
  await prisma.studentProfile.create({
    data: {
      userId: mariaUser.id,
      teacherId: teacher.id,
      name: 'Мария Соколова',
      grade: '9 класс',
      goal: 'ОГЭ на 5',
      note: 'Хороший темп, важно регулярно отслеживать задания второй части.',
      avatar: 'fox',
      bg: 'violet',
      access: 'active',
      settings: { lessonReminders: true, homeworkDeadlines: true },
    },
  });

  const task6 = await prisma.studentTaskProgress.create({
    data: {
      studentId: ivan.id,
      taskNumber: 6,
      coverageStatus: 'assessed',
      masteryLevel: 'medium',
      lastAssessedMasteryLevel: 'medium',
      lessonCount: 2,
      lastAssessedAt: new Date('2026-05-10T10:00:00.000Z'),
      lastActivityAt: new Date('2026-05-10T10:00:00.000Z'),
      source: 'manual',
      teacherComment: 'Базу понимает, но ошибается в преобразованиях.',
      recommendedAction: 'Повторить через короткое ДЗ.',
    },
  });
  await prisma.progressHistory.create({
    data: {
      studentId: ivan.id,
      taskProgressId: task6.id,
      taskNumber: 6,
      type: 'manual_update',
      source: 'manual',
      coverageStatus: 'assessed',
      masteryLevel: 'medium',
      comment: 'Первичная оценка.',
    },
  });

  await prisma.studentTaskProgress.create({
    data: {
      studentId: ivan.id,
      taskNumber: 7,
      coverageStatus: 'assessed',
      masteryLevel: 'weak',
      lastAssessedMasteryLevel: 'weak',
      lessonCount: 1,
      lastAssessedAt: new Date('2026-05-11T10:00:00.000Z'),
      lastActivityAt: new Date('2026-05-11T10:00:00.000Z'),
      source: 'manual',
      teacherComment: 'Путает порядок действий.',
      recommendedAction: 'Дать тренировку на 5–7 коротких примеров.',
    },
  });

  await prisma.lesson.create({
    data: {
      teacherId: teacher.id,
      studentId: ivan.id,
      topic: 'Уравнения и преобразования',
      focusTaskNumbers: [6, 7],
      startAt: new Date('2026-06-01T15:00:00.000Z'),
      endAt: new Date('2026-06-01T16:00:00.000Z'),
      timezone: 'Europe/Moscow',
      durationMinutes: 60,
      status: 'planned',
      source: 'manual',
      materials: [],
    },
  });

  await prisma.homework.create({
    data: {
      teacherId: teacher.id,
      studentId: ivan.id,
      title: 'Задания 6–7',
      description: 'Закрепить преобразования выражений и порядок действий.',
      topic: 'Преобразования выражений',
      taskNumbers: [6, 7],
      dueAt: new Date('2026-06-05T20:59:00.000Z'),
      status: 'assigned',
      materials: [],
      reviewMaterials: [],
    },
  });

  const topic = await prisma.materialTopic.create({ data: { teacherId: teacher.id, taskNumber: 6, title: 'Задание 6. Преобразования' } });
  await prisma.materialAttachment.create({ data: { topicId: topic.id, type: 'link', source: 'link', title: 'Разбор задания 6', url: 'https://example.com/task-6' } });

  console.log('Seed completed. Login: teacher@mail.ru / 123456');
}

main().finally(async () => prisma.$disconnect());
