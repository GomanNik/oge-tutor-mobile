import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CatalogPanel from '../src/workspace/CatalogPanel.jsx';

const context = { workspaceId: 'space-a', role: 'admin' };
const localSubject = { id: 'subject-a', workspaceId: 'space-a', code: 'physics', name: 'Физика', status: 'active', revision: 0 };
const globalSubject = { id: 'subject-global', workspaceId: null, code: 'math', name: 'Математика', status: 'active', revision: 0 };
const paged = items => ({ items, total: items.length, page: 1, pageSize: 25 });

function api(overrides = {}) {
  return {
    subjects: vi.fn(async () => paged([globalSubject, localSubject])),
    programs: vi.fn(async () => paged([])),
    versions: vi.fn(async () => paged([])),
    catalogTasks: vi.fn(async () => paged([])),
    createSubject: vi.fn(async (_, body) => ({ item: { ...localSubject, code: body.code, name: body.name } })),
    ...overrides,
  };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('CatalogPanel', () => {
  it('scopes reads and creates a local subject for an administrator', async () => {
    const client = api();
    render(React.createElement(CatalogPanel, { api: client, context, canManage: true, onAccessError: vi.fn() }));
    await screen.findByText('Физика');
    expect(client.subjects).toHaveBeenCalledWith(context, { q: '', status: '', page: 1, pageSize: 25 });
    fireEvent.change(screen.getByLabelText('Код'), { target: { value: 'history' } });
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'История' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать предмет' }));
    await waitFor(() => expect(client.createSubject).toHaveBeenCalledWith(context, { code: 'history', name: 'История' }));
    expect(screen.getByText('Сохранено.')).toBeTruthy();
  });

  it('keeps the catalog read-only for a teacher', async () => {
    const client = api();
    render(React.createElement(CatalogPanel, { api: client, context: { ...context, role: 'teacher' }, canManage: false, onAccessError: vi.fn() }));
    await screen.findByText('Физика');
    expect(screen.queryByRole('button', { name: 'Создать предмет' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Изменить' })).toBeNull();
  });

  it('does not show stale rows after switching catalog tabs', async () => {
    let resolvePrograms;
    const programs = new Promise(resolve => { resolvePrograms = resolve; });
    const client = api({ programs: vi.fn(() => programs) });
    render(React.createElement(CatalogPanel, { api: client, context, canManage: false, onAccessError: vi.fn() }));
    await screen.findByText('Физика');
    fireEvent.click(screen.getByRole('tab', { name: 'Программы' }));
    expect(screen.queryByText('Физика')).toBeNull();
    resolvePrograms(paged([{ id: 'program-a', name: 'ЕГЭ · физика', code: 'ege-physics', examType: 'ege', variant: 'general', status: 'active', subject: { name: 'Физика' }, workspaceId: 'space-a' }]));
    await screen.findByText('ЕГЭ · физика');
  });

  it('shows selector errors instead of leaving an empty program picker', async () => {
    const client = api({ programs: vi.fn(async () => { throw new Error('Каталог недоступен'); }) });
    render(React.createElement(CatalogPanel, { api: client, context, canManage: false, onAccessError: vi.fn() }));
    fireEvent.click(screen.getByRole('tab', { name: 'Версии и задания' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('Каталог недоступен');
  });

  it('refreshes the full version detail after archiving', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const program = { id: 'program-a', workspaceId: 'space-a', name: 'ЕГЭ · физика', code: 'ege-physics', examType: 'ege', variant: 'general', status: 'active' };
    const published = { id: 'version-a', period: '2028', revisionNumber: 1, status: 'published', revision: 2, sourceUrl: 'https://example.org/2028', notes: '', scoringRule: { kind: 'verified_reference', code: 'official', description: 'Подтверждено источником', sourceUrl: 'https://example.org/2028' } };
    const client = api({
      programs: vi.fn(async () => paged([program])),
      versions: vi.fn(async () => paged([published])),
      version: vi.fn().mockResolvedValueOnce({ item: published }).mockResolvedValueOnce({ item: { ...published, status: 'archived', revision: 3 } }),
      archiveVersion: vi.fn(async () => ({ item: { ...published, status: 'archived', revision: 3 } })),
    });
    render(React.createElement(CatalogPanel, { api: client, context, canManage: true, onAccessError: vi.fn() }));
    fireEvent.click(screen.getByRole('tab', { name: 'Версии и задания' }));
    await screen.findByRole('option', { name: 'ЕГЭ · физика · локальная' });
    fireEvent.change(screen.getByLabelText('Программа'), { target: { value: program.id } });
    await screen.findByRole('button', { name: 'Задания' });
    fireEvent.click(screen.getByRole('button', { name: 'Задания' }));
    await screen.findByRole('button', { name: 'Архивировать' });
    fireEvent.click(screen.getByRole('button', { name: 'Архивировать' }));
    await waitFor(() => expect(client.version).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/Подтверждено источником/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Архивировать' })).toBeNull();
  });
});
