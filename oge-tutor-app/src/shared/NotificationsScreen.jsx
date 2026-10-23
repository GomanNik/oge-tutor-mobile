/*
 * OGE Tutor App — reusable notification inbox.
 * Notifications are derived from product state and existing backend notifications.
 */
import React, { useState } from 'react';
import { NOTIFICATION_TYPE } from '../api/contracts.js';
import { formatDateTimeLabel } from './dateTime.js';
import { Badge, Button, Card, EmptyState, Header, IconButton, RowCard, SelectField, toneClass } from './ui.jsx';

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

export function NotificationInbox({ title = 'Уведомления', subtitle = 'События, которые требуют внимания', notifications = [], onBack, onOpen, onStatusChange, onReadAll }) {
  const [filter, setFilter] = useState('active');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const visible = notifications.filter((item) => filter === 'all' || (filter === 'active' ? item.status !== 'resolved' : item.status === filter));
  async function perform(action) {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await action(); } catch (err) { setError(err?.message || 'Не удалось обновить уведомление.'); }
    finally { setBusy(false); }
  }
  return (
    <>
      <Header title={title} subtitle={subtitle} onBack={onBack} />
      <div className="notification-toolbar">
        <SelectField label="Статус уведомлений" value={filter} onChange={setFilter} options={[
          { value: 'active', label: 'Активные' }, { value: 'unread', label: 'Непрочитанные' },
          { value: 'read', label: 'Прочитанные' }, { value: 'resolved', label: 'Завершённые' }, { value: 'all', label: 'Все' },
        ]} />
        {onReadAll ? <Button variant="light" disabled={busy} onClick={() => perform(onReadAll)}>Прочитать все</Button> : null}
      </div>
      {error ? <div className="inline-error" role="alert">{error}</div> : null}
      {visible.length ? visible.map((item) => (
        <div key={item.id} className="notification-entry">
        <RowCard
          icon={notificationIcon(item.type)}
          iconTone={item.tone || 'blue'}
          title={item.title}
          subtitle={`${item.message || 'Новое событие'}${item.createdAt ? ` · ${formatDateTimeLabel(item.createdAt)}` : ''}`}
          badge={item.actionLabel || 'Открыть'}
          badgeTone={item.tone || 'blue'}
          onClick={() => perform(async () => {
            if (item.persisted && item.status === 'unread' && onStatusChange) await onStatusChange(item.id, 'read');
            await onOpen?.(item);
          })}
        />
        <div className="notification-actions">
          <Badge tone={item.status === 'unread' ? 'amber' : 'slate'}>{item.status === 'resolved' ? 'Завершено' : item.status === 'read' ? 'Прочитано' : 'Не прочитано'}</Badge>
          {item.persisted && onStatusChange ? <>
            <IconButton label={item.status === 'unread' ? 'Отметить прочитанным' : 'Отметить непрочитанным'} icon={item.status === 'unread' ? '✓' : '○'} disabled={busy} onClick={() => perform(() => onStatusChange(item.id, item.status === 'unread' ? 'read' : 'unread'))} />
            {item.status !== 'resolved' ? <IconButton label="Завершить уведомление" icon="×" disabled={busy} onClick={() => perform(() => onStatusChange(item.id, 'resolved'))} /> : null}
          </> : null}
        </div>
        </div>
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
