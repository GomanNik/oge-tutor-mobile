import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/current-user';
import { ROLE } from '../common/contracts';
import { conflict, forbidden, notFound, validationError } from '../common/app-error';
import { cleanText, validateEmail, validatePassword } from '../common/validation';

@Injectable()
export class TeacherService {
  constructor(private readonly prisma: PrismaService) {}

  assertTeacher(user: AuthUser) {
    if (user.role !== ROLE.TEACHER || !user.teacherId) throw forbidden();
    return user.teacherId;
  }

  async assertEmailFree(email: string, currentUserId?: string) {
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists && exists.id !== currentUserId) throw conflict('Email уже используется.', { email: 'exists' });
  }

  async updateProfile(user: AuthUser, patch: any) {
    const teacherId = this.assertTeacher(user);
    const name = cleanText(patch.name);
    if (!name) throw validationError('Имя не может быть пустым.', { name: 'required' });
    return this.prisma.teacherProfile.update({
      where: { id: teacherId },
      data: { name, avatar: cleanText(patch.avatar), bg: cleanText(patch.bg) },
      include: { user: true },
    });
  }

  async updateAccount(user: AuthUser, payload: any) {
    const teacherId = this.assertTeacher(user);
    const teacher = await this.prisma.teacherProfile.findUnique({ where: { id: teacherId }, include: { user: true } });
    if (!teacher) throw notFound('Преподаватель не найден.');
    const email = validateEmail(payload.email);
    await this.assertEmailFree(email, teacher.userId);
    await this.prisma.user.update({ where: { id: teacher.userId }, data: { email } });
    return this.prisma.teacherProfile.findUniqueOrThrow({ where: { id: teacherId }, include: { user: true } });
  }

  async changePassword(user: AuthUser, payload: any) {
    const teacherId = this.assertTeacher(user);
    const teacher = await this.prisma.teacherProfile.findUnique({ where: { id: teacherId }, include: { user: true } });
    if (!teacher) throw notFound('Преподаватель не найден.');
    const currentPassword = validatePassword(payload.currentPassword, 'currentPassword');
    const currentOk = await bcrypt.compare(currentPassword, teacher.user.passwordHash);
    if (!currentOk) throw validationError('Текущий пароль указан неверно.', { currentPassword: 'invalid' });
    const newPassword = validatePassword(payload.newPassword || payload.password, 'newPassword');
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({ where: { id: teacher.userId }, data: { passwordHash } });
    return { ok: true };
  }

  async updateNotifications(user: AuthUser, payload: any) {
    const teacherId = this.assertTeacher(user);
    return this.prisma.teacherProfile.update({ where: { id: teacherId }, data: { settings: payload || {} }, include: { user: true } });
  }
}
