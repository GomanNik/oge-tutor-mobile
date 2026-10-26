import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { conflict, notFound, unauthorized, validationError } from '../common/app-error';
import { ACCESS_STATUS, ACCESS_TOKEN_TYPE, ROLE } from '../common/contracts';
import { validateEmail, validatePassword } from '../common/validation';
import { AccessTokenService } from './access-token.service';
import { AuthMailerService } from './auth-mailer.service';
import { getJwtExpiresIn, getJwtSecret } from './auth-config';

export type SessionPayload = {
  id: string;
  userId: string;
  role: string;
  email: string;
  token: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly accessTokens: AccessTokenService,
    private readonly mailer: AuthMailerService,
  ) {}

  async validateCredentials(emailInput: unknown, passwordInput: unknown) {
    const email = validateEmail(emailInput);
    const password = validatePassword(passwordInput);
    const user = await this.prisma.user.findUnique({ where: { email }, include: { studentProfile: true } });
    if (!user) throw unauthorized('Неверный email или пароль.');
    if (user.role === ROLE.STUDENT && user.studentProfile?.access !== ACCESS_STATUS.ACTIVE) {
      throw unauthorized('Доступ ученика ещё не активирован.');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw unauthorized('Неверный email или пароль.');
    return user;
  }

  async validateAccountCredentials(emailInput: unknown, passwordInput: unknown) {
    const email = validateEmail(emailInput);
    const password = String(passwordInput ?? '');
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !await bcrypt.compare(password, user.passwordHash)) {
      throw unauthorized('Неверный email или пароль.');
    }
    return user;
  }

  async signAccountSession(userId: string, expectedPasswordHash?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (expectedPasswordHash !== undefined && user.passwordHash !== expectedPasswordHash) throw unauthorized();
    const sessionId = randomUUID();
    const token = this.createToken(user, sessionId);
    const { exp } = this.jwt.decode<{ exp: number }>(token);
    const expiresAt = new Date(exp * 1000);
    await this.prisma.authSession.create({
      data: { id: sessionId, userId, version: user.sessionVersion, expiresAt },
    });
    return { token, userId, expiresAt: expiresAt.toISOString() };
  }

  private createToken(user: { id: string }, sessionId: string) {
    return this.jwt.sign(
      { sub: user.id, sid: sessionId },
      {
        secret: getJwtSecret(this.config),
        expiresIn: getJwtExpiresIn(this.config),
      },
    );
  }

  async requestPasswordReset(emailInput: unknown, accountMode = false) {
    const email = validateEmail(emailInput);
    const user = await this.prisma.user.findUnique({ where: { email }, include: { studentProfile: true } });
    if (!user) return { ok: true };
    if (!accountMode && user.role === ROLE.STUDENT && user.studentProfile?.access === ACCESS_STATUS.DISABLED) return { ok: true };
    const reset = await this.accessTokens.createForUser(user.id, ACCESS_TOKEN_TYPE.PASSWORD_RESET);
    await this.mailer.sendAccessTokenLink({ email: user.email, type: ACCESS_TOKEN_TYPE.PASSWORD_RESET, delivery: reset.delivery, preview: reset.preview });
    return reset.preview ? { ok: true, reset: reset.preview } : { ok: true };
  }

  async changeAccountPassword(userId: string, currentPassword: string, newPasswordInput: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!await bcrypt.compare(currentPassword, user.passwordHash)) throw validationError('Неверный текущий пароль.', { currentPassword: 'incorrect' });
    const newPassword = validatePassword(newPasswordInput);
    if (Buffer.byteLength(newPassword, 'utf8') > 72) throw validationError('Новый пароль должен занимать не более 72 байт UTF-8.');
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.$transaction(async tx => {
      const updated = await tx.user.updateMany({ where: { id: userId, passwordHash: user.passwordHash }, data: { passwordHash, sessionVersion: { increment: 1 }, revision: { increment: 1 } } });
      if (updated.count !== 1) throw conflict('Пароль изменился параллельно. Повторите вход.');
      await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.accessToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
    });
    return { ok: true };
  }

  async signSession(user: { id: string; email: string; role: string | null; passwordHash?: string }): Promise<SessionPayload> {
    const fullUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { teacherProfile: true, studentProfile: true },
    });
    if (!fullUser) throw notFound('Пользователь не найден.');
    if (user.passwordHash !== undefined && user.passwordHash !== fullUser.passwordHash) throw unauthorized();
    if (fullUser.role === ROLE.STUDENT && fullUser.studentProfile?.access !== ACCESS_STATUS.ACTIVE) throw unauthorized();
    if (!fullUser.role) throw unauthorized('Для аккаунта недоступен старый кабинет.');

    const profileId = fullUser.role === ROLE.TEACHER
      ? fullUser.teacherProfile?.id
      : fullUser.studentProfile?.id;

    if (!profileId) throw notFound('Профиль пользователя не найден.');

    const teacherProfileId = fullUser.role === ROLE.TEACHER
      ? fullUser.teacherProfile?.id
      : fullUser.studentProfile?.teacherId;
    const mapping = teacherProfileId && await this.prisma.legacyWorkspaceMapping.findUnique({
      where: { teacherProfileId }, include: { workspace: true },
    });
    if (!mapping || mapping.workspace.status !== 'active') throw unauthorized();
    const member = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: mapping.workspaceId, userId: fullUser.id } },
      include: { roles: true },
    });
    if (member?.status !== 'active' || !member.roles.some(grant => grant.role === fullUser.role && !grant.revokedAt)) {
      throw unauthorized();
    }

    const sessionId = randomUUID();
    const token = this.createToken(fullUser, sessionId);
    const { exp } = this.jwt.decode<{ exp: number }>(token);
    await this.prisma.authSession.create({
      data: { id: sessionId, userId: fullUser.id, version: fullUser.sessionVersion, expiresAt: new Date(exp * 1000) },
    });

    return {
      id: profileId,
      userId: fullUser.id,
      role: fullUser.role,
      email: fullUser.email,
      token,
    };
  }

  async revokeSession(userId: string, sessionId?: string) {
    if (!sessionId) throw unauthorized();
    await this.prisma.authSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async buildSessionForUserId(userId: string): Promise<SessionPayload> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound('Пользователь не найден.');
    return this.signSession(user);
  }
}
