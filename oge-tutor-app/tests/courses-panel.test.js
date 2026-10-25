import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CoursesPanel from '../src/workspace/CoursesPanel.jsx';

const admin = { workspaceId: 'space-a', role: 'admin' };
const course = {
  id: 'course-a', workspaceId: 'space-a', programVersionId: 'version-a',
  program: { id: 'program-a', name: 'ЕГЭ · физика', subjectName: 'Физика', examType: 'ege', variant: 'profile', period: '2027', revisionNumber: 1 },
  title: 'Группа А', defaultFormat: 'group', capacity: 3, startsOn: '2026-10-01', endsOn: '2027-06-01',
  timezone: 'Asia/Omsk', status: 'active', revision: 1, activeEnrollmentCount: 1, legacy: false,
};
const page = items => ({ items, total: items.length, page: 1, pageSize: 25 });
const member = (id, name, role) => ({ id: `membership-${id}`, userId: id, displayName: name, email: `${id}@example.com`, roles: [role], status: 'active' });

function api(overrides = {}) {
  return {
    courses: vi.fn(async () => page([course])),
    course: vi.fn(async () => ({ item: course })),
    courseTeachers: vi.fn(async () => ({ items: [{ id: 'link-a', teacherUserId: 'teacher-a', displayName: 'Анна', role: 'lead', status: 'active', startsOn: '2026-10-01', endsOn: null, revision: 0 }], total: 1 })),
    courseEnrollments: vi.fn(async () => ({ items: [{ id: 'enrollment-a', studentUserId: 'student-a', displayName: 'Иван', status: 'active', startsOn: '2026-10-01', endsOn: null, goal: '', note: '', revision: 0 }], total: 1 })),
    lessons: vi.fn(async () => page([])),
    members: vi.fn(async (_, query) => ({ items: query.role === 'teacher' ? [member('teacher-a', 'Анна', 'teacher')] : [member('student-a', 'Иван', 'student'), member('student-b', 'Мария', 'student')], pageInfo: { nextCursor: null, hasMore: false } })),
    programs: vi.fn(async () => page([{ id: 'program-a', name: 'ЕГЭ · физика', examType: 'ege', variant: 'profile', status: 'active' }])),
    versions: vi.fn(async () => page([{ id: 'version-a', period: '2027', revisionNumber: 1, status: 'published' }])),
    createCourse: vi.fn(async () => ({ item: course })),
    previewEnrollmentBatch: vi.fn(async (_, body) => ({ courseId: body.courseId, status: body.status, availableSeats: 2, canApply: true, items: body.studentUserIds.map(studentUserId => ({ studentUserId, displayName: 'Мария', eligible: true, reason: null })) })),
    applyEnrollmentBatch: vi.fn(async () => ({ appliedCount: 1 })),
    ...overrides,
  };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('CoursesPanel', () => {
  it('creates a course only from a selected published version and lead teacher', async () => {
    const client = api({ courses: vi.fn(async () => page([])) });
    render(React.createElement(CoursesPanel, { api: client, context: admin, onAccessError: vi.fn(), onLegacy: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать курс' }));
    const form = within(screen.getByRole('region', { name: 'Новый курс' }));
    await screen.findByRole('option', { name: 'ЕГЭ · физика · EGE · profile' });
    fireEvent.change(screen.getByLabelText('Программа'), { target: { value: 'program-a' } });
    await screen.findByRole('option', { name: '2027 · редакция 1' });
    fireEvent.change(screen.getByLabelText('Версия'), { target: { value: 'version-a' } });
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Группа А' } });
    fireEvent.change(form.getByLabelText('Формат'), { target: { value: 'group' } });
    fireEvent.change(screen.getByLabelText('Окончание'), { target: { value: '2027-06-01' } });
    await screen.findByRole('option', { name: 'Анна · teacher-a@example.com' });
    fireEvent.change(screen.getByLabelText('Участник'), { target: { value: 'teacher-a' } });
    fireEvent.click(form.getByRole('button', { name: 'Создать курс' }));
    await waitFor(() => expect(client.createCourse).toHaveBeenCalledWith(admin, expect.objectContaining({ programVersionId: 'version-a', leadTeacherUserId: 'teacher-a', defaultFormat: 'group' })));
  });

  it('keeps the student course view read-only', async () => {
    const client = api({ courseEnrollments: vi.fn(async () => ({ items: [{ id: 'enrollment-a', studentUserId: 'student-a', displayName: 'Иван', status: 'active', startsOn: '2026-10-01', endsOn: null, goal: '', revision: 0 }], total: 1 })) });
    render(React.createElement(CoursesPanel, { api: client, context: { workspaceId: 'space-a', role: 'student' }, onAccessError: vi.fn(), onLegacy: vi.fn() }));
    await screen.findByText('Группа А');
    expect(screen.queryByRole('button', { name: 'Создать курс' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    await screen.findByRole('heading', { name: 'Моё участие' });
    expect(await screen.findByText('Иван')).toBeTruthy();
    expect(screen.queryByText('Мария')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Добавить' })).toBeNull();
  });

  it('previews and applies an atomic batch from the course roster', async () => {
    const client = api();
    render(React.createElement(CoursesPanel, { api: client, context: admin, onAccessError: vi.fn(), onLegacy: vi.fn() }));
    await screen.findByText('Группа А');
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    await screen.findByRole('heading', { name: 'Массовый набор' });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Мария' }));
    fireEvent.click(screen.getByRole('button', { name: 'Проверить набор' }));
    await waitFor(() => expect(client.previewEnrollmentBatch).toHaveBeenCalledWith(admin, { courseId: 'course-a', studentUserIds: ['student-b'], status: 'active' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Зачислить всех' }));
    await waitFor(() => expect(client.applyEnrollmentBatch).toHaveBeenCalledWith(admin, { courseId: 'course-a', studentUserIds: ['student-b'], status: 'active' }));
  });
});
