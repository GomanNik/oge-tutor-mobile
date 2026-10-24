import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkspaceApp from '../src/workspace/WorkspaceApp.jsx';
import { createWorkspaceClient } from '../src/workspace/workspaceClient.js';

vi.mock('../src/workspace/workspaceClient.js', () => ({ createWorkspaceClient: vi.fn() }));

const account = { id: 'user-1', email: 'admin@example.com', displayName: 'Admin', revision: 0 };
const a = { workspaceId: 'a', name: 'Space A', legacyRole: null, roles: ['admin'] };
const b = { workspaceId: 'b', name: 'Space B', legacyRole: null, roles: ['admin'] };
const member = (id, displayName) => ({ id, userId: id, email: `${id}@example.com`, displayName, roles: ['student'], status: 'active', revision: 0 });
const page = items => ({ items, pageInfo: { nextCursor: null, hasMore: false } });

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function api(overrides = {}) {
  return {
    hasToken: () => false,
    login: vi.fn(async () => ({ user: account, contexts: [a, b] })),
    contexts: vi.fn(async () => page([a, b])),
    members: vi.fn(async context => page([member(context.workspaceId, `Member ${context.workspaceId}`)])),
    invitations: vi.fn(async () => page([])),
    audit: vi.fn(async () => page([])),
    ...overrides,
  };
}

async function login() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: account.email } });
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
  await screen.findByRole('tab', { name: 'Участники' });
}

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

describe('WorkspaceApp', () => {
  it('hides the previous workspace while switching contexts', async () => {
    const delayedB = deferred();
    const client = api({ members: vi.fn(context => context.workspaceId === 'a'
      ? Promise.resolve(page([member('a-member', 'Only A')])) : delayedB.promise) });
    createWorkspaceClient.mockReturnValue(client);
    render(React.createElement(WorkspaceApp, { onLegacy: vi.fn() }));
    await login();
    await screen.findByText('Only A');

    fireEvent.change(screen.getByLabelText('Рабочее пространство и роль'), { target: { value: 'b:admin' } });
    expect(screen.queryByText('Only A')).toBeNull();
    delayedB.resolve(page([member('b-member', 'Only B')]));
    await screen.findByText('Only B');
    expect(client.members).toHaveBeenCalledWith({ workspaceId: 'b', role: 'admin' }, { q: '', role: '' });
  });

  it('clears stale admin data after losing access and refreshes contexts', async () => {
    const refresh = deferred();
    const forbidden = Object.assign(new Error('Access revoked'), { status: 403 });
    const client = api({
      members: vi.fn(context => Promise.resolve(page([member(`${context.workspaceId}-member`, context.workspaceId === 'a' ? 'Only A' : 'Only B')]))),
      updateMember: vi.fn(async () => { throw forbidden; }),
      contexts: vi.fn(() => refresh.promise),
    });
    createWorkspaceClient.mockReturnValue(client);
    render(React.createElement(WorkspaceApp, { onLegacy: vi.fn() }));
    await login();
    await screen.findByText('Only A');
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(client.contexts).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Only A')).toBeNull();
    refresh.resolve(page([b]));
    await screen.findByText('Only B');
    expect(screen.queryByText('Only A')).toBeNull();
  });

  it('removes invitation tokens from the URL before rendering the form', () => {
    createWorkspaceClient.mockReturnValue(api());
    window.history.replaceState({}, '', '/workspace-invite?token=secret-token');
    render(React.createElement(WorkspaceApp, { onLegacy: vi.fn() }));
    expect(screen.getByRole('heading', { name: 'Приглашение' })).toBeTruthy();
    expect(window.location.href).not.toContain('secret-token');
  });

  it('does not offer the old cabinet to a new student in a legacy workspace', async () => {
    createWorkspaceClient.mockReturnValue(api({
      login: vi.fn(async () => ({ user: account, contexts: [{ workspaceId: 'legacy-teacher', name: 'Tutor', legacyRole: null, roles: ['student'] }] })),
    }));
    render(React.createElement(WorkspaceApp, { onLegacy: vi.fn() }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: account.email } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    await screen.findByRole('heading', { name: 'Ученик' });
    expect(screen.queryByRole('button', { name: 'Открыть учебный кабинет' })).toBeNull();
  });

  it('requires confirmation before suspending a member', async () => {
    const client = api({ setSuspended: vi.fn(async (_, item) => ({ item: { ...item, status: 'suspended', revision: 1 } })) });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    createWorkspaceClient.mockReturnValue(client);
    render(React.createElement(WorkspaceApp, { onLegacy: vi.fn() }));
    await login();
    await screen.findByText('Member a');
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    fireEvent.change(screen.getByLabelText('Действие'), { target: { value: 'suspend' } });
    fireEvent.change(screen.getByLabelText('Причина'), { target: { value: 'Access review in progress' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(client.setSuspended).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(client.setSuspended).toHaveBeenCalledTimes(1));
    confirm.mockRestore();
  });

  it('opens the global catalog for a catalog editor without workspace membership', async () => {
    const client = api({
      login: vi.fn(async () => ({ user: { ...account, catalogManage: true }, contexts: [] })),
      subjects: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 25 })),
      programs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 25 })),
    });
    createWorkspaceClient.mockReturnValue(client);
    render(React.createElement(WorkspaceApp, { onLegacy: vi.fn() }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: account.email } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    await screen.findByRole('tab', { name: 'Предметы' });
    expect(screen.getByRole('button', { name: 'Создать предмет' })).toBeTruthy();
    expect(client.subjects).toHaveBeenCalledWith(null, { q: '', status: '', page: 1, pageSize: 25 });
  });
});
