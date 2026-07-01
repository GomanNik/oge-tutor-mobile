/*
 * OGE Tutor App — authentication UI flow tests.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/apiError.js';
import AuthFlow from '../src/auth/AuthFlow.jsx';

function renderAuthFlow(props) {
  return render(React.createElement(AuthFlow, props));
}

afterEach(() => {
  cleanup();
  window.history.pushState(null, '', '/');
});

describe('AuthFlow', () => {
  it('keeps ordinary login flow working', async () => {
    const onLogin = vi.fn(async () => {});
    renderAuthFlow({ onLogin, onPasswordReset: vi.fn() });

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'student@mail.ru' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('student@mail.ru', 'secret123'));
  });

  it('shows token setup form when token query is present', async () => {
    window.history.pushState(null, '', '/setup-password?token=invite-token');
    const onVerifyAccessToken = vi.fn(async () => ({
      valid: true,
      type: 'invite',
      account: { email: 's*****t@mail.ru', name: 'Student Name' },
    }));

    renderAuthFlow({
      onLogin: vi.fn(),
      onPasswordReset: vi.fn(),
      onVerifyAccessToken,
      onCompleteAccessToken: vi.fn(),
    });

    await waitFor(() => expect(onVerifyAccessToken).toHaveBeenCalledWith('invite-token'));
    expect(screen.getByText('Установка пароля')).toBeTruthy();
    expect(screen.getByText(/активировать доступ ученика/)).toBeTruthy();
  });

  it('completes token setup and shows login prompt', async () => {
    window.history.pushState(null, '', '/reset-password?token=reset-token');
    const onCompleteAccessToken = vi.fn(async () => ({ ok: true }));

    renderAuthFlow({
      onLogin: vi.fn(),
      onPasswordReset: vi.fn(),
      onVerifyAccessToken: vi.fn(async () => ({
        valid: true,
        type: 'password_reset',
        account: { email: 't*****r@mail.ru', name: 'Teacher Name' },
      })),
      onCompleteAccessToken,
    });

    await screen.findByRole('heading', { name: 'Новый пароль' });
    fireEvent.change(screen.getByLabelText('Новый пароль'), { target: { value: 'newpass123' } });
    fireEvent.change(screen.getByLabelText('Повторите пароль'), { target: { value: 'newpass123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить пароль' }));

    await waitFor(() => expect(onCompleteAccessToken).toHaveBeenCalledWith('reset-token', 'newpass123'));
    expect(await screen.findByText('Пароль сохранён')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Войти' })).toBeTruthy();
  });

  it('shows safe error for invalid token', async () => {
    window.history.pushState(null, '', '/setup-password?token=bad-token');
    renderAuthFlow({
      onLogin: vi.fn(),
      onPasswordReset: vi.fn(),
      onVerifyAccessToken: vi.fn(async () => {
        throw new ApiError('Ссылка недействительна.', 'validation_error');
      }),
      onCompleteAccessToken: vi.fn(),
    });

    expect(await screen.findByText('Ссылка недействительна.')).toBeTruthy();
    expect(screen.queryByText('bad-token')).toBeNull();
  });
});
