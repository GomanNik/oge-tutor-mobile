/*
 * OGE Tutor App — shared notification settings.
 * One component with different notification sets for student and teacher roles.
 */
import React from 'react';
import { NOTIFICATION_SETTINGS } from './profileOptions.js';
import { Badge, cx, toneClass } from '../shared/ui.jsx';

export default function NotificationSettings({ role, value, onChange }) {
  const settings = NOTIFICATION_SETTINGS[role] || [];

  function toggle(id) {
    onChange({ ...value, [id]: !value[id] });
  }

  return (
    <div className="notification-list">
      {settings.map((item) => {
        const enabled = Boolean(value[item.id]);
        return (
          <button type="button" key={item.id} className="notification-row" onClick={() => toggle(item.id)}>
            <div className={cx('row-icon', toneClass(enabled ? 'green' : 'slate'))}>{item.icon}</div>
            <div className="notification-main">
              <div className="notification-title">{item.title}</div>
              <div className="notification-description">{item.description}</div>
            </div>
            <Badge tone={enabled ? 'green' : 'slate'}>{enabled ? 'вкл' : 'выкл'}</Badge>
          </button>
        );
      })}
    </div>
  );
}
