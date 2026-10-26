import { Prisma } from '@prisma/client';

export async function lockLessonPeople(tx: Prisma.TransactionClient, userIds: string[]) {
  const ids = [...new Set(userIds)].sort();
  if (!ids.length) return;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "User" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE
  `;
  if (rows.length !== ids.length) throw new Error('Lesson scheduling references a missing user.');
}

export async function lessonConflicts(
  tx: Prisma.TransactionClient,
  startAt: Date,
  endAt: Date,
  teacherUserIds: string[],
  studentUserIds: string[],
  excludeLessonId?: string | string[],
) {
  const allUsers = [...new Set([...teacherUserIds, ...studentUserIds])];
  if (!allUsers.length) return [];
  const rows = await tx.lesson.findMany({
    where: {
      id: excludeLessonId ? (Array.isArray(excludeLessonId) ? { notIn: excludeLessonId } : { not: excludeLessonId }) : undefined,
      status: { in: ['planned', 'rescheduled'] }, startAt: { lt: endAt }, endAt: { gt: startAt },
      OR: [
        { lessonTeachers: { some: { courseTeacher: { membership: { userId: { in: allUsers } } } } } },
        { participants: { some: { enrollment: { membership: { userId: { in: allUsers } } } } } },
      ],
    },
    include: {
      lessonTeachers: {
        select: { courseTeacher: { select: { membership: { select: { userId: true } } } } },
      },
      participants: {
        select: { enrollment: { select: { membership: { select: { userId: true } } } } },
      },
    },
  });
  const busy = new Set(rows.flatMap(row => [
    ...row.lessonTeachers.map(link => link.courseTeacher.membership.userId),
    ...row.participants.map(link => link.enrollment.membership.userId),
  ]));
  return [
    ...teacherUserIds.filter(userId => busy.has(userId)).map(userId => ({ userId, kind: 'teacher' as const })),
    ...studentUserIds.filter(userId => busy.has(userId)).map(userId => ({ userId, kind: 'student' as const })),
  ];
}
