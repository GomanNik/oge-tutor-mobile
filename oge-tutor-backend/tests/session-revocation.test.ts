import { describe, expect, it, vi } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { AuthService } from '../src/auth/auth.service';
import { AuthController } from '../src/auth/auth.controller';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { TeacherService } from '../src/teacher/teacher.service';
import { StudentsService } from '../src/students/students.service';
import { ROLE } from '../src/common/contracts';

const config = { get: (key: string) => ({ JWT_SECRET: 'session-test-secret', JWT_EXPIRES_IN: '1h' })[key] } as any;

function fixture() {
  const user = { id: 'u-1', email: 'teacher@example.test', role: ROLE.TEACHER, sessionVersion: 0, passwordHash: 'original-hash', teacherProfile: { id: 't-1' }, studentProfile: null as any };
  const sessions = new Map<string, any>();
  const prisma = {
    user: {
      findUnique: vi.fn(async () => ({ ...user })),
      update: vi.fn(async ({ data }) => {
        user.passwordHash = data.passwordHash;
        user.sessionVersion += data.sessionVersion.increment;
        for (const session of sessions.values()) if (session.userId === user.id) session.revokedAt = data.sessions.updateMany.data.revokedAt;
        return user;
      }),
    },
    authSession: {
      create: vi.fn(async ({ data }) => { sessions.set(data.id, { ...data, revokedAt: null }); return data; }),
      findUnique: vi.fn(async ({ where }) => sessions.has(where.id) ? { ...sessions.get(where.id), user } : null),
      updateMany: vi.fn(async ({ where, data }) => {
        const session = sessions.get(where.id);
        if (session?.userId === where.userId && !session.revokedAt) Object.assign(session, data);
        return { count: session ? 1 : 0 };
      }),
    },
    teacherProfile: { findUnique: vi.fn(async () => ({ id: 't-1', userId: user.id, user })) },
    studentProfile: { findUnique: vi.fn(async () => ({ id: 's-1', userId: user.id, user })) },
  };
  const jwt = new JwtService();
  const auth = new AuthService(prisma as any, jwt, config, {} as any, {} as any);
  const strategy = new JwtStrategy(config, prisma as any);
  return { user, sessions, prisma, jwt, auth, strategy };
}

describe('persisted JWT sessions', () => {
  it('persists a distinct session per login, matches JWT expiry, and preserves the public session shape', async () => {
    const f = fixture();
    const first = await f.auth.signSession(f.user);
    const second = await f.auth.signSession(f.user);
    const payload = f.jwt.verify(first.token, { secret: 'session-test-secret' });
    expect(Object.keys(first).sort()).toEqual(['email', 'id', 'role', 'token', 'userId']);
    expect(first.id).toBe('t-1');
    expect(f.sessions.size).toBe(2);
    expect(first.token).not.toBe(second.token);
    expect(f.sessions.get(payload.sid)).toMatchObject({ userId: f.user.id, expiresAt: new Date(payload.exp * 1000), version: 0 });
    await expect(f.strategy.validate(payload)).resolves.toMatchObject({ id: f.user.id, sessionId: payload.sid });
  });

  it('logout revokes only the calling session, and replay fails', async () => {
    const f = fixture();
    const first = f.jwt.decode((await f.auth.signSession(f.user)).token);
    const second = f.jwt.decode((await f.auth.signSession(f.user)).token);
    const controller = new AuthController(f.auth, {} as any, {} as any);
    const principal = await f.strategy.validate(first);
    await expect(controller.logout(principal)).resolves.toEqual({ session: null });
    await expect(f.strategy.validate(first)).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(f.strategy.validate(second)).resolves.toMatchObject({ id: f.user.id });
  });

  it.each([{}, { sub: 'u-1' }, { sub: 'u-1', sid: '' }, { sub: 'u-1', sid: 42 }, { sub: 42, sid: 's' }, { sub: 'u-1', sid: 'unknown' }])('rejects legacy, malformed, and unknown session claims: %j', async (payload) => {
    await expect(fixture().strategy.validate(payload)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it.each(['expired', 'foreign', 'revoked', 'old-version', 'disabled'])('rejects a %s session', async (reason) => {
    const f = fixture();
    const payload = f.jwt.decode((await f.auth.signSession(f.user)).token);
    const session = f.sessions.get(payload.sid);
    if (reason === 'expired') session.expiresAt = new Date(Date.now() - 1);
    if (reason === 'foreign') session.userId = 'another-user';
    if (reason === 'revoked') session.revokedAt = new Date();
    if (reason === 'old-version') f.user.sessionVersion++;
    if (reason === 'disabled') Object.assign(f.user, { role: ROLE.STUDENT, studentProfile: { id: 's-1', access: 'disabled' } });
    await expect(f.strategy.validate(payload)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects credentials validated before a password change', async () => {
    const f = fixture();
    const beforeChange = { ...f.user };
    f.user.passwordHash = 'changed';
    await expect(f.auth.signSession(beforeChange)).rejects.toMatchObject({ code: 'unauthorized' });
    expect(f.sessions.size).toBe(0);
  });

  it('invalidates a session inserted concurrently after password revocation', async () => {
    const f = fixture();
    f.prisma.authSession.create.mockImplementationOnce(async ({ data }) => {
      f.user.sessionVersion++;
      f.sessions.set(data.id, { ...data, revokedAt: null });
      return data;
    });
    const payload = f.jwt.decode((await f.auth.signSession(f.user)).token);
    await expect(f.strategy.validate(payload)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it.each(['teacher', 'student'])('%s password change revokes all sessions in the password update', async (kind) => {
    const f = fixture();
    f.user.passwordHash = await bcrypt.hash('old-password', 4);
    const first = f.jwt.decode((await f.auth.signSession(f.user)).token);
    const second = f.jwt.decode((await f.auth.signSession(f.user)).token);
    const payload = { currentPassword: 'old-password', newPassword: 'new-password' };
    if (kind === 'teacher') {
      await new TeacherService(f.prisma as any).changePassword({ ...f.user, teacherId: 't-1' }, payload);
    } else {
      await new StudentsService(f.prisma as any, {} as any, {} as any).changePassword({ ...f.user, role: ROLE.STUDENT, studentId: 's-1' }, 's-1', payload);
    }
    expect(f.prisma.user.update).toHaveBeenCalledTimes(1);
    await expect(bcrypt.compare('new-password', f.user.passwordHash)).resolves.toBe(true);
    await expect(f.strategy.validate(first)).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(f.strategy.validate(second)).rejects.toMatchObject({ code: 'unauthorized' });
  });
});
