import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationsPanel } from '../src/workspace/LearningPanel.jsx';

const context = { workspaceId: 'workspace', role: 'student' };
function client() {
  return {
    notificationPreferences: vi.fn(async () => ({ item: { emailEnabled: false } })),
    learningNotifications: vi.fn(async () => ({ items: [], pageInfo: { nextCursor: null }, unreadCount: 0, asOf: new Date().toISOString() })),
    setNotificationPreferences: vi.fn(async () => ({ item: { emailEnabled: true } })),
  };
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('notification email preference', () => {
  it('updates the checkbox immediately and prevents a second write until saved', async () => {
    const api = client();
    let finish;
    api.setNotificationPreferences.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(React.createElement(NotificationsPanel, { api, context, onAccessError: vi.fn(), onOpen: vi.fn() }));
    const checkbox = screen.getByRole('checkbox', { name: 'Получать email' });
    await waitFor(() => expect(checkbox.disabled).toBe(false));
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(true);
    expect(api.setNotificationPreferences).toHaveBeenCalledWith(context, true);
    finish({ item: { emailEnabled: true } });
    await waitFor(() => expect(checkbox.disabled).toBe(false));
    expect(checkbox.checked).toBe(true);
  });
  it('restores the last saved value and reports a failed request', async () => {
    const api = client();
    api.setNotificationPreferences.mockRejectedValue(new Error('Не удалось сохранить настройку'));
    render(React.createElement(NotificationsPanel, { api, context, onAccessError: vi.fn(), onOpen: vi.fn() }));
    const checkbox = screen.getByRole('checkbox', { name: 'Получать email' });
    await waitFor(() => expect(checkbox.disabled).toBe(false));
    fireEvent.click(checkbox);
    await screen.findByRole('alert');
    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(false);
  });
});
