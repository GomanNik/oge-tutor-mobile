import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { notFound, unauthorized } from '../common/app-error';
import { ROLE } from '../common/contracts';
import { validateEmail, validatePassword } from '../common/validation';
import { logDomain } from '../common/app-logger';

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
  ) {}

  async validateCredentials(emailInput: unknown, passwordInput: unknown) {
    const email = validateEmail(emailInput);
    const password = validatePassword(passwordInput);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      logDomain('auth.login.failed', { email });
      throw unauthorized('Неверный email или пароль.');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      logDomain('auth.login.failed', { email, userId: user.id });
      throw unauthorized('Неверный email или пароль.');
    }
    logDomain('auth.login.success', { email, userId: user.id, role: user.role });
    return user;
  }

  private createToken(user: { id: string; role: string }) {
    return this.jwt.sign(
      { sub: user.id, role: user.role },
      {
        secret: this.config.get<string>('JWT_SECRET') || 'dev-secret-change-me',
        expiresIn: this.config.get<string>('JWT_EXPIRES_IN') || '7d',
      },
    );
  }

  async signSession(user: { id: string; email: string; role: string }): Promise<SessionPayload> {
    const fullUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { teacherProfile: true, studentProfile: true },
    });
    if (!fullUser) throw notFound('Пользователь не найден.');

    const profileId = fullUser.role === ROLE.TEACHER
      ? fullUser.teacherProfile?.id
      : fullUser.studentProfile?.id;

    if (!profileId) throw notFound('Профиль пользователя не найден.');

    return {
      id: profileId,
      userId: fullUser.id,
      role: fullUser.role,
      email: fullUser.email,
      token: this.createToken(fullUser),
    };
  }

  async buildSessionForUserId(userId: string): Promise<SessionPayload> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound('Пользователь не найден.');
    return this.signSession(user);
  }
}
