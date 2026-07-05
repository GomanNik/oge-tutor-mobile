/*
 * OGE Tutor App — reusable notification inbox.
 * Notifications are derived from product state and existing backend notifications.
 */
import React from 'react';
import { NOTIFICATION_TYPE } from '../api/contracts.js';
import { formatDateTimeLabel } from './dateTime.js';
import { Card, EmptyState, Header, RowCard, toneClass } from './ui.jsx';

function notificationIcon(type) {
  if (type === NOTIFICATION_TYPE.HOMEWORK_SUBMITTED) return '✓';
  if (type === NOTIFICATION_TYPE.HOMEWORK_OVERDUE) return '!';
  if (type === NOTIFICATION_TYPE.UPCOMING_LESSON) return '□';
  if (type === NOTIFICATION_TYPE.STUDENT_ACCESS) return '◎';
  if (type === NOTIFICATION_TYPE.HOMEWORK_REVIEWED) return '✓';
  if (type === NOTIFICATION_TYPE.NEW_MATERIAL) return '▦';
  if (type === NOTIFICATION_TYPE.PROGRESS_ASSESSMENT_REQUIRED) return '∑';
  return '•';
}

export function NotificationInbox({ title = 'Уведомления', subtitle = 'События, которые требуют внимания', notifications = [], onBack, onOpen }) {
  return (
    <>
      <Header title={title} subtitle={subtitle} onBack={onBack} />
      {notifications.length ? notifications.map((item) => (
        <RowCard
          key={item.id}
          icon={notificationIcon(item.type)}
          iconTone={item.tone || 'blue'}
          title={item.title}
          subtitle={`${item.message || 'Новое событие'}${item.createdAt ? ` · ${formatDateTimeLabel(item.createdAt)}` : ''}`}
          badge={item.actionLabel || 'Открыть'}
          badgeTone={item.tone || 'blue'}
          onClick={() => onOpen?.(item)}
        />
      )) : (
        <EmptyState title="Новых уведомлений нет" text="Когда появятся сданные работы, просрочки, ближайшие уроки или события доступа, они будут здесь." />
      )}
    </>
  );
}

export function NotificationsPreview({ notifications = [], onOpenAll, onOpen }) {
  const top = notifications.slice(0, 3);
  return (
    <Card className="notification-preview-card">
      <div className="notification-preview-head">
        <div>
          <strong>Уведомления</strong>
          <p className="subtitle">{notifications.length ? `${notifications.length} активных событий` : 'Новых событий нет'}</p>
        </div>
        {onOpenAll ? <button type="button" className="link-btn" onClick={onOpenAll}>Все</button> : null}
      </div>
      {top.length ? top.map((item) => (
        <button type="button" className="notification-mini-row" key={item.id} onClick={() => onOpen?.(item)}>
          <span className={toneClass(item.tone || 'blue')}>{notificationIcon(item.type)}</span>
          <span>
            <strong>{item.title}</strong>
            <small>{item.message}</small>
          </span>
        </button>
      )) : <div className="empty-materials">Спокойно: ничего срочного не требует реакции.</div>}
    </Card>
  );
}
