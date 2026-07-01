/*
 * OGE Tutor App — authentication flow.
 * Auth is handled through API actions; the screen has no hardcoded users or passwords.
 */
import React, { useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '../api/apiError.js';
import { Button, Field } from '../shared/ui.jsx';

function accessTokenFromUrl() {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  return params.get('token') || params.get('inviteToken') || params.get('resetToken') || '';
}

function tokenTitle(type) {
  return type === 'invite' ? 'Установка пароля' : 'Новый пароль';
}

function tokenNote(type, account) {
  const target = account?.email ? ` для ${account.email}` : '';
  if (type === 'invite') return `Задайте пароль${target}, чтобы активировать доступ ученика.`;
  return `Задайте новый пароль${target}.`;
}

export default function AuthFlow({ onLogin, onPasswordReset, onVerifyAccessToken, onCompleteAccessToken, busy = false }) {
  const initialToken = accessTokenFromUrl();
  const [mode, setMode] = useState(initialToken ? 'setup' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordRepeat, setPasswordRepeat] = useState('');
  const [accessToken] = useState(initialToken);
  const [accessInfo, setAccessInfo] = useState(null);
  const [checkingToken, setCheckingToken] = useState(Boolean(initialToken));
  const [error, setError] = useState('');
  const verifiedTokenRef = useRef('');

  useEffect(() => {
    let alive = true;
    async function verifyToken() {
      if (!accessToken || mode !== 'setup') return;
      if (verifiedTokenRef.current === accessToken) return;
      verifiedTokenRef.current = accessToken;
      setCheckingToken(true);
      setError('');
      try {
        if (!onVerifyAccessToken) throw new Error('Проверка ссылки сейчас недоступна.');
        const result = await onVerifyAccessToken(accessToken);
        if (alive) setAccessInfo(result);
      } catch (err) {
        if (alive) setError(getErrorMessage(err));
      } finally {
        if (alive) setCheckingToken(false);
      }
    }
    verifyToken();
    return () => { alive = false; };
  }, [accessToken, mode, onVerifyAccessToken]);

  async function submitLogin() {
    setError('');
    if (!email.trim() || !password) {
      setError('Введите email и пароль.');
      return;
    }

    try {
      await onLogin(email.trim(), password);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function submitRecovery() {
    setError('');
    if (!email.trim()) {
      setError('Введите email аккаунта.');
      return;
    }

    try {
      await onPasswordReset(email.trim());
      setMode('sent');
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function submitAccessToken() {
    setError('');
    if (!password || password.length < 6) {
      setError('Пароль должен быть не короче 6 символов.');
      return;
    }
    if (password !== passwordRepeat) {
      setError('Пароли не совпадают.');
      return;
    }

    try {
      if (!onCompleteAccessToken) throw new Error('Установка пароля сейчас недоступна.');
      await onCompleteAccessToken(accessToken, password);
      setPassword('');
      setPasswordRepeat('');
      if (typeof window !== 'undefined' && window.history?.replaceState) {
        window.history.replaceState(null, '', window.location.pathname);
      }
      setMode('setupDone');
    } catch (err) {
      setError(getErrorMessage(err));
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
          <div className="form-stack">
            <Field label="Email" value={email} onChange={setEmail} placeholder="example@mail.ru" />
            <Field label="Пароль" type="password" value={password} onChange={setPassword} placeholder="Введите пароль" />
            <Button onClick={submitLogin} disabled={busy}>{busy ? 'Входим…' : 'Войти'}</Button>
            <button className="link-btn" onClick={() => { setMode('recovery'); setError(''); }}>Забыли пароль?</button>
          </div>
        </div>
      ) : null}

      {mode === 'recovery' ? (
        <div className="auth-card">
          <button className="back-btn" onClick={() => { setMode('login'); setError(''); }} aria-label="Назад">
            <svg width="25" height="25" viewBox="0 0 24 24" fill="none"><path d="M19 12H7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/><path d="M12 7L7 12L12 17" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <h1 className="auth-title">Восстановление пароля</h1>
          <p className="auth-note">Введите email аккаунта. Backend подготовит ссылку восстановления; отправка письма подключается отдельно.</p>
          {error ? <div className="auth-error">{error}</div> : null}
          <div className="form-stack">
            <Field label="Email" value={email} onChange={setEmail} placeholder="example@mail.ru" />
            <Button onClick={submitRecovery} disabled={busy}>{busy ? 'Готовим…' : 'Подготовить ссылку'}</Button>
          </div>
        </div>
      ) : null}

      {mode === 'sent' ? (
        <div className="auth-card">
          <div className="success-icon">✓</div>
          <h1 className="auth-title">Запрос принят</h1>
          <p className="auth-note">Если аккаунт существует, backend подготовит ссылку для восстановления доступа.</p>
          <Button onClick={() => setMode('login')}>Вернуться ко входу</Button>
        </div>
      ) : null}

      {mode === 'setup' ? (
        <div className="auth-card">
          <h1 className="auth-title">{tokenTitle(accessInfo?.type)}</h1>
          <p className="auth-note">
            {checkingToken ? 'Проверяем ссылку доступа.' : tokenNote(accessInfo?.type, accessInfo?.account)}
          </p>
          {error ? <div className="auth-error">{error}</div> : null}
          <div className="form-stack">
            <Field label="Новый пароль" type="password" value={password} onChange={setPassword} placeholder="Минимум 6 символов" disabled={checkingToken || Boolean(error && !accessInfo)} />
            <Field label="Повторите пароль" type="password" value={passwordRepeat} onChange={setPasswordRepeat} placeholder="Повторите новый пароль" disabled={checkingToken || Boolean(error && !accessInfo)} />
            <Button onClick={submitAccessToken} disabled={busy || checkingToken || Boolean(error && !accessInfo)}>
              {busy ? 'Сохраняем…' : 'Сохранить пароль'}
            </Button>
            <button className="link-btn" onClick={() => { setMode('login'); setError(''); }}>Вернуться ко входу</button>
          </div>
        </div>
      ) : null}

      {mode === 'setupDone' ? (
        <div className="auth-card">
          <div className="success-icon">✓</div>
          <h1 className="auth-title">Пароль сохранён</h1>
          <p className="auth-note">Теперь можно войти с новым паролем.</p>
          <Button onClick={() => { setMode('login'); setError(''); }}>Войти</Button>
        </div>
      ) : null}
    </div>
  );
}
