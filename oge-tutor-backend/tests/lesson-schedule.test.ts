import { describe, expect, it, vi } from 'vitest';
import { lessonConflicts } from '../src/course-lessons/lesson-schedule';

const start = new Date('2026-11-01T12:00:00.000Z');
const end = new Date('2026-11-01T13:00:00.000Z');

describe('cross-role lesson conflicts', () => {
  it('blocks a selected teacher who is already a student elsewhere', async () => {
    const tx = { lesson: { findMany: vi.fn(async () => [{
      lessonTeachers: [], participants: [{ enrollment: { membership: { userId: 'multi-role-user' } } }],
    }]) } };
    await expect(lessonConflicts(tx as never, start, end, ['multi-role-user'], [])).resolves.toEqual([
      { userId: 'multi-role-user', kind: 'teacher' },
    ]);
  });

  it('blocks a selected student who is already teaching elsewhere', async () => {
    const tx = { lesson: { findMany: vi.fn(async () => [{
      lessonTeachers: [{ courseTeacher: { membership: { userId: 'multi-role-user' } } }], participants: [],
    }]) } };
    await expect(lessonConflicts(tx as never, start, end, [], ['multi-role-user'])).resolves.toEqual([
      { userId: 'multi-role-user', kind: 'student' },
    ]);
  });

  it('checks all overlapping lessons without an arbitrary row cap', async () => {
    const findMany = vi.fn(async () => []);
    await lessonConflicts({ lesson: { findMany } } as never, start, end, ['teacher'], ['student']);
    expect(findMany).toHaveBeenCalledWith(expect.not.objectContaining({ take: expect.any(Number) }));
  });
});
