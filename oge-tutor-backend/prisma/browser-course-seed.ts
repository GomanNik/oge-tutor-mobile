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
    });
    console.log('Browser course fixture ready.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
