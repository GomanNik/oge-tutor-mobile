/*
 * OGE Tutor App — root application.
 * The app is wired through an async API store, so UI screens are ready for a real backend adapter.
 */
import React, { useState } from 'react';
import AuthFlow from '../auth/AuthFlow.jsx';
import StudentApp from '../student/StudentApp.jsx';
import TeacherApp from '../teacher/TeacherApp.jsx';
import { useBackendStore } from './useBackendStore.js';
import { Button, MobileFrame } from '../shared/ui.jsx';

function hasAccessTokenInUrl() {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return Boolean(params.get('token') || params.get('inviteToken') || params.get('resetToken'));
}

export default function App() {
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
