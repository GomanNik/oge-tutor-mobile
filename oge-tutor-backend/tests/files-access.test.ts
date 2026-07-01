import { describe, expect, it, vi } from 'vitest';
import { FilesService } from '../src/files/files.service';
import { ROLE } from '../src/common/contracts';

function service(file: any, studentLookup: any) {
  return new FilesService({
    fileResource: { findUnique: vi.fn(async () => file) },
    studentProfile: { findFirst: vi.fn(async () => studentLookup) },
  } as any, { get: vi.fn() } as any);
}

describe('file ownership and IDOR guards', () => {
  it('allows student to access own file and denies another student file', async () => {
    await expect(service({ id: 'f-1', ownerId: 'u-a' }, null).requireAccessibleFile({ id: 'u-a', role: ROLE.STUDENT, studentId: 's-a', email: 'a@mail.ru' }, 'f-1')).resolves.toMatchObject({ id: 'f-1' });
    await expect(service({ id: 'f-2', ownerId: 'u-b' }, { id: 's-a', teacher: { userId: 'u-teacher-a' } }).requireAccessibleFile({ id: 'u-a', role: ROLE.STUDENT, studentId: 's-a', email: 'a@mail.ru' }, 'f-2')).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('allows teacher to access own student file and denies foreign student file', async () => {
    await expect(service({ id: 'f-1', ownerId: 'u-student' }, { id: 's-1' }).requireAccessibleFile({ id: 'u-teacher', role: ROLE.TEACHER, teacherId: 't-1', email: 'teacher@mail.ru' }, 'f-1')).resolves.toMatchObject({ id: 'f-1' });
    await expect(service({ id: 'f-2', ownerId: 'u-foreign' }, null).requireAccessibleFile({ id: 'u-teacher', role: ROLE.TEACHER, teacherId: 't-1', email: 'teacher@mail.ru' }, 'f-2')).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('denies ownerless files instead of making them globally attachable', async () => {
    await expect(service({ id: 'f-ownerless', ownerId: null }, null).requireAccessibleFile({ id: 'u-a', role: ROLE.STUDENT, studentId: 's-a', email: 'a@mail.ru' }, 'f-ownerless')).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('allows a student to access files owned by their teacher for assigned materials', async () => {
    await expect(service({ id: 'f-teacher', ownerId: 'u-teacher' }, { id: 's-a', teacher: { userId: 'u-teacher' } }).requireAccessibleFile({ id: 'u-a', role: ROLE.STUDENT, studentId: 's-a', email: 'a@mail.ru' }, 'f-teacher')).resolves.toMatchObject({ id: 'f-teacher' });
  });
});
