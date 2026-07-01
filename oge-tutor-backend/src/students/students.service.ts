import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/current-user';
import { ACCESS_STATUS, ACCESS_TOKEN_TYPE, ROLE, STUDENT_ACCESS_ACTION } from '../common/contracts';
import { conflict, forbidden, notFound, validationError } from '../common/app-error';
import { cleanText, validateEmail, validatePassword } from '../common/validation';
import { AccessTokenService } from '../auth/access-token.service';
import { AuthMailerService } from '../auth/auth-mailer.service';

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessTokens: AccessTokenService,
    private readonly mailer: AuthMailerService,
  ) {}

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
    const rawPassword = randomBytes(32).toString('base64url');
    const passwordHash = await bcrypt.hash(validatePassword(rawPassword), 12);
    const result = await this.prisma.$transaction(async (tx) => {
      const studentUser = await tx.user.create({ data: { email, passwordHash, role: ROLE.STUDENT } });
      const student = await tx.studentProfile.create({
        data: {
          userId: studentUser.id,
          teacherId,
          name,
          grade: cleanText(payload.grade),
          goal: cleanText(payload.goal),
          avatar: cleanText(payload.avatar),
          bg: cleanText(payload.bg),
          access: ACCESS_STATUS.INVITE_SENT,
          settings: payload.settings || {},
        },
      });
      const invite = await this.accessTokens.createForUser(studentUser.id, ACCESS_TOKEN_TYPE.INVITE, tx as any);
      return { student, invite };
    });
    await this.mailer.sendAccessTokenLink({ email, type: ACCESS_TOKEN_TYPE.INVITE, preview: result.invite.preview });
    return result;
  }

  async updateProfile(user: AuthUser, studentId: string, patch: any) {
    await this.requireMutableStudent(user, studentId);
    const name = cleanText(patch.name);
    if (!name) throw validationError('Имя ученика обязательно.', { name: 'required' });
    return this.prisma.studentProfile.update({
      where: { id: studentId },
      data: { name, grade: cleanText(patch.grade), goal: cleanText(patch.goal), avatar: cleanText(patch.avatar), bg: cleanText(patch.bg) },
    });
  }

  async updateAccount(user: AuthUser, studentId: string, payload: any) {
    const student = await this.requireMutableStudent(user, studentId);
    const email = validateEmail(payload.email);
    await this.assertEmailFree(email, student.userId);
    await this.prisma.user.update({ where: { id: student.userId }, data: { email } });
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
  }

  async updateNotifications(user: AuthUser, studentId: string, payload: any) {
    await this.requireMutableStudent(user, studentId);
    return this.prisma.studentProfile.update({ where: { id: studentId }, data: { settings: payload || {} } });
  }

  async updateAccess(user: AuthUser, studentId: string, action: string) {
    const teacherId = this.assertTeacher(user);
    const student = await this.requireTeacherStudent(teacherId, studentId);
    if (student.access === ACCESS_STATUS.DISABLED && action === STUDENT_ACCESS_ACTION.RESET_PASSWORD) {
      throw conflict('Нельзя сбросить пароль отключённому ученику.', { action: 'disabled_student' });
    }
    const access = action === STUDENT_ACCESS_ACTION.DISABLE ? ACCESS_STATUS.DISABLED
      : action === STUDENT_ACCESS_ACTION.ENABLE ? ACCESS_STATUS.ACTIVE
      : action === STUDENT_ACCESS_ACTION.RESET_PASSWORD ? ACCESS_STATUS.PASSWORD_PENDING
      : action === STUDENT_ACCESS_ACTION.RESEND_INVITE ? ACCESS_STATUS.INVITE_SENT
      : '';
    if (!access) throw validationError('Некорректное действие доступа.', { action: 'invalid' });
    const updated = await this.prisma.studentProfile.update({ where: { id: studentId }, data: { access } });
    if (action === STUDENT_ACCESS_ACTION.RESEND_INVITE) {
      const invite = await this.accessTokens.createForUser(student.userId, ACCESS_TOKEN_TYPE.INVITE);
      await this.mailer.sendAccessTokenLink({ email: student.user.email, type: ACCESS_TOKEN_TYPE.INVITE, preview: invite.preview });
      return { student: updated, invite };
    }
    if (action === STUDENT_ACCESS_ACTION.RESET_PASSWORD) {
      const reset = await this.accessTokens.createForUser(student.userId, ACCESS_TOKEN_TYPE.PASSWORD_RESET);
      await this.mailer.sendAccessTokenLink({ email: student.user.email, type: ACCESS_TOKEN_TYPE.PASSWORD_RESET, preview: reset.preview });
      return { student: updated, reset };
    }
    return { student: updated };
  }
}
