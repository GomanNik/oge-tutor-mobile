import { describe, expect, it, vi } from 'vitest';
import { AuthController } from '../src/auth/auth.controller';
import { FilesController } from '../src/files/files.controller';
import { LessonsController } from '../src/lessons/lessons.controller';
import { TeacherController } from '../src/teacher/teacher.controller';
import { ROLE } from '../src/common/contracts';

const teacherUser = { id: 'u-teacher', role: ROLE.TEACHER, teacherId: 't-1', email: 'teacher@mail.ru' };

describe('mutation response envelope contract', () => {
  it('resource mutations return data envelope for frontend store replacement', async () => {
    const bootstrap = { buildForUser: vi.fn(async () => ({ teacher: { id: 't-1' }, students: [] })) };
    const lessons = new LessonsController({ create: vi.fn(), update: vi.fn(), complete: vi.fn() } as any, bootstrap as any);

    await expect(lessons.create(teacherUser as any, { studentId: 's-1' } as any))
      .resolves.toEqual({ data: { teacher: { id: 't-1' }, students: [] } });
  });

  it('command-only mutations return ok envelope', async () => {
    const teacher = new TeacherController({ changePassword: vi.fn() } as any, { buildForUser: vi.fn() } as any);

    await expect(teacher.changePassword(teacherUser as any, { currentPassword: 'oldpass', newPassword: 'newpass' }))
      .resolves.toEqual({ ok: true });
  });

  it('auth login returns session plus data envelope', async () => {
    const auth = new AuthController(
      {
        validateCredentials: vi.fn(async () => ({ id: 'u-teacher', email: 'teacher@mail.ru', role: ROLE.TEACHER })),
        signSession: vi.fn(async () => ({ id: 't-1', userId: 'u-teacher', role: ROLE.TEACHER, email: 'teacher@mail.ru', token: 'jwt' })),
      } as any,
      { verify: vi.fn(), complete: vi.fn() } as any,
      { buildForUser: vi.fn(async () => ({ teacher: { id: 't-1' } })) } as any,
    );

    await expect(auth.login({ email: 'teacher@mail.ru', password: 'secret123' }))
      .resolves.toEqual({ session: { id: 't-1', userId: 'u-teacher', role: ROLE.TEACHER, email: 'teacher@mail.ru', token: 'jwt' }, data: { teacher: { id: 't-1' } } });
  });

  it('file upload returns fileResource envelope', async () => {
    const files = new FilesController({
      saveUploadedFile: vi.fn(async () => ({ id: 'f-1', originalName: 'file.pdf' })),
      mapFile: vi.fn(() => ({ id: 'f-1', originalName: 'file.pdf' })),
    } as any);

    await expect(files.upload(teacherUser as any, { originalname: 'file.pdf' } as any, {} as any))
      .resolves.toEqual({ fileResource: { id: 'f-1', originalName: 'file.pdf' } });
  });
});
