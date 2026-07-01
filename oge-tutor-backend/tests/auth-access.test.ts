import { describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { AuthService } from '../src/auth/auth.service';
import { AccessTokenService } from '../src/auth/access-token.service';
import { getJwtSecret } from '../src/auth/auth-config';
import { ACCESS_STATUS, ACCESS_TOKEN_TYPE, ROLE, STUDENT_ACCESS_ACTION } from '../src/common/contracts';
import { StudentsService } from '../src/students/students.service';

function config(values: Record<string, string | undefined> = {}) {
  return { get: (key: string) => values[key] } as any;
}

function authServiceWithUser(user: any) {
  const prisma = { user: { findUnique: vi.fn(async () => user) } };
  const jwt = { sign: vi.fn(() => 'jwt-token') };
  const accessTokens = { createForUser: vi.fn() };
  const mailer = { sendAccessTokenLink: vi.fn() };
  return new AuthService(prisma as any, jwt as any, config(), accessTokens as any, mailer as any);
}

function tokenRecord(patch: any = {}) {
  return {
    id: 'token-1',
    userId: 'u-student',
    type: ACCESS_TOKEN_TYPE.INVITE,
    tokenHash: AccessTokenService.hashToken('raw-token'),
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    user: {
      id: 'u-student',
      email: 'student@mail.ru',
      role: ROLE.STUDENT,
      teacherProfile: null,
      studentProfile: { id: 's-1', name: 'Student Name', access: ACCESS_STATUS.INVITE_SENT },
    },
    ...patch,
  };
}

describe('auth access hardening', () => {
  it('allows active student login and teacher login', async () => {
    const passwordHash = await bcrypt.hash('secret123', 4);
    const activeStudent = {
      id: 'u-student',
      email: 'student@mail.ru',
      role: ROLE.STUDENT,
      passwordHash,
      studentProfile: { id: 's-1', access: ACCESS_STATUS.ACTIVE },
    };
    const teacher = {
      id: 'u-teacher',
      email: 'teacher@mail.ru',
      role: ROLE.TEACHER,
      passwordHash,
      studentProfile: null,
    };

    await expect(authServiceWithUser(activeStudent).validateCredentials('student@mail.ru', 'secret123')).resolves.toMatchObject({ id: 'u-student' });
    await expect(authServiceWithUser(teacher).validateCredentials('teacher@mail.ru', 'secret123')).resolves.toMatchObject({ id: 'u-teacher' });
  });

  it('rejects disabled, password_pending and invite_sent student login', async () => {
    const passwordHash = await bcrypt.hash('secret123', 4);
    for (const access of [ACCESS_STATUS.DISABLED, ACCESS_STATUS.PASSWORD_PENDING, ACCESS_STATUS.INVITE_SENT]) {
      const service = authServiceWithUser({
        id: `u-${access}`,
        email: `${access}@mail.ru`,
        role: ROLE.STUDENT,
        passwordHash,
        studentProfile: { id: `s-${access}`, access },
      });
      await expect(service.validateCredentials(`${access}@mail.ru`, 'secret123')).rejects.toMatchObject({ code: 'unauthorized' });
    }
  });

  it('fails production JWT config when JWT_SECRET is missing', () => {
    expect(() => getJwtSecret(config({ NODE_ENV: 'production', JWT_SECRET: '' }))).toThrow(/JWT_SECRET/);
    expect(getJwtSecret(config({ NODE_ENV: 'test' }))).toBe('dev-secret-change-me');
  });
});

describe('invite and reset tokens', () => {
  it('creates a password reset token for existing accounts without failing on unknown email', async () => {
    const prisma = { user: { findUnique: vi.fn(async ({ where }) => (where.email === 'known@mail.ru' ? { id: 'u-known', email: where.email } : null)) } };
    const accessTokens = { createForUser: vi.fn(async () => ({ id: 'reset-1', preview: { token: 'dev-reset' } })) };
    const mailer = { sendAccessTokenLink: vi.fn() };
    const service = new AuthService(prisma as any, { sign: vi.fn() } as any, config(), accessTokens as any, mailer as any);

    await expect(service.requestPasswordReset('known@mail.ru')).resolves.toMatchObject({ ok: true });
    await expect(service.requestPasswordReset('unknown@mail.ru')).resolves.toEqual({ ok: true });
    expect(accessTokens.createForUser).toHaveBeenCalledTimes(1);
    expect(accessTokens.createForUser).toHaveBeenCalledWith('u-known', ACCESS_TOKEN_TYPE.PASSWORD_RESET);
    expect(mailer.sendAccessTokenLink).toHaveBeenCalledTimes(1);
  });

  it('does not issue password reset token for disabled student account', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn(async () => ({
          id: 'u-disabled',
          email: 'disabled@mail.ru',
          role: ROLE.STUDENT,
          studentProfile: { id: 's-disabled', access: ACCESS_STATUS.DISABLED },
        })),
      },
    };
    const accessTokens = { createForUser: vi.fn() };
    const mailer = { sendAccessTokenLink: vi.fn() };
    const service = new AuthService(prisma as any, { sign: vi.fn() } as any, config(), accessTokens as any, mailer as any);

    await expect(service.requestPasswordReset('disabled@mail.ru')).resolves.toEqual({ ok: true });
    expect(accessTokens.createForUser).not.toHaveBeenCalled();
    expect(mailer.sendAccessTokenLink).not.toHaveBeenCalled();
  });

  it('stores only token hash and hides preview in production', async () => {
    const created: any[] = [];
    const service = new AccessTokenService({
      accessToken: {
        create: vi.fn(async ({ data }) => {
          created.push(data);
          return { id: 'token-1', ...data };
        }),
      },
    } as any, config({ NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://app.example.test' }) as any);

    const result = await service.createForUser('user-1', ACCESS_TOKEN_TYPE.PASSWORD_RESET);

    expect(result.preview).toBeUndefined();
    expect(created[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(created[0].tokenHash).not.toContain('user-1');
    expect(created[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('creates invited students without the shared demo password and creates an invite token', async () => {
    let createdUser: any;
    let createdProfile: any;
    const tx = {
      user: {
        create: vi.fn(async ({ data }) => {
          createdUser = data;
          return { id: 'u-new', ...data };
        }),
      },
      studentProfile: {
        create: vi.fn(async ({ data }) => {
          createdProfile = data;
          return { id: 's-new', ...data };
        }),
      },
    };
    const prisma = {
      user: { findUnique: vi.fn(async () => null) },
      $transaction: vi.fn(async (callback) => callback(tx)),
    };
    const accessTokens = { createForUser: vi.fn(async () => ({ id: 'invite-1', preview: { token: 'dev-token' } })) };
    const mailer = { sendAccessTokenLink: vi.fn() };
    const service = new StudentsService(prisma as any, accessTokens as any, mailer as any);

    await service.create({ role: ROLE.TEACHER, teacherId: 't-1', id: 'u-teacher', email: 'teacher@mail.ru' }, { email: 'new@mail.ru', name: 'Новый ученик' });

    expect(createdUser.role).toBe(ROLE.STUDENT);
    await expect(bcrypt.compare('123456', createdUser.passwordHash)).resolves.toBe(false);
    expect(createdProfile.access).toBe(ACCESS_STATUS.INVITE_SENT);
    expect(accessTokens.createForUser).toHaveBeenCalledWith('u-new', ACCESS_TOKEN_TYPE.INVITE, tx);
    expect(mailer.sendAccessTokenLink).toHaveBeenCalledWith({ email: 'new@mail.ru', type: ACCESS_TOKEN_TYPE.INVITE, preview: { token: 'dev-token' } });
  });

  it('does not create reset token for disabled student through teacher access action', async () => {
    const prisma = {
      studentProfile: {
        findFirst: vi.fn(async () => ({
          id: 's-disabled',
          userId: 'u-disabled',
          teacherId: 't-1',
          access: ACCESS_STATUS.DISABLED,
          user: { id: 'u-disabled', email: 'disabled@mail.ru' },
        })),
        update: vi.fn(),
      },
    };
    const accessTokens = { createForUser: vi.fn() };
    const mailer = { sendAccessTokenLink: vi.fn() };
    const service = new StudentsService(prisma as any, accessTokens as any, mailer as any);

    await expect(service.updateAccess(
      { role: ROLE.TEACHER, teacherId: 't-1', id: 'u-teacher', email: 'teacher@mail.ru' },
      's-disabled',
      STUDENT_ACCESS_ACTION.RESET_PASSWORD,
    )).rejects.toMatchObject({ code: 'conflict', fieldErrors: { action: 'disabled_student' } });
    expect(prisma.studentProfile.update).not.toHaveBeenCalled();
    expect(accessTokens.createForUser).not.toHaveBeenCalled();
  });
});

describe('access token consumption', () => {
  it('verifies invite token with safe account context', async () => {
    const prisma = { accessToken: { findUnique: vi.fn(async () => tokenRecord()) } };
    const service = new AccessTokenService(prisma as any, config());

    const result = await service.verify('raw-token');

    expect(result).toMatchObject({ valid: true, type: ACCESS_TOKEN_TYPE.INVITE, account: { name: 'Student Name' } });
    expect(result.account.email).not.toBe('student@mail.ru');
    expect(JSON.stringify(result)).not.toContain('raw-token');
    expect(JSON.stringify(result)).not.toContain(tokenRecord().tokenHash);
  });

  it('completes invite token, sets password and activates student', async () => {
    const tx = {
      accessToken: {
        findUnique: vi.fn(async () => tokenRecord()),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      user: { update: vi.fn(async ({ data }) => ({ id: 'u-student', ...data })) },
      studentProfile: { update: vi.fn(async ({ data }) => ({ id: 's-1', ...data })) },
    };
    const prisma = { $transaction: vi.fn(async (callback) => callback(tx)) };
    const service = new AccessTokenService(prisma as any, config());

    await expect(service.complete('raw-token', 'newpass123')).resolves.toEqual({ ok: true });

    const passwordHash = tx.user.update.mock.calls[0][0].data.passwordHash;
    expect(passwordHash).not.toBe('newpass123');
    await expect(bcrypt.compare('newpass123', passwordHash)).resolves.toBe(true);
    expect(tx.studentProfile.update).toHaveBeenCalledWith({ where: { id: 's-1' }, data: { access: ACCESS_STATUS.ACTIVE } });
  });

  it('rejects completed token reuse', async () => {
    const tx = {
      accessToken: { findUnique: vi.fn(async () => tokenRecord({ usedAt: new Date() })), updateMany: vi.fn() },
      user: { update: vi.fn() },
      studentProfile: { update: vi.fn() },
    };
    const service = new AccessTokenService({ $transaction: vi.fn(async (callback) => callback(tx)) } as any, config());

    await expect(service.complete('raw-token', 'newpass123')).rejects.toMatchObject({ code: 'conflict', fieldErrors: { token: 'used' } });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('rejects expired token', async () => {
    const service = new AccessTokenService({
      accessToken: { findUnique: vi.fn(async () => tokenRecord({ expiresAt: new Date(Date.now() - 1000) })) },
    } as any, config());

    await expect(service.verify('raw-token')).rejects.toMatchObject({ code: 'conflict', fieldErrors: { token: 'expired' } });
  });

  it('completes reset token and changes password without exposing token in production response', async () => {
    const teacherReset = tokenRecord({
      type: ACCESS_TOKEN_TYPE.PASSWORD_RESET,
      userId: 'u-teacher',
      user: {
        id: 'u-teacher',
        email: 'teacher@mail.ru',
        role: ROLE.TEACHER,
        teacherProfile: { id: 't-1', name: 'Teacher Name' },
        studentProfile: null,
      },
    });
    const tx = {
      accessToken: {
        findUnique: vi.fn(async () => teacherReset),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      user: { update: vi.fn(async ({ data }) => ({ id: 'u-teacher', ...data })) },
      studentProfile: { update: vi.fn() },
    };
    const prisma = {
      accessToken: { findUnique: vi.fn(async () => teacherReset) },
      $transaction: vi.fn(async (callback) => callback(tx)),
    };
    const service = new AccessTokenService(prisma as any, config({ NODE_ENV: 'production' }));

    const verified = await service.verify('raw-token');
    await service.complete('raw-token', 'teacherpass');

    expect(JSON.stringify(verified)).not.toContain('raw-token');
    expect(JSON.stringify(verified)).not.toContain(teacherReset.tokenHash);
    await expect(bcrypt.compare('teacherpass', tx.user.update.mock.calls[0][0].data.passwordHash)).resolves.toBe(true);
    expect(tx.studentProfile.update).not.toHaveBeenCalled();
  });

  it('does not activate disabled student through reset token', async () => {
    const tx = {
      accessToken: {
        findUnique: vi.fn(async () => tokenRecord({
          type: ACCESS_TOKEN_TYPE.PASSWORD_RESET,
          user: {
            ...tokenRecord().user,
            studentProfile: { id: 's-1', name: 'Student Name', access: ACCESS_STATUS.DISABLED },
          },
        })),
        updateMany: vi.fn(),
      },
      user: { update: vi.fn() },
      studentProfile: { update: vi.fn() },
    };
    const service = new AccessTokenService({ $transaction: vi.fn(async (callback) => callback(tx)) } as any, config());

    await expect(service.complete('raw-token', 'newpass123')).rejects.toMatchObject({ code: 'forbidden' });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.studentProfile.update).not.toHaveBeenCalled();
  });

  it('returns a safe error for invalid token', async () => {
    const service = new AccessTokenService({
      accessToken: { findUnique: vi.fn(async () => null) },
    } as any, config());

    await expect(service.verify('invalid-token')).rejects.toMatchObject({ code: 'validation_error', fieldErrors: { token: 'invalid' } });
  });
});
