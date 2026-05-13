/*
 * OGE Tutor App — DTO boundary tests.
 */
import { describe, expect, it } from 'vitest';
import { HOMEWORK_STATUS, LESSON_SOURCE, LESSON_STATUS, MATERIAL_SOURCE, MATERIAL_TYPE, ROLE } from '../src/api/contracts.js';
import { mapBackendResultDto, mapFileResourceDto, mapLessonDto } from '../src/api/dto.js';

describe('api dto mappers', () => {
  it('accepts raw file resource payloads returned by upload endpoints', () => {
    const file = mapFileResourceDto({ id: 'file-1', originalName: 'solution.pdf', mimeType: 'application/pdf', size: 100 });
    expect(file.id).toBe('file-1');
    expect(file.originalName).toBe('solution.pdf');
  });

  it('rejects invalid lesson status instead of silently defaulting', () => {
    expect(() => mapLessonDto({
      id: 'l-1',
      studentId: 's-1',
      startAt: '2026-05-15T10:00:00.000Z',
      endAt: '2026-05-15T11:00:00.000Z',
      status: 'Проведён',
      source: LESSON_SOURCE.MANUAL,
      materials: [],
    })).toThrow(/LessonDto/);
  });

  it('maps full backend bootstrap data with strict status values', () => {
    const result = mapBackendResultDto({
      session: { id: 't-1', role: ROLE.TEACHER, email: 'teacher@example.com', token: 'token' },
      data: {
        teacher: { id: 't-1', name: 'Teacher', email: 'teacher@example.com', settings: {} },
        students: [],
        lessons: [{ id: 'l-1', studentId: 's-1', startAt: '2026-05-15T10:00:00.000Z', endAt: '2026-05-15T11:00:00.000Z', status: LESSON_STATUS.PLANNED, source: LESSON_SOURCE.MANUAL, materials: [] }],
        homeworks: [{ id: 'hw-1', studentId: 's-1', dueAt: '2026-05-20T20:59:00.000Z', status: HOMEWORK_STATUS.ASSIGNED, materials: [], reviewMaterials: [], attempts: [] }],
        materials: [{ id: 'm-1', taskNumber: 1, title: 'Task 1', files: [{ id: 'a-1', type: MATERIAL_TYPE.LINK, source: MATERIAL_SOURCE.LINK, title: 'Link', url: 'https://example.com' }] }],
        notifications: [],
      },
    });

    expect(result.session.id).toBe('t-1');
    expect(result.data.lessons).toHaveLength(1);
    expect(result.data.homeworks).toHaveLength(1);
  });
});
