import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { ensureLegacyStudent, ensureLegacyTeacher } from '../src/workspace/legacy';

async function main() {
  if (!/browser.*(ci|test)|(ci|test).*browser/i.test(process.env.DATABASE_URL || '') || process.env.NODE_ENV === 'production') {
    throw new Error('Browser course fixture requires a disposable browser CI/test database.');
  }
  const password = process.env.COURSE_REAL_API_PASSWORD;
  if (!password || password.length < 6) throw new Error('COURSE_REAL_API_PASSWORD is required.');
  const prisma = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.$transaction(async tx => {
      const teacherUser = await tx.user.create({ data: { email: 'teacher@mail.ru', displayName: 'Анна Сергеева', passwordHash, role: 'teacher' } });
      const teacher = await tx.teacherProfile.create({ data: { userId: teacherUser.id, name: 'Анна Сергеева', settings: {} } });
      await ensureLegacyTeacher(tx, teacher.id);
      for (const [email, name] of [['ivan@mail.ru', 'Иван Петров'], ['maria@mail.ru', 'Мария Соколова']]) {
        const user = await tx.user.create({ data: { email, displayName: name, passwordHash, role: 'student' } });
        const student = await tx.studentProfile.create({ data: { userId: user.id, teacherId: teacher.id, name, grade: '9 класс', goal: 'ОГЭ', settings: {}, access: 'active' } });
        await ensureLegacyStudent(tx, student.id);
      }
      const learningTeacherUser = await tx.user.create({ data: { email: 'learning-teacher@test.local', displayName: 'Преподаватель прогресса', passwordHash, role: 'teacher' } });
      const learningTeacher = await tx.teacherProfile.create({ data: { userId: learningTeacherUser.id, name: 'Преподаватель прогресса', settings: {} } });
      await ensureLegacyTeacher(tx, learningTeacher.id);
      const learningUser = await tx.user.create({ data: { email: 'learning-student@test.local', displayName: 'Ученик прогресса', passwordHash, role: 'student' } });
      const learningStudent = await tx.studentProfile.create({ data: { userId: learningUser.id, teacherId: learningTeacher.id, name: 'Ученик прогресса', grade: '9 класс', goal: 'ОГЭ', settings: {}, access: 'active' } });
      await ensureLegacyStudent(tx, learningStudent.id);
      const seriesUser = await tx.user.create({ data: { email: 'series-teacher@test.local', displayName: 'Преподаватель серий', passwordHash, role: 'teacher' } });
      const seriesTeacher = await tx.teacherProfile.create({ data: { userId: seriesUser.id, name: 'Преподаватель серий', settings: {} } });
      const seriesWorkspace = await ensureLegacyTeacher(tx, seriesTeacher.id);
      const seriesStudentUser = await tx.user.create({ data: { email: 'series-student@test.local', displayName: 'Ученик серии', passwordHash, role: 'student' } });
      const seriesStudent = await tx.studentProfile.create({ data: { userId: seriesStudentUser.id, teacherId: seriesTeacher.id, name: 'Ученик серии', settings: {}, access: 'active' } });
      const seriesMember = await ensureLegacyStudent(tx, seriesStudent.id);
      const seriesLead = await tx.workspaceMembership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: seriesWorkspace, userId: seriesUser.id } } });
      for (const width of [390, 1365]) {
        const courseId = `browser-series-course-${width}`;
        await tx.course.create({ data: { id: courseId, workspaceId: seriesWorkspace, programVersionId: 'legacy-version-oge-math', title: `Серия браузер ${width}`, defaultFormat: 'group', capacity: 5, startsOn: new Date(), timezone: 'UTC', status: 'active' } });
        await tx.courseTeacher.create({ data: { id: `browser-series-teacher-${width}`, workspaceId: seriesWorkspace, courseId, membershipId: seriesLead.id, role: 'lead', startsOn: new Date() } });
        await tx.enrollment.create({ data: { id: `browser-series-enrollment-${width}`, workspaceId: seriesWorkspace, courseId, membershipId: seriesMember.id, status: 'active', startsOn: new Date() } });
      }
      const accountUser = await tx.user.create({ data: { email: 'account@test.local', displayName: 'Профиль браузера', passwordHash } });
      const accountWorkspace = await tx.workspace.create({ data: { name: 'Проверка аккаунта', slug: 'browser-account-workspace' } });
      await tx.workspaceMembership.create({ data: { workspaceId: accountWorkspace.id, userId: accountUser.id, roles: { create: [{ role: 'admin' }] } } });
    });
    console.log('Browser course fixture ready.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
