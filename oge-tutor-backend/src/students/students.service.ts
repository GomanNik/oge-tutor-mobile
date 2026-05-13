import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/current-user';
import { ACCESS_STATUS, ROLE, STUDENT_ACCESS_ACTION } from '../common/contracts';
import { conflict, forbidden, notFound, validationError } from '../common/app-error';
import { cleanText, validateEmail, validatePassword } from '../common/validation';
import { logDb, logDomain } from '../common/app-logger';

@Injectable()
export class StudentsService {
  constructor(private readonly prisma: PrismaService) {}

  assertTeacher(user: AuthUser) {
    if (user.role !== ROLE.TEACHER || !user.teacherId) throw forbidden();
    return user.teacherId;
  }

  async requireTeacherStudent(teacherId: string, studentId: string) {
    const student = await this.prisma.studentProfile.findFirst({ where: { id: studentId, teacherId }, include: { user: true } });
    if (!student) throw notFound('Ученик не найден.');
    return student;
  }

  async requireMutableStudent(user: AuthUser, studentId: string) {
    if (user.role === ROLE.TEACHER && user.teacherId) return this.requireTeacherStudent(user.teacherId, studentId);
    if (user.role === ROLE.STUDENT && user.studentId === studentId) {
      const student = await this.prisma.studentProfile.findUnique({ where: { id: studentId }, include: { user: true } });
      if (!student) throw notFound('Ученик не найден.');
      return student;
    }
    throw forbidden();
  }

  async assertEmailFree(email: string, currentUserId?: string) {
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists && exists.id !== currentUserId) throw conflict('Email уже используется.', { email: 'exists' });
  }

  async create(user: AuthUser, payload: any) {
    const teacherId = this.assertTeacher(user);
    const email = validateEmail(payload.email);
    const name = cleanText(payload.name);
    if (!name) throw validationError('Имя ученика обязательно.', { name: 'required' });
    await this.assertEmailFree(email);
    const rawPassword = cleanText(payload.password) || '123456';
    const passwordHash = await bcrypt.hash(validatePassword(rawPassword), 12);
    return this.prisma.$transaction(async (tx) => {
      const studentUser = await tx.user.create({ data: { email, passwordHash, role: ROLE.STUDENT } });
      const student = await tx.studentProfile.create({
        data: {
          userId: studentUser.id,
          teacherId,
          name,
          grade: cleanText(payload.grade),
          goal: cleanText(payload.goal),
          note: cleanText(payload.note),
          avatar: cleanText(payload.avatar),
          bg: cleanText(payload.bg),
          access: ACCESS_STATUS.PASSWORD_PENDING,
          settings: payload.settings || {},
        },
        include: { user: true },
      });
      logDb('create student', { id: student.id, teacherId });
      logDomain('student.created', { studentId: student.id, teacherId, email });
      return student;
    });
  }

  async updateProfile(user: AuthUser, studentId: string, patch: any) {
    await this.requireMutableStudent(user, studentId);
    const name = cleanText(patch.name);
    if (!name) throw validationError('Имя ученика обязательно.', { name: 'required' });
    const student = await this.prisma.studentProfile.update({
      where: { id: studentId },
      data: { name, grade: cleanText(patch.grade), goal: cleanText(patch.goal), note: cleanText(patch.note), avatar: cleanText(patch.avatar), bg: cleanText(patch.bg) },
      include: { user: true },
    });
    logDb('update student profile', { studentId });
    return student;
  }

  async updateAccount(user: AuthUser, studentId: string, payload: any) {
    const student = await this.requireMutableStudent(user, studentId);
    const email = validateEmail(payload.email);
    await this.assertEmailFree(email, student.userId);
    await this.prisma.user.update({ where: { id: student.userId }, data: { email } });
    logDb('update student account', { studentId, userId: student.userId });
    return this.prisma.studentProfile.findUniqueOrThrow({ where: { id: studentId }, include: { user: true } });
  }

  async changePassword(user: AuthUser, studentId: string, payload: any) {
    const student = await this.requireMutableStudent(user, studentId);
    if (user.role === ROLE.STUDENT) {
      const currentPassword = validatePassword(payload.currentPassword, 'currentPassword');
      const ok = await bcrypt.compare(currentPassword, student.user.passwordHash);
      if (!ok) throw validationError('Текущий пароль указан неверно.', { currentPassword: 'invalid' });
    }
    const newPassword = validatePassword(payload.newPassword || payload.password, 'newPassword');
    await this.prisma.user.update({ where: { id: student.userId }, data: { passwordHash: await bcrypt.hash(newPassword, 12) } });
    logDb('update student password', { studentId, userId: student.userId });
    return this.prisma.studentProfile.findUniqueOrThrow({ where: { id: studentId }, include: { user: true } });
  }

  async updateNotifications(user: AuthUser, studentId: string, payload: any) {
    await this.requireMutableStudent(user, studentId);
    const student = await this.prisma.studentProfile.update({ where: { id: studentId }, data: { settings: payload?.settings || payload || {} }, include: { user: true } });
    logDb('update student notifications', { studentId });
    return student;
  }

  async updateAccess(user: AuthUser, studentId: string, action: string) {
    const teacherId = this.assertTeacher(user);
    await this.requireTeacherStudent(teacherId, studentId);
    const access = action === STUDENT_ACCESS_ACTION.DISABLE ? ACCESS_STATUS.DISABLED
      : action === STUDENT_ACCESS_ACTION.ENABLE ? ACCESS_STATUS.ACTIVE
      : action === STUDENT_ACCESS_ACTION.RESET_PASSWORD ? ACCESS_STATUS.PASSWORD_PENDING
      : action === STUDENT_ACCESS_ACTION.RESEND_INVITE ? ACCESS_STATUS.INVITE_SENT
      : '';
    if (!access) throw validationError('Некорректное действие доступа.', { action: 'invalid' });
    const student = await this.prisma.studentProfile.update({ where: { id: studentId }, data: { access }, include: { user: true } });
    logDb('update student access', { studentId, access });
    return student;
  }
}
