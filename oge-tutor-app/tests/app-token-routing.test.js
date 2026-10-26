/*
 * OGE Tutor App — root token routing tests.
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/app/App.jsx';
import { useBackendStore } from '../src/app/useBackendStore.js';
import { createWorkspaceClient } from '../src/workspace/workspaceClient.js';

vi.mock('../src/app/useBackendStore.js', () => ({
  useBackendStore: vi.fn(),
}));
vi.mock('../src/workspace/workspaceClient.js', () => ({ createWorkspaceClient: vi.fn() }));

afterEach(() => {
  cleanup();
  window.history.pushState(null, '', '/');
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

describe('App token routing', () => {
  it('shows password setup from token URLs even when a teacher session exists', async () => {
    window.history.pushState(null, '', '/setup-password?token=invite-token');
    const verifyAccessToken = vi.fn(async () => ({
      valid: true,
      type: 'invite',
      account: { email: 's*****t@example.com', name: 'Student' },
    }));
    createWorkspaceClient.mockReturnValue({
      hasToken: () => true,
      runtime: vi.fn(async () => ({ legacyApiMode: 'disabled' })),
      me: vi.fn(async () => ({ item: { id: 'teacher', email: 'teacher@example.com', displayName: 'Teacher', catalogManage: false } })),
      contexts: vi.fn(async () => ({ items: [] })),
      verifyAccessToken,
    });

    useBackendStore.mockReturnValue({
      resources: {
        teacher: { id: 't-1', name: 'Teacher', email: 'teacher@example.com' },
        students: [],
        lessons: [],
        homeworks: [],
        materials: [],
        notifications: [],
      },
      session: { id: 't-1', role: 'teacher', email: 'teacher@example.com', token: 'teacher-token' },
      loading: false,
      busy: false,
      error: '',
      login: vi.fn(),
      logout: vi.fn(),
      requestPasswordReset: vi.fn(),
      verifyAccessToken,
      completeAccessToken: vi.fn(),
      actions: {},
    });

    render(React.createElement(React.StrictMode, null, React.createElement(App)));

    await waitFor(() => expect(verifyAccessToken).toHaveBeenCalledWith('invite-token'));
    expect(await screen.findByRole('heading', { name: 'Установка пароля' })).toBeTruthy();
    expect(window.location.search).toBe('');
    expect(useBackendStore).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Главная' })).toBeNull();
  });
});
