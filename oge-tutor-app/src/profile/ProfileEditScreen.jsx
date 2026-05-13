/*
 * OGE Tutor App — visual profile editor.
 * Edits only visual/person-facing profile data: name, icon and background.
 */
import React, { useState } from 'react';
import { PROFILE_BACKGROUNDS, PROFILE_ICONS, getProfileIcon, normalizeProfile } from './profileOptions.js';
import { Avatar, Button, Card, Field, Header, Section, cx, solidBg } from '../shared/ui.jsx';

export default function ProfileEditScreen({ profile, role, onBack, onSave }) {
  const normalized = normalizeProfile(profile, role);
  const [draft, setDraft] = useState({
    name: normalized.name || '',
    avatar: normalized.avatar,
    bg: normalized.bg,
  });
  const currentIcon = getProfileIcon(draft.avatar);

  function selectIcon(item) {
    setDraft((current) => ({ ...current, avatar: item.id, bg: item.preferredBg || current.bg }));
  }

  function save() {
    onSave({ name: draft.name.trim() || normalized.name, avatar: draft.avatar, bg: draft.bg });
  }

  return (
    <>
      <Header title="Редактирование профиля" subtitle="Имя, иконка и фон карточки" onBack={onBack} />

      <div className={`profile-hero ${solidBg(draft.bg)}`}>
        <div className="profile-content">
          <Avatar avatarId={draft.avatar} bg={draft.bg} size="lg" />
          <p className="profile-name">{draft.name || normalized.name}</p>
          <p className="profile-email">{currentIcon.label}</p>
        </div>
      </div>

      <Section title="Имя" />
      <Card className="form-stack">
        <Field label="Имя в профиле" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} placeholder="Имя" />
      </Card>

      <Section title="Иконка профиля" />
      <div className="profile-option-grid">
        {PROFILE_ICONS.map((item) => (
          <button
            type="button"
            key={item.id}
            className={cx('profile-icon-option', draft.avatar === item.id && 'active')}
            onClick={() => selectIcon(item)}
          >
            <span className="profile-icon-symbol">{item.icon}</span>
            <span className="profile-option-label">{item.label}</span>
          </button>
        ))}
      </div>

      <Section title="Фон карточки" />
      <div className="profile-background-grid">
        {PROFILE_BACKGROUNDS.map((item) => (
          <button
            type="button"
            key={item.id}
            className={cx('profile-background-option', draft.bg === item.id && 'active')}
            style={{
              '--profile-bg-solid': item.solid,
              '--profile-bg-soft': item.soft,
              '--profile-bg-text': item.text,
            }}
            onClick={() => setDraft({ ...draft, bg: item.id })}
          >
            <span className="profile-background-swatch" aria-hidden="true" />
            <span className="profile-option-label">{item.label}</span>
          </button>
        ))}
      </div>

      <div className="sticky-action"><Button onClick={save}>Сохранить изменения</Button></div>
    </>
  );
}
