/*
 * OGE Tutor App — account, security and notification settings.
 * Email, password and notifications are saved through separate backend-facing actions.
 */
import React, { useState } from 'react';
import NotificationSettings from './NotificationSettings.jsx';
import { normalizeProfile } from './profileOptions.js';
import { Button, Card, Field, Header, Section } from '../shared/ui.jsx';
import { validateEmail as validateEmailValue } from '../shared/validation.js';

export default function AccountSettingsScreen({ profile, role, onBack, onSaveAccount, onSaveSecurity, onSaveNotifications }) {
  const normalized = normalizeProfile(profile, role);
  const [email, setEmail] = useState(normalized.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [notifications, setNotifications] = useState(normalized.settings.notifications);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  function resetFeedback() {
    setError('');
    setMessage('');
  }

  async function saveAccount() {
    resetFeedback();
    const emailValidation = validateEmailValue(email);
    if (!emailValidation.ok) {
      setError(emailValidation.error);
      return;
    }
    const cleanEmail = emailValidation.value;

    try {
      setIsSaving(true);
      await onSaveAccount({ email: cleanEmail });
      setMessage('Email сохранён.');
    } catch (err) {
      setError(err?.message || 'Не удалось сохранить email.');
    } finally {
      setIsSaving(false);
    }
  }

  async function savePassword() {
    resetFeedback();

    if (!currentPassword) {
      setError('Введите текущий пароль.');
      return;
    }
    if (newPassword.length < 6) {
      setError('Новый пароль должен быть не короче 6 символов.');
      return;
    }
    if (newPassword !== repeatPassword) {
      setError('Новый пароль и повтор не совпадают.');
      return;
    }

    try {
      setIsSaving(true);
      await onSaveSecurity({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setRepeatPassword('');
      setMessage('Пароль сохранён.');
    } catch (err) {
      setError(err?.message || 'Не удалось сохранить пароль.');
    } finally {
      setIsSaving(false);
    }
  }

  async function saveNotifications() {
    resetFeedback();

    try {
      setIsSaving(true);
      await onSaveNotifications({ notifications });
      setMessage('Уведомления сохранены.');
    } catch (err) {
      setError(err?.message || 'Не удалось сохранить уведомления.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <Header title="Настройки аккаунта" subtitle="Email, пароль, уведомления и выход из аккаунта" onBack={onBack} />

      <Section title="Email" />
      <Card className="form-stack">
        <Field label="Email для входа" value={email} onChange={setEmail} placeholder="example@mail.ru" />
        <p className="helper-text">Email используется для входа и восстановления доступа.</p>
        <Button variant="soft" onClick={saveAccount} disabled={isSaving}>{isSaving ? 'Сохраняем…' : 'Сохранить email'}</Button>
      </Card>

      <Section title="Пароль" />
      <Card className="form-stack">
        <Field label="Текущий пароль" type="password" value={currentPassword} onChange={setCurrentPassword} placeholder="Введите текущий пароль" />
        <Field label="Новый пароль" type="password" value={newPassword} onChange={setNewPassword} placeholder="Минимум 6 символов" />
        <Field label="Повторите новый пароль" type="password" value={repeatPassword} onChange={setRepeatPassword} placeholder="Повторите пароль" />
        <Button onClick={savePassword} disabled={isSaving}>{isSaving ? 'Сохраняем…' : 'Сохранить пароль'}</Button>
        <p className="helper-text">После смены пароля используйте новый пароль при следующем входе.</p>
      </Card>

      <Section title="Уведомления" />
      <Card className="form-stack">
        <NotificationSettings role={role} value={notifications} onChange={setNotifications} />
        <Button variant="soft" onClick={saveNotifications} disabled={isSaving}>{isSaving ? 'Сохраняем…' : 'Сохранить уведомления'}</Button>
      </Card>

      {error ? <div className="form-error">{error}</div> : null}
      {message ? <div className="form-success">{message}</div> : null}
    </>
  );
}
