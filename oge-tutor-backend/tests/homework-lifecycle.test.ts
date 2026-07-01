import { describe, expect, it, vi } from 'vitest';
import { HomeworksService } from '../src/homeworks/homeworks.service';
import { HOMEWORK_STATUS, ROLE, SUBMISSION_STATUS } from '../src/common/contracts';

const teacher = { id: 'u-teacher', role: ROLE.TEACHER, teacherId: 't-1', email: 'teacher@mail.ru' };
const student = { id: 'u-student', role: ROLE.STUDENT, studentId: 's-1', teacherId: 't-1', email: 'student@mail.ru' };

function service(prisma: any, files: any = {}) {
  return new HomeworksService(prisma, {
    saveUploadedFile: vi.fn(async () => ({ id: 'file-1', originalName: 'solution.pdf' })),
    normalizeEmbeddedAttachments: vi.fn(async (_user, value) => value || []),
    ...files,
  } as any);
}

describe('homework lifecycle guards', () => {
  it('fills topic from task numbers when frontend does not send topic', async () => {
    const create = vi.fn(async ({ data }) => ({ id: 'hw-1', ...data }));
    const prisma = {
      studentProfile: { findFirst: vi.fn(async () => ({ id: 's-1' })) },
      homework: { create },
    };
    const result = await service(prisma).create(teacher, {
      studentId: 's-1',
      title: 'Домашка',
      taskNumbers: [6, 7],
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(result.topic).toBe('Задания 6, 7');
  });

  it('rejects editing submitted or reviewed homework and forbids direct status patch', async () => {
    const prisma = {
      homework: { findFirst: vi.fn(async () => ({ id: 'hw-1', teacherId: 't-1', status: HOMEWORK_STATUS.SUBMITTED })) },
    };
    await expect(service(prisma).update(teacher, 'hw-1', { title: 'New' })).rejects.toMatchObject({ code: 'conflict' });

    prisma.homework.findFirst = vi.fn(async () => ({ id: 'hw-1', teacherId: 't-1', status: HOMEWORK_STATUS.ASSIGNED, studentId: 's-1', dueAt: new Date() }));
    await expect(service(prisma).update(teacher, 'hw-1', { status: HOMEWORK_STATUS.REVIEWED })).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('rejects submit for reviewed homework and for another student homework', async () => {
    const reviewedPrisma = {
      homework: { findFirst: vi.fn(async () => ({ id: 'hw-1', studentId: 's-1', status: HOMEWORK_STATUS.REVIEWED })) },
    };
    await expect(service(reviewedPrisma).submit(student, 'hw-1', { originalname: 'solution.pdf' } as any)).rejects.toMatchObject({ code: 'conflict' });

    const foreignPrisma = {
      homework: { findFirst: vi.fn(async () => null) },
    };
    await expect(service(foreignPrisma).submit({ ...student, studentId: 's-other' }, 'hw-1', { originalname: 'solution.pdf' } as any)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects review for assigned homework and submitted homework without submission', async () => {
    const assignedPrisma = {
      homework: { findFirst: vi.fn(async () => ({ id: 'hw-1', teacherId: 't-1', status: HOMEWORK_STATUS.ASSIGNED })) },
    };
    await expect(service(assignedPrisma).review(teacher, 'hw-1', { status: HOMEWORK_STATUS.REVIEWED })).rejects.toMatchObject({ code: 'conflict' });

    const submittedNoAttemptPrisma = {
      homework: { findFirst: vi.fn(async () => ({ id: 'hw-1', teacherId: 't-1', studentId: 's-1', status: HOMEWORK_STATUS.SUBMITTED, solutionFile: 'solution.pdf', taskNumbers: [6] })) },
      $transaction: vi.fn(async (callback) => callback({
        homeworkSubmission: { findFirst: vi.fn(async () => null) },
      })),
    };
    await expect(service(submittedNoAttemptPrisma).review(teacher, 'hw-1', { status: HOMEWORK_STATUS.REVIEWED })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('does not let a teacher review another teacher homework', async () => {
    const prisma = {
      homework: { findFirst: vi.fn(async () => null) },
    };
    await expect(service(prisma).review(teacher, 'foreign-hw', { status: HOMEWORK_STATUS.REVIEWED })).rejects.toMatchObject({ code: 'not_found' });
    expect(prisma.homework.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign-hw', teacherId: 't-1' } });
  });

  it('allows correct submit and review flow for teacher owner', async () => {
    const tx = {
      homeworkSubmission: {
        create: vi.fn(async () => ({})),
        findFirst: vi.fn(async () => ({ id: 'attempt-1' })),
        update: vi.fn(async () => ({})),
      },
      homework: { update: vi.fn(async () => ({})) },
      studentTaskProgress: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async () => ({ id: 'progress-1' })),
      },
      progressHistory: { create: vi.fn(async () => ({})) },
      notification: { create: vi.fn(async () => ({})) },
    };
    const prisma = {
      homework: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({ id: 'hw-1', studentId: 's-1', status: HOMEWORK_STATUS.ASSIGNED })
          .mockResolvedValueOnce({ id: 'hw-1', teacherId: 't-1', studentId: 's-1', status: HOMEWORK_STATUS.SUBMITTED, solutionFile: 'solution.pdf', taskNumbers: [6] }),
      },
      $transaction: vi.fn(async (callback) => callback(tx)),
    };

    await service(prisma).submit(student, 'hw-1', { originalname: 'solution.pdf' } as any, { fileTitle: 'my-solution.pdf' });
    await service(prisma).review(teacher, 'hw-1', { status: HOMEWORK_STATUS.REVIEWED, comment: 'ok' });

    expect(tx.homeworkSubmission.create).toHaveBeenCalled();
    expect(tx.homework.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ solutionFile: 'my-solution.pdf' }) }));
    expect(tx.homeworkSubmission.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reviewStatus: SUBMISSION_STATUS.REVIEWED }) }));
    expect(tx.progressHistory.create).toHaveBeenCalledTimes(1);
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
  });
});
