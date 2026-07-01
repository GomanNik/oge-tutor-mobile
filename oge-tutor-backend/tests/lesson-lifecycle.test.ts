import { describe, expect, it, vi } from 'vitest';
import { LessonsService } from '../src/lessons/lessons.service';
import { LESSON_STATUS, ROLE } from '../src/common/contracts';

const teacher = { id: 'u-teacher', role: ROLE.TEACHER, teacherId: 't-1', email: 'teacher@mail.ru' };

function future(minutes = 60) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function lessonService(prisma: any) {
  return new LessonsService(prisma, { normalizeEmbeddedAttachments: vi.fn(async (_user, value) => value || []) } as any);
}

describe('lesson lifecycle guards', () => {
  it('rejects creating a lesson in the past', async () => {
    const prisma = { studentProfile: { findFirst: vi.fn(async () => ({ id: 's-1' })) } };
    await expect(lessonService(prisma).create(teacher, {
      studentId: 's-1',
      topic: 'Past',
      startAt: new Date(Date.now() - 60_000).toISOString(),
      endAt: future(60),
    })).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('checks conflicts only against active lessons, so completed lessons do not block new schedule', async () => {
    let conflictWhere: any;
    const prisma = {
      studentProfile: { findFirst: vi.fn(async () => ({ id: 's-1' })) },
      lesson: {
        findFirst: vi.fn(async ({ where }) => {
          conflictWhere = where;
          return null;
        }),
        create: vi.fn(async ({ data }) => ({ id: 'l-1', ...data })),
      },
    };
    await lessonService(prisma).create(teacher, {
      studentId: 's-1',
      topic: 'Future',
      startAt: future(60),
      endAt: future(120),
    });
    expect(conflictWhere.status).toEqual({ in: [LESSON_STATUS.PLANNED, LESSON_STATUS.RESCHEDULED] });
  });

  it('rejects completing canceled and already completed lessons', async () => {
    for (const status of [LESSON_STATUS.CANCELED, LESSON_STATUS.COMPLETED]) {
      const prisma = {
        lesson: { findFirst: vi.fn(async () => ({ id: 'l-1', teacherId: 't-1', studentId: 's-1', status, focusTaskNumbers: [6] })) },
      };
      await expect(lessonService(prisma).complete(teacher, 'l-1', { focusTaskNumbers: [6] })).rejects.toMatchObject({ code: 'conflict' });
    }
  });

  it('creates progress history once for a valid complete call', async () => {
    const tx = {
      lesson: { update: vi.fn(async () => ({})) },
      studentTaskProgress: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async () => ({ id: 'progress-1' })),
      },
      progressHistory: { create: vi.fn(async () => ({})) },
      notification: { create: vi.fn(async () => ({})) },
    };
    const prisma = {
      lesson: { findFirst: vi.fn(async () => ({ id: 'l-1', teacherId: 't-1', studentId: 's-1', status: LESSON_STATUS.PLANNED, focusTaskNumbers: [6] })) },
      $transaction: vi.fn(async (callback) => callback(tx)),
    };
    await lessonService(prisma).complete(teacher, 'l-1', { focusTaskNumbers: [6] });
    expect(tx.progressHistory.create).toHaveBeenCalledTimes(1);
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
  });
});
