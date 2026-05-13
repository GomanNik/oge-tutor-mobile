/*
 * OGE Tutor App — authentication flow.
 * Auth is handled through API actions; the screen has no hardcoded users or passwords.
 */
import React, { useState } from 'react';
import { getErrorMessage } from '../api/apiError.js';
import { logger } from '../shared/logger.js';
import { Button, Field } from '../shared/ui.jsx';

export default function AuthFlow({ onLogin, onPasswordReset, busy = false }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submitLogin(event) {
    event?.preventDefault?.();
    logger.ui('action=auth.login.submit screen=AuthFlow');
    setError('');
    if (!email.trim() || !password) {
      setError('Введите email и пароль.');
      logger.warn('auth.login.validation_failed', { fieldErrors: { email: !email.trim(), password: !password } });
      return;
    }

    try {
      logger.form('auth.login.submit', { email: email.trim(), password: '[masked]' });
      await onLogin(email.trim(), password);
    } catch (err) {
      const message = getErrorMessage(err);
      logger.error('auth.login.failed', { code: err?.code, requestId: err?.details?.requestId, message });
      setError(message);
    }
  }

  async function submitRecovery(event) {
    event?.preventDefault?.();
    logger.ui('action=auth.password_reset.submit screen=AuthFlow');
    setError('');
    if (!email.trim()) {
      setError('Введите email аккаунта.');
      logger.warn('auth.password_reset.validation_failed', { fieldErrors: { email: true } });
      return;
    }

    try {
      logger.form('auth.password_reset.submit', { email: email.trim() });
      await onPasswordReset(email.trim());
      setMode('sent');
    } catch (err) {
      const message = getErrorMessage(err);
      logger.error('auth.password_reset.failed', { code: err?.code, requestId: err?.details?.requestId, message });
      setError(message);
    }
  }

  return (
    <div className="auth-wrapper">
      <div className="auth-logo">
        <div className="logo-mark">🎓</div>
        <p className="logo-title">OGE Tutor</p>
        <p className="logo-subtitle">мобильный кабинет</p>
      </div>

      {mode === 'login' ? (
        <div className="auth-card">
          <h1 className="auth-title">Вход</h1>
          {error ? <div className="auth-error">{error}</div> : null}
          <form className="form-stack" onSubmit={submitLogin}>
            <Field label="Email" value={email} onChange={setEmail} placeholder="example@mail.ru" />
            <Field label="Пароль" type="password" value={password} onChange={setPassword} placeholder="Введите пароль" />
            <Button type="submit" disabled={busy}>{busy ? 'Входим…' : 'Войти'}</Button>
            <button type="button" className="link-btn" onClick={() => { setMode('recovery'); setError(''); }}>Забыли пароль?</button>
          </form>
        </div>
      ) : null}

      {mode === 'recovery' ? (
        <div className="auth-card">
          <button className="back-btn" onClick={() => { setMode('login'); setError(''); }} aria-label="Назад">
            <svg width="25" height="25" viewBox="0 0 24 24" fill="none"><path d="M19 12H7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/><path d="M12 7L7 12L12 17" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <h1 className="auth-title">Восстановление пароля</h1>
          <p className="auth-note">Введите email аккаунта. Запрос уйдёт в backend, который отправит письмо для установки нового пароля.</p>
          {error ? <div className="auth-error">{error}</div> : null}
          <form className="form-stack" onSubmit={submitRecovery}>
            <Field label="Email" value={email} onChange={setEmail} placeholder="example@mail.ru" />
            <Button type="submit" disabled={busy}>{busy ? 'Отправляем…' : 'Отправить письмо'}</Button>
          </form>
        </div>
      ) : null}

      {mode === 'sent' ? (
        <div className="auth-card">
          <div className="success-icon">✓</div>
          <h1 className="auth-title">Письмо отправлено</h1>
          <p className="auth-note">Если аккаунт существует, backend отправит ссылку для восстановления доступа.</p>
          <Button onClick={() => setMode('login')}>Вернуться ко входу</Button>
        </div>
      ) : null}
    </div>
  );
}
