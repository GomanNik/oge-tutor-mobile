import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LessonsPanel from '../src/workspace/LessonsPanel.jsx';

const context = { workspaceId: 'space-a', role: 'admin' };
const course = { id: 'course-a', title: 'Группа А', defaultFormat: 'group', status: 'active', legacy: false };
const startAt = new Date(Date.now() + 3 * 86400000).toISOString();
const endAt = new Date(Date.now() + 3 * 86400000 + 3600000).toISOString();
const teacher = { id: 'link-a', displayName: 'Анна', role: 'lead', status: 'active' };
const students = [
  { id: 'enrollment-a', displayName: 'Иван', status: 'active' },
  { id: 'enrollment-b', displayName: 'Мария', status: 'active' },
];
const lesson = {
  id: 'lesson-a', courseId: course.id, courseTitle: course.title, topic: 'Уравнения', startAt, endAt,
  timezone: 'UTC', format: 'group', status: 'planned', revision: 0, completedAt: null, legacy: false,
  note: 'Командная заметка', completionComment: '',
  teachers: [{ courseTeacherId: teacher.id, userId: 'teacher-a', displayName: teacher.displayName, role: 'lead' }],
  participants: students.map(student => ({ enrollmentId: student.id, userId: student.id, displayName: student.displayName, responseStatus: 'invited', attendance: 'unknown' })),
};

function api(items = []) {
  return {
    lessons: vi.fn(async () => ({ items, total: items.length, page: 1, pageSize: 25 })),
    courseTeachers: vi.fn(async () => ({ items: [teacher], total: 1 })),
    courseEnrollments: vi.fn(async () => ({ items: students, total: 2 })),
    previewLesson: vi.fn(async () => ({ canCreate: true, conflicts: [], participantCount: 2, teacherCount: 1 })),
    createLesson: vi.fn(async () => ({ item: lesson })),
    cancelLesson: vi.fn(async () => ({ item: { ...lesson, status: 'canceled' } })),
  };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('LessonsPanel', () => {
  it('previews and schedules a group lesson with selected participants', async () => {
    const client = api();
    render(React.createElement(LessonsPanel, { api: client, context, course, onAccessError: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: 'Запланировать' }));
    const form = within(await screen.findByRole('form', { name: 'Новое занятие' }));
    fireEvent.change(form.getByLabelText('Тема'), { target: { value: 'Уравнения' } });
    fireEvent.click(form.getByRole('checkbox', { name: 'Иван' }));
    fireEvent.click(form.getByRole('checkbox', { name: 'Мария' }));
    fireEvent.click(form.getByRole('button', { name: 'Проверить время' }));
    await screen.findByText('Время свободно');
    fireEvent.click(form.getByRole('button', { name: 'Запланировать' }));
    await waitFor(() => expect(client.createLesson).toHaveBeenCalledWith(context, expect.objectContaining({
      courseId: course.id, topic: 'Уравнения', teacherLinkIds: [teacher.id], participantEnrollmentIds: students.map(item => item.id),
    })));
  });

  it('requires a reason when cancelling and keeps student actions read-only', async () => {
    const client = api([lesson]);
    render(React.createElement(LessonsPanel, { api: client, context, course, onAccessError: vi.fn() }));
    fireEvent.click(await screen.findByRole('button', { name: 'Подробнее' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(screen.getByRole('button', { name: 'Подтвердить отмену' }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Причина отмены'), { target: { value: 'Изменилось расписание' } });
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить отмену' }));
    await waitFor(() => expect(client.cancelLesson).toHaveBeenCalledWith(context, lesson, 'Изменилось расписание'));
    cleanup();
    const studentView = { ...lesson, note: undefined, completionComment: undefined, participants: [
      { enrollmentId: students[0].id, responseStatus: 'invited', attendance: 'unknown' },
    ] };
    render(React.createElement(LessonsPanel, { api: api([studentView]), context: { ...context, role: 'student' }, course, onAccessError: vi.fn() }));
    expect(screen.queryByRole('button', { name: 'Запланировать' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Подробнее' }));
    expect(screen.queryByText('Командная заметка')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Изменить' })).toBeNull();
  });
});
