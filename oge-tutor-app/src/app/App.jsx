/*
 * OGE Tutor App — root application.
 * The app is wired through an async API store, so UI screens are ready for a real backend adapter.
 */
import React, { useEffect, useState } from 'react';
import AuthFlow from '../auth/AuthFlow.jsx';
import StudentApp from '../student/StudentApp.jsx';
import TeacherApp from '../teacher/TeacherApp.jsx';
import { useBackendStore } from './useBackendStore.js';
import { Button, MobileFrame } from '../shared/ui.jsx';
import { createWorkspaceClient } from '../workspace/workspaceClient.js';
import WorkspaceApp from '../workspace/WorkspaceApp.jsx';

const APP_MODE_KEY = 'oge-tutor-app-mode';

function initialMode() {
  if (typeof window === 'undefined') return 'workspace';
  if (window.location.pathname === '/workspace-invite') return 'workspace';
  if (hasAccessTokenInUrl()) return 'workspace';
  const saved = window.sessionStorage.getItem(APP_MODE_KEY);
  if (saved) return saved;
  if (import.meta.env.VITE_USE_MOCK === 'true') return 'legacy';
  return 'workspace';
}

function hasAccessTokenInUrl() {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return Boolean(params.get('token') || params.get('inviteToken') || params.get('resetToken'));
}

function LegacyApp({ onSpaces }) {
  const { resources, session, loading, busy, error, login, logout, requestPasswordReset, verifyAccessToken, completeAccessToken, actions } = useBackendStore();
  const [accessTokenMode, setAccessTokenMode] = useState(() => hasAccessTokenInUrl());

  async function loginAndLeaveTokenMode(email, password) {
    const result = await login(email, password);
    setAccessTokenMode(false);
    return result;
  }

  return (
    <div className="app-page">
      <MobileFrame>
        <div className="legacy-spaces-link"><button type="button" onClick={onSpaces}>Рабочие пространства</button></div>
        {loading ? (
          <div className="auth-wrapper"><div className="auth-card"><h1 className="auth-title">Загрузка</h1><p className="auth-note">Подключаем данные приложения.</p></div></div>
        ) : null}

        {!loading && error && session ? <div className="app-error-banner">{error}</div> : null}

        {!loading && error && !session ? (
          <div className="auth-wrapper">
            <div className="auth-card">
              <h1 className="auth-title">Не удалось загрузить приложение</h1>
              <p className="auth-note">{error}</p>
              <Button onClick={() => window.location.reload()}>Повторить загрузку</Button>
            </div>
          </div>
        ) : null}

        {!loading && !error && (!session || accessTokenMode) ? (
          <AuthFlow
            onLogin={loginAndLeaveTokenMode}
            onPasswordReset={requestPasswordReset}
            onVerifyAccessToken={verifyAccessToken}
            onCompleteAccessToken={completeAccessToken}
            busy={busy}
          />
        ) : null}

        {!loading && !accessTokenMode && session?.role === 'student' && resources ? (
          <StudentApp data={resources} actions={actions} user={session} onLogout={logout} />
        ) : null}

        {!loading && !accessTokenMode && session?.role === 'teacher' && resources ? (
          <TeacherApp data={resources} actions={actions} onLogout={logout} />
        ) : null}
      </MobileFrame>
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState(initialMode);
  const [legacyAllowed, setLegacyAllowed] = useState(import.meta.env.VITE_USE_MOCK === 'true' ? true : null);
  useEffect(() => {
    if (import.meta.env.VITE_USE_MOCK === 'true') return;
    let alive = true;
    createWorkspaceClient().runtime().then(result => { if (alive) setLegacyAllowed(result.legacyApiMode === 'enabled'); }).catch(() => { if (alive) setLegacyAllowed(false); });
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (legacyAllowed === false && mode === 'legacy') setMode('workspace'); }, [legacyAllowed, mode]);
  useEffect(() => {
    window.sessionStorage.setItem(APP_MODE_KEY, mode);
  }, [mode]);
  function changeMode(value) {
    window.sessionStorage.setItem(APP_MODE_KEY, value);
    setMode(value);
  }
  if (mode === 'legacy' && legacyAllowed === null) return <div className="workspace-auth-page"><p>Загрузка…</p></div>;
  return mode === 'workspace' || legacyAllowed === false
    ? <WorkspaceApp onLegacy={() => changeMode('legacy')} />
    : <LegacyApp onSpaces={() => changeMode('workspace')} />;
}
