import { describe, expect, it, vi } from 'vitest';
import { FilesService } from '../src/files/files.service';
import { FILE_SCOPE, ROLE } from '../src/common/contracts';

function file(overrides: any = {}) {
  return {
    id: 'f-1',
    ownerId: 'u-owner',
    scope: FILE_SCOPE.PRIVATE_UPLOAD,
    originalName: 'file.pdf',
    mimeType: 'application/pdf',
    size: 100,
    storagePath: 'missing.pdf',
    uploadedAt: new Date(),
    ...overrides,
  };
}

function service(options: {
  file?: any;
  teacherStudentOwner?: any;
  currentStudent?: any;
  lessons?: any[];
  homeworks?: any[];
  materialAttachment?: any;
} = {}) {
  return new FilesService({
    fileResource: {
      findUnique: vi.fn(async () => options.file ?? file()),
      update: vi.fn(async ({ data }) => ({ ...(options.file ?? file()), ...data })),
    },
    studentProfile: {
      findFirst: vi.fn(async ({ where }) => {
        if (where.userId && where.teacherId) return options.teacherStudentOwner ?? null;
        if (where.id && where.userId) return options.currentStudent ?? null;
        return null;
      }),
    },
    lesson: {
      findMany: vi.fn(async () => options.lessons ?? []),
    },
    homework: {
      findMany: vi.fn(async () => options.homeworks ?? []),
    },
    materialAttachment: {
      findFirst: vi.fn(async () => options.materialAttachment ?? null),
    },
  } as any, { get: vi.fn() } as any);
}

describe('file ownership and IDOR guards', () => {
  it('student A cannot download student B file', async () => {
    await expect(service({
      file: file({ id: 'f-b', ownerId: 'u-b', scope: FILE_SCOPE.PRIVATE_SUBMISSION }),
      currentStudent: { id: 's-a', teacherId: 't-a' },
    }).requireAccessibleFile({ id: 'u-a', role: ROLE.STUDENT, studentId: 's-a', email: 'a@mail.ru' }, 'f-b'))
      .rejects.toMatchObject({ code: 'forbidden' });
  });

  it('teacher cannot download a foreign student file', async () => {
    await expect(service({
      file: file({ id: 'f-foreign', ownerId: 'u-foreign-student', scope: FILE_SCOPE.PRIVATE_SUBMISSION }),
      teacherStudentOwner: null,
    }).requireAccessibleFile({ id: 'u-teacher', role: ROLE.TEACHER, teacherId: 't-1', email: 'teacher@mail.ru' }, 'f-foreign'))
      .rejects.toMatchObject({ code: 'forbidden' });
  });

  it('teacher can download own student file', async () => {
    await expect(service({
      file: file({ id: 'f-student', ownerId: 'u-student', scope: FILE_SCOPE.PRIVATE_SUBMISSION }),
      teacherStudentOwner: { id: 's-1' },
    }).requireAccessibleFile({ id: 'u-teacher', role: ROLE.TEACHER, teacherId: 't-1', email: 'teacher@mail.ru' }, 'f-student'))
      .resolves.toMatchObject({ id: 'f-student' });
  });

  it('student can download own submission', async () => {
    await expect(service({
      file: file({ id: 'f-own', ownerId: 'u-a', scope: FILE_SCOPE.PRIVATE_SUBMISSION }),
    }).requireAccessibleFile({ id: 'u-a', role: ROLE.STUDENT, studentId: 's-a', email: 'a@mail.ru' }, 'f-own'))
      .resolves.toMatchObject({ id: 'f-own' });
  });

  it('student can download assigned material from topic tasks', async () => {
    await expect(service({
      file: file({ id: 'f-material', ownerId: 'u-teacher', scope: FILE_SCOPE.TEACHER_MATERIAL }),
      currentStudent: { id: 's-a', teacherId: 't-a' },
      lessons: [{ focusTaskNumbers: [6], materials: [] }],
      homeworks: [],
      materialAttachment: { id: 'ma-1' },
    }).requireAccessibleFile({ id: 'u-a', role: ROLE.STUDENT, studentId: 's-a', email: 'a@mail.ru' }, 'f-material'))
      .resolves.toMatchObject({ id: 'f-material' });
  });

  it('student cannot download unassigned teacher material', async () => {
    await expect(service({
      file: file({ id: 'f-material', ownerId: 'u-teacher', scope: FILE_SCOPE.TEACHER_MATERIAL }),
      currentStudent: { id: 's-a', teacherId: 't-a' },
      lessons: [{ focusTaskNumbers: [6], materials: [] }],
      homeworks: [],
      materialAttachment: null,
    }).requireAccessibleFile({ id: 'u-a', role: ROLE.STUDENT, studentId: 's-a', email: 'a@mail.ru' }, 'f-material'))
      .rejects.toMatchObject({ code: 'forbidden' });
  });

  it('does not allow attaching another user private file', async () => {
    await expect(service({
      file: file({ id: 'f-private', ownerId: 'u-other', scope: FILE_SCOPE.PRIVATE_UPLOAD }),
    }).requireAttachableFile({ id: 'u-teacher', role: ROLE.TEACHER, teacherId: 't-1', email: 'teacher@mail.ru' }, 'f-private'))
      .rejects.toMatchObject({ code: 'forbidden' });
  });

  it('does not allow attaching own submission file as material', async () => {
    await expect(service({
      file: file({ id: 'f-submission', ownerId: 'u-a', scope: FILE_SCOPE.PRIVATE_SUBMISSION }),
    }).requireAttachableFile({ id: 'u-a', role: ROLE.STUDENT, studentId: 's-a', email: 'a@mail.ru' }, 'f-submission'))
      .rejects.toMatchObject({ code: 'forbidden' });
  });
});
