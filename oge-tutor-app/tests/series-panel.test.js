import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SeriesForm, SeriesPreview } from '../src/workspace/SeriesPanel.jsx';
import { legacyIsReadOnly } from '../src/workspace/legacyPolicy.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function fixture() {
  const preview = { canApply: true, occurrences: [{ key: '2030-01-01', startAt: '2030-01-01T12:00:00Z' }], cancelLessons: [], preservedCount: 0, issues: [], previewToken: 'signed-preview' };
  const api = { previewSeries: vi.fn().mockResolvedValue(preview), saveSeries: vi.fn().mockResolvedValue({ item: { id: 'series' } }) };
  const onSaved = vi.fn();
  const props = { api, context: { workspaceId: 'w', role: 'teacher' }, course: { id: 'course', timezone: 'UTC', defaultFormat: 'group' },
    teachers: [{ id: 'teacher', displayName: 'Преподаватель', status: 'active', role: 'lead' }], enrollments: [{ id: 'student', displayName: 'Ученик', status: 'active' }], onSaved, onClose: vi.fn(), onAccessError: vi.fn() };
  render(React.createElement(SeriesForm, props));
  fireEvent.change(screen.getByRole('textbox', { name: 'Тема' }), { target: { value: 'Алгебра' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Ученик' }));
  return { api, onSaved, preview };
}
describe('series confirmation workflow', () => {
  it('requires preview and invalidates it whenever the rule or roster changes', async () => {
    const { api } = fixture();
    const save = screen.getByRole('button', { name: 'Создать серию' });
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр серии' }));
    await waitFor(() => expect(save.disabled).toBe(false));
    expect(api.previewSeries.mock.calls[0][1]).toMatchObject({ courseId: 'course', teacherLinkIds: ['teacher'], participantEnrollmentIds: ['student'] });
    fireEvent.change(screen.getByRole('textbox', { name: 'Тема' }), { target: { value: 'Геометрия' } });
    expect(save.disabled).toBe(true);
    expect(screen.queryByRole('heading', { name: 'Пакет готов' })).toBeNull();
  });
  it('reuses the idempotency key and signed preview after a transport failure', async () => {
    const { api, onSaved } = fixture();
    api.saveSeries.mockRejectedValueOnce(new Error('Сеть недоступна'));
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр серии' }));
    const save = await screen.findByRole('button', { name: 'Создать серию' });
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await screen.findByRole('alert');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Создать серию' }).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Создать серию' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(api.saveSeries.mock.calls[0][3]).toBe(api.saveSeries.mock.calls[1][3]);
    expect(api.saveSeries.mock.calls[0][1].previewToken).toBe('signed-preview');
  });
  it('requires a fresh preview when the server detects concurrent changes', async () => {
    const { api } = fixture();
    api.saveSeries.mockRejectedValue(Object.assign(new Error('Предпросмотр устарел'), { status: 409 }));
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр серии' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Создать серию' }).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Создать серию' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Создать серию' }).disabled).toBe(true);
  });
  it('shows the complete affected lesson list without exposing conflict identities', () => {
    render(React.createElement(SeriesPreview, { timezone: 'UTC', preview: { canApply: false, occurrences: [], cancelLessons: [{ id: 'lesson', startAt: '2030-01-01T12:00:00Z' }], preservedCount: 2, issues: [{ occurrenceKey: '2030-01-01', code: 'lesson_conflict', conflicts: [{ userId: 'private-user-id', kind: 'student' }] }] } }));
    expect(screen.getByText('Пересечение расписания', { exact: false })).toBeTruthy();
    expect(screen.getByText('Отменить', { exact: true })).toBeTruthy();
    expect(screen.queryByText('private-user-id', { exact: false })).toBeNull();
  });
});
describe('imported resource editability', () => {
  it('preserves provenance while honoring the server cutover decision', () => {
    expect(legacyIsReadOnly({ legacy: true })).toBe(true);
    expect(legacyIsReadOnly({ legacy: true, legacyReadOnly: false })).toBe(false);
    expect(legacyIsReadOnly({ legacy: false, legacyReadOnly: false })).toBe(false);
  });
});
