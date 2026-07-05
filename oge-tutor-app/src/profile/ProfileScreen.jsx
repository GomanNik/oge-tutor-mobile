/*
 * OGE Tutor App — shared profile screen.
 * Student and teacher profiles use the same implementation and differ only by role config/data.
 */
import React, { useState } from 'react';
import AccountSettingsScreen from './AccountSettingsScreen.jsx';
import ProfileEditScreen from './ProfileEditScreen.jsx';
import { ROLE_LABELS, getProfileIcon, normalizeProfile } from './profileOptions.js';
import { Avatar, Badge, Button, Header, RowCard, solidBg } from '../shared/ui.jsx';

export default function ProfileScreen({ profile, role, onSaveVisual, onSaveAccount, onSaveSecurity, onSaveNotifications, onLogout }) {
  const [mode, setMode] = useState('view');
  const normalized = normalizeProfile(profile, role);
  const currentIcon = getProfileIcon(normalized.avatar);
  const roleLabel = ROLE_LABELS[role] || 'Профиль';

  async function saveVisual(patch) {
    await onSaveVisual(patch);
    setMode('view');
  }

  if (mode === 'edit') {
    return <ProfileEditScreen profile={normalized} role={role} onBack={() => setMode('view')} onSave={saveVisual} />;
  }

  if (mode === 'account') {
    return (
      <AccountSettingsScreen
        profile={normalized}
        role={role}
        onBack={() => setMode('view')}
        onSaveAccount={onSaveAccount}
        onSaveSecurity={onSaveSecurity}
        onSaveNotifications={onSaveNotifications}
      />
    );
  }

  return (
    <>
      <Header title="Профиль" subtitle="Аккаунт, внешний вид и уведомления" />
      <button type="button" className={`profile-hero profile-hero-button ${solidBg(normalized.bg)}`} onClick={() => setMode('edit')}>
        <div className="profile-content">
          <Avatar avatarId={normalized.avatar} bg={normalized.bg} size="lg" />
          <p className="profile-name">{normalized.name}</p>
          <p className="profile-email">{normalized.email}</p>
          <Badge tone="blue">{roleLabel}</Badge>
        </div>
      </button>

      <div className="profile-action-list">
        <RowCard
          icon={currentIcon.icon}
          title="Редактировать профиль"
          subtitle="Имя, иконка и фон"
          onClick={() => setMode('edit')}
        />
        <RowCard
          icon="◎"
          title="Настройки аккаунта"
          subtitle="Email, пароль и уведомления"
          onClick={() => setMode('account')}
        />
        <Button variant="danger" onClick={onLogout}>Выйти</Button>
      </div>
    </>
  );
}
