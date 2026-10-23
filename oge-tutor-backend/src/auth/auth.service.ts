import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { notFound, unauthorized } from '../common/app-error';
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

  private createToken(user: { id: string; role: string }, sessionId: string) {
    return this.jwt.sign(
      { sub: user.id, role: user.role, sid: sessionId },
      {
        secret: getJwtSecret(this.config),
        expiresIn: getJwtExpiresIn(this.config),
      },
    );
  }

  async requestPasswordReset(emailInput: unknown) {
    const email = validateEmail(emailInput);
    const user = await this.prisma.user.findUnique({ where: { email }, include: { studentProfile: true } });
    if (!user) return { ok: true };
    if (user.role === ROLE.STUDENT && user.studentProfile?.access === ACCESS_STATUS.DISABLED) return { ok: true };
    const reset = await this.accessTokens.createForUser(user.id, ACCESS_TOKEN_TYPE.PASSWORD_RESET);
    await this.mailer.sendAccessTokenLink({ email: user.email, type: ACCESS_TOKEN_TYPE.PASSWORD_RESET, delivery: reset.delivery, preview: reset.preview });
    return reset.preview ? { ok: true, reset: reset.preview } : { ok: true };
  }

  async signSession(user: { id: string; email: string; role: string; passwordHash?: string }): Promise<SessionPayload> {
    const fullUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { teacherProfile: true, studentProfile: true },
    });
    if (!fullUser) throw notFound('Пользователь не найден.');
    if (user.passwordHash !== undefined && user.passwordHash !== fullUser.passwordHash) throw unauthorized();
    if (fullUser.role === ROLE.STUDENT && fullUser.studentProfile?.access !== ACCESS_STATUS.ACTIVE) throw unauthorized();

    const profileId = fullUser.role === ROLE.TEACHER
      ? fullUser.teacherProfile?.id
      : fullUser.studentProfile?.id;

    if (!profileId) throw notFound('Профиль пользователя не найден.');

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
