import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { conflict, forbidden, validationError } from '../common/app-error';
import { ACCESS_STATUS, ACCESS_TOKEN_TYPE, AccessTokenType, ROLE } from '../common/contracts';
import { cleanText, validatePassword } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';
import { isProduction } from './auth-config';

export type AccessTokenPreview = {
  token?: string;
  link?: string;
  expiresAt: string;
};

export type CreatedAccessToken = {
  id: string;
  type: AccessTokenType;
  expiresAt: Date;
  preview?: AccessTokenPreview;
};

export type VerifiedAccessToken = {
  valid: true;
  type: AccessTokenType;
  expiresAt: string;
  account: {
    email: string;
    name: string;
  };
};

const TOKEN_TTL_MS: Record<AccessTokenType, number> = {
  [ACCESS_TOKEN_TYPE.INVITE]: 7 * 24 * 60 * 60 * 1000,
  [ACCESS_TOKEN_TYPE.PASSWORD_RESET]: 60 * 60 * 1000,
};

@Injectable()
export class AccessTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private createRawToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private setupPath(type: AccessTokenType): string {
    return type === ACCESS_TOKEN_TYPE.INVITE ? 'setup-password' : 'reset-password';
  }

  private buildPreview(type: AccessTokenType, token: string, expiresAt: Date): AccessTokenPreview | undefined {
    if (isProduction(this.config)) return undefined;
    const frontendOrigin = this.config.get<string>('FRONTEND_ORIGIN') || 'http://localhost:5173';
    const link = `${frontendOrigin.replace(/\/$/, '')}/${this.setupPath(type)}?token=${encodeURIComponent(token)}`;
    return { token, link, expiresAt: expiresAt.toISOString() };
  }

  async createForUser(userId: string, type: AccessTokenType, db: any = this.prisma): Promise<CreatedAccessToken> {
    const token = this.createRawToken();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS[type]);
    const saved = await db.accessToken.create({
      data: {
        userId,
        type,
        tokenHash: AccessTokenService.hashToken(token),
        expiresAt,
      },
    });
    return {
      id: saved.id,
      type,
      expiresAt,
      preview: this.buildPreview(type, token, expiresAt),
    };
  }

  private normalizeToken(token: unknown): string {
    const text = cleanText(token);
    if (!text) throw validationError('Ссылка недействительна.', { token: 'required' });
    return text;
  }

  private maskEmail(email: string): string {
    const [local, domain] = String(email || '').split('@');
    if (!local || !domain) return '';
    const head = local.slice(0, 1);
    const tail = local.length > 2 ? local.slice(-1) : '';
    return `${head}${'*'.repeat(Math.max(2, local.length - head.length - tail.length))}${tail}@${domain}`;
  }

  private profileName(user: any): string {
    return cleanText(user?.studentProfile?.name || user?.teacherProfile?.name);
  }

  private assertKnownType(type: string): AccessTokenType {
    if (type === ACCESS_TOKEN_TYPE.INVITE || type === ACCESS_TOKEN_TYPE.PASSWORD_RESET) return type;
    throw validationError('Ссылка недействительна.', { token: 'invalid' });
  }

  private assertTokenUsable(record: any, now = new Date()) {
    if (!record?.user) throw validationError('Ссылка недействительна.', { token: 'invalid' });
    const type = this.assertKnownType(record.type);
    if (record.usedAt) throw conflict('Ссылка уже использована.', { token: 'used' });
    if (new Date(record.expiresAt).getTime() <= now.getTime()) throw conflict('Срок действия ссылки истёк.', { token: 'expired' });
    if (record.user.role === ROLE.STUDENT && record.user.studentProfile?.access === ACCESS_STATUS.DISABLED) {
      throw forbidden('Доступ ученика отключён.');
    }
    if (type === ACCESS_TOKEN_TYPE.INVITE && (record.user.role !== ROLE.STUDENT || !record.user.studentProfile)) {
      throw validationError('Ссылка недействительна.', { token: 'invalid' });
    }
    return type;
  }

  private async findByRawToken(rawToken: unknown, db: any = this.prisma): Promise<any> {
    const token = this.normalizeToken(rawToken);
    return db.accessToken.findUnique({
      where: { tokenHash: AccessTokenService.hashToken(token) },
      include: {
        user: {
          include: {
            teacherProfile: true,
            studentProfile: true,
          },
        },
      },
    });
  }

  async verify(rawToken: unknown): Promise<VerifiedAccessToken> {
    const record = await this.findByRawToken(rawToken);
    const type = this.assertTokenUsable(record);
    return {
      valid: true,
      type,
      expiresAt: new Date(record.expiresAt).toISOString(),
      account: {
        email: this.maskEmail(record.user.email),
        name: this.profileName(record.user),
      },
    };
  }

  async complete(rawToken: unknown, passwordInput: unknown) {
    const token = this.normalizeToken(rawToken);
    const password = validatePassword(passwordInput);
    const tokenHash = AccessTokenService.hashToken(token);
    await this.prisma.$transaction(async (tx) => {
      const record: any = await tx.accessToken.findUnique({
        where: { tokenHash },
        include: {
          user: {
            include: {
              teacherProfile: true,
              studentProfile: true,
            },
          },
        },
      });
      const type = this.assertTokenUsable(record);
      const marked = await tx.accessToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (marked.count !== 1) throw conflict('Ссылка уже использована.', { token: 'used' });

      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash: await bcrypt.hash(password, 12) },
      });

      if (record.user.role === ROLE.STUDENT && record.user.studentProfile) {
        const shouldActivate = type === ACCESS_TOKEN_TYPE.INVITE
          || record.user.studentProfile.access === ACCESS_STATUS.PASSWORD_PENDING;
        if (shouldActivate) {
          await tx.studentProfile.update({
            where: { id: record.user.studentProfile.id },
            data: { access: ACCESS_STATUS.ACTIVE },
          });
        }
      }
    });
    return { ok: true };
  }
}
