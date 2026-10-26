import React, { useEffect, useState } from 'react';

const sourceLabel = { manual: 'Оценка', diagnostic: 'Диагностика', lesson: 'Занятие', submission: 'Проверка работы', legacy_unknown: 'История v1' };
const coverageLabel = { not_started: 'Не начато', in_progress: 'Изучается', assessment_needed: 'Нужна оценка', assessed: 'Оценено' };
const masteryLabel = { weak: 'Начальный', medium: 'Средний', good: 'Хороший', strong: 'Уверенный' };
const attendanceLabel = { unknown: 'Не отмечено', present: 'Присутствовал', absent: 'Отсутствовал', excused: 'Уважительная причина' };
const deliveryLabel = { queued: 'В очереди', processing: 'Обрабатывается', sent: 'Отправлено', failed: 'Ошибка', skipped: 'Пропущено', dev_preview: 'Локальный просмотр' };
const errorText = error => error?.message || 'Не удалось выполнить запрос.';
const dateTime = value => new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
function resultText(event) {
  if (!event) return 'Нет оценки';
  if (event.kind === 'retraction') return 'Оценка отозвана';
  if (event.score !== null) return `${event.score} / ${event.maxScore}`;
  return masteryLabel[event.masteryLevel] || coverageLabel[event.coverageStatus] || attendanceLabel[event.evidence?.attendance] || 'Учебное событие';
}

function AssessmentForm({ api, context, enrollmentId, task, event, onSaved, onClose, onAccessError }) {
  const [source, setSource] = useState(event?.source || 'manual');
  const [visibility, setVisibility] = useState(event?.visibility || 'private');
  const [coverage, setCoverage] = useState(event?.coverageStatus || 'assessed');
  const [mastery, setMastery] = useState(event?.masteryLevel || '');
  const [score, setScore] = useState(event?.score ?? '');
  const [basis, setBasis] = useState(event?.basis || '');
  const [comment, setComment] = useState(event?.comment || '');
  const [reason, setReason] = useState('');
  const [retract, setRetract] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await api.assessProgress(context, enrollmentId, { taskDefinitionId: task.taskDefinitionId, source, visibility, basis: basis.trim(), comment: comment.trim(), retract,
        ...(!retract ? { coverageStatus: coverage, ...(mastery ? { masteryLevel: mastery } : {}), ...(score !== '' ? { score: Number(score) } : {}) } : {}),
        ...(event ? { replacesEventId: event.id, reason: reason.trim() } : {}),
      });
      onSaved();
    } catch (err) { setError(errorText(err)); onAccessError(err); }
    finally { setBusy(false); }
  }
  return <form className="work-form learning-assessment" aria-label={event ? 'Исправление оценки' : 'Новая оценка'} onSubmit={save}>
    <div className="course-section-head"><h2>{event ? 'Исправление оценки' : 'Новая оценка'} · {task.code}</h2><button type="button" onClick={onClose}>Закрыть</button></div>
    <div className="course-inline-form"><label>Источник<select value={source} onChange={e => setSource(e.target.value)}><option value="manual">Оценка преподавателя</option><option value="diagnostic">Диагностика</option></select></label>
      <label>Видимость<select value={visibility} onChange={e => setVisibility(e.target.value)}><option value="private" disabled={event?.visibility === 'published'}>Только мне</option><option value="published">Опубликовать ученику</option></select></label></div>
    {event && <label className="learning-checkbox"><input type="checkbox" checked={retract} onChange={e => setRetract(e.target.checked)} />Отозвать ошибочную оценку</label>}
    {!retract && <div className="course-inline-form"><label>Состояние<select value={coverage} onChange={e => { setCoverage(e.target.value); if (e.target.value !== 'assessed') { setMastery(''); setScore(''); } }}>{Object.entries(coverageLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Уровень<select disabled={coverage !== 'assessed'} value={mastery} onChange={e => setMastery(e.target.value)}><option value="">Не задан</option>{Object.entries(masteryLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {task.maxScore !== null && <label>Балл · до {task.maxScore}<input type="number" min="0" max={task.maxScore} step="1" disabled={coverage !== 'assessed'} value={score} onChange={e => setScore(e.target.value)} /></label>}</div>}
    <label>Основание<input required minLength="5" maxLength="1000" value={basis} onChange={e => setBasis(e.target.value)} /></label>
    <label>Комментарий<textarea maxLength="5000" value={comment} onChange={e => setComment(e.target.value)} /></label>
    {event && <label>Причина исправления<input required minLength="5" maxLength="500" value={reason} onChange={e => setReason(e.target.value)} /></label>}
    {error && <p role="alert" className="workspace-error">{error}</p>}
    <button type="submit" disabled={busy}>{busy ? 'Сохраняем…' : event ? 'Сохранить исправление' : 'Сохранить оценку'}</button>
  </form>;
}

export function ProgressPanel({ api, context, onAccessError, openEnrollmentId = '', currentUserId }) {
  const [courses, setCourses] = useState([]);
  const [courseTotal, setCourseTotal] = useState(0);
  const [coursePage, setCoursePage] = useState(1);
  const [courseId, setCourseId] = useState('');
  const [enrollments, setEnrollments] = useState([]);
  const [enrollmentId, setEnrollmentId] = useState(openEnrollmentId);
  const [progress, setProgress] = useState(null);
  const [history, setHistory] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [taskFilter, setTaskFilter] = useState('');
  const [source, setSource] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [editing, setEditing] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    api.courses(context, { page: coursePage, pageSize: 100 }).then(result => { if (alive) { setCourses(current => coursePage === 1 ? result.items : [...current, ...result.items]); setCourseTotal(result.total); setCourseId(current => current || result.items[0]?.id || ''); } })
      .catch(err => { if (alive) { setError(errorText(err)); onAccessError(err); } });
    return () => { alive = false; };
  }, [api, context, coursePage, onAccessError]);
  useEffect(() => { if (openEnrollmentId) setEnrollmentId(openEnrollmentId); }, [openEnrollmentId]);
  useEffect(() => {
    if (!courseId) return;
    let alive = true;
    api.courseEnrollments(context, courseId).then(result => { if (alive) { setEnrollments(result.items); setEnrollmentId(current => current || result.items[0]?.id || ''); } })
      .catch(err => { if (alive) { setError(errorText(err)); onAccessError(err); } });
    return () => { alive = false; };
  }, [api, context, courseId, onAccessError]);
  const historyQuery = { taskDefinitionId: taskFilter, source, ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}), ...(to ? { to: new Date(`${to}T23:59:59.999`).toISOString() } : {}) };
  useEffect(() => {
    setEditing(null); setSummary(null); setProgress(null); setHistory([]); setNextCursor(null); setError('');
    if (!enrollmentId) return;
    let alive = true;
    setLoading(true);
    Promise.all([api.enrollmentProgress(context, enrollmentId), api.progressEvents(context, enrollmentId, { taskDefinitionId: taskFilter, source, ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}), ...(to ? { to: new Date(`${to}T23:59:59.999`).toISOString() } : {}) })])
      .then(([detail, events]) => { if (alive) { setProgress(detail.item); setCourseId(detail.item.courseId); setHistory(events.items); setNextCursor(events.pageInfo.nextCursor); } })
      .catch(err => { if (alive) { setError(errorText(err)); onAccessError(err); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [api, context, enrollmentId, taskFilter, source, from, to, version, onAccessError]);
  async function moreHistory() {
    setLoading(true); setError('');
    try { const result = await api.progressEvents(context, enrollmentId, { ...historyQuery, cursor: nextCursor }); setHistory(current => [...current, ...result.items]); setNextCursor(result.pageInfo.nextCursor); }
    catch (err) { setError(errorText(err)); onAccessError(err); }
    finally { setLoading(false); }
  }
  async function programSummary() {
    try { const result = await api.programProgress(context, progress.studentUserId, progress.programVersionId); setSummary(result.item); }
    catch (err) { setError(errorText(err)); onAccessError(err); }
  }
  return <main className="workspace-content learning-panel"><div className="course-section-head"><h1>Прогресс</h1><button type="button" onClick={() => setVersion(v => v + 1)} disabled={loading}>Обновить</button></div>
    <div className="workspace-toolbar"><label>Курс<select value={courseId} onChange={e => { if (e.target.value !== courseId) { setCourseId(e.target.value); setEnrollmentId(''); setEnrollments([]); setTaskFilter(''); } }}><option value="">Выберите курс</option>{courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}{progress && !courses.some(c => c.id === progress.courseId) && <option value={progress.courseId}>{progress.courseTitle}</option>}</select></label>
      <label>Ученик<select value={enrollmentId} onChange={e => { setEnrollmentId(e.target.value); setTaskFilter(''); }}><option value="">Выберите ученика</option>{enrollments.map(e => <option key={e.id} value={e.id}>{e.displayName || 'Мой прогресс'}</option>)}</select></label>
      {courses.length < courseTotal && <button type="button" onClick={() => setCoursePage(p => p + 1)}>Ещё курсы</button>}</div>
    {error && <p role="alert" className="workspace-error">{error}</p>}
    {loading && !progress && <p className="workspace-muted">Загрузка…</p>}
    {progress && <><div className="course-section-head"><div><h2>{progress.studentName}</h2><span className="workspace-muted">{progress.courseTitle}</span></div><button type="button" onClick={programSummary}>По программе</button></div>
      {editing && <AssessmentForm key={`${editing.task.taskDefinitionId}:${editing.event?.id || 'new'}`} api={api} context={context} enrollmentId={enrollmentId} {...editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setVersion(v => v + 1); }} onAccessError={onAccessError} />}
      <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Задание</th><th>Результат</th><th>Источник</th><th>Дата</th>{context.role === 'teacher' && <th></th>}</tr></thead><tbody>{progress.tasks.map(task => <tr key={task.taskDefinitionId}>
        <td data-label="Задание"><strong>{task.code} · {task.title}</strong>{task.privateEvents.length > 0 && <small>Личная оценка: {resultText(task.privateEvents[0])}</small>}</td><td data-label="Результат">{resultText(task.event)}</td><td data-label="Источник">{sourceLabel[task.event?.source] || '—'}</td><td data-label="Дата">{task.event ? dateTime(task.event.occurredAt) : '—'}</td>
        {context.role === 'teacher' && <td data-label="Действия"><button type="button" onClick={() => setEditing({ task })}>Оценить</button></td>}</tr>)}</tbody></table></div>
      {summary && <section className="course-section"><div className="course-section-head"><h2>Результаты по курсам</h2><button type="button" onClick={() => setSummary(null)}>Закрыть</button></div><div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Курс</th><th>Задание</th><th>Результат</th><th>Дата</th></tr></thead><tbody>{summary.courses.flatMap(course => course.tasks.filter(task => task.event).map(task => <tr key={`${course.enrollmentId}:${task.taskDefinitionId}`}><td data-label="Курс">{course.courseTitle}</td><td data-label="Задание">{task.code}</td><td data-label="Результат">{resultText(task.event)}</td><td data-label="Дата">{dateTime(task.event.occurredAt)}</td></tr>))}</tbody></table></div></section>}
      <section className="course-section"><h2>История</h2><div className="workspace-toolbar"><label>Задание<select value={taskFilter} onChange={e => setTaskFilter(e.target.value)}><option value="">Все</option>{progress.tasks.map(task => <option key={task.taskDefinitionId} value={task.taskDefinitionId}>{task.code} · {task.title}</option>)}</select></label>
        <label>Источник<select value={source} onChange={e => setSource(e.target.value)}><option value="">Все</option>{Object.entries(sourceLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>С<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>По<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label></div>
        {!history.length && <p className="workspace-muted">Записей пока нет.</p>}
        <div className="learning-history">{history.map(event => <article key={event.id} className="learning-event"><div className="course-section-head"><strong>{sourceLabel[event.source]} · {resultText(event)}</strong><span>{dateTime(event.occurredAt)}</span></div>
          <p>{progress.tasks.find(t => t.taskDefinitionId === event.taskDefinitionId)?.title || 'Общее событие'} · {event.authorName || 'Автор неизвестен'} · {event.visibility === 'private' ? 'Личная запись' : 'Опубликовано'}{event.replacedById ? ' · исправлено' : ''}</p>
          {event.basis && <p>{event.basis}</p>}{event.comment && <p className="work-answer">{event.comment}</p>}{event.reason && <p>Причина: {event.reason}</p>}
          {context.role === 'teacher' && event.authorUserId === currentUserId && ['manual', 'diagnostic'].includes(event.source) && !event.replacedById && <button type="button" onClick={() => setEditing({ task: progress.tasks.find(t => t.taskDefinitionId === event.taskDefinitionId), event })}>Исправить</button>}
        </article>)}</div>
        {nextCursor && <button type="button" disabled={loading} onClick={moreHistory}>Показать ещё</button>}
      </section></>}
  </main>;
}

export function NotificationsPanel({ api, context, onAccessError, onOpen, initialNotificationId = '' }) {
  const [tab, setTab] = useState('notifications');
  const [status, setStatus] = useState('all');
  const [deliveryStatus, setDeliveryStatus] = useState('');
  const [rows, setRows] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [asOf, setAsOf] = useState('');
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [preferenceLoading, setPreferenceLoading] = useState(true);
  const [selectedDelivery, setSelectedDelivery] = useState(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    setPreferenceLoading(true);
    api.notificationPreferences(context).then(result => { if (alive) setEmailEnabled(result.item.emailEnabled); }).catch(err => { if (alive) { setError(errorText(err)); onAccessError(err); } }).finally(() => { if (alive) setPreferenceLoading(false); });
    return () => { alive = false; };
  }, [api, context, onAccessError]);
  useEffect(() => {
    setRows([]); setNextCursor(null); setError(''); setLoading(true);
    let alive = true;
    const query = tab === 'notifications' ? api.learningNotifications(context, { status }) : api.notificationDeliveries(context, { status: deliveryStatus });
    query.then(result => { if (alive) { setRows(result.items); setNextCursor(result.pageInfo.nextCursor); if (tab === 'notifications') { setUnreadCount(result.unreadCount); setAsOf(result.asOf); } } })
      .catch(err => { if (alive) { setError(errorText(err)); onAccessError(err); } }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [api, context, tab, status, deliveryStatus, version, onAccessError]);
  useEffect(() => {
    if (!initialNotificationId) return;
    let alive = true;
    api.learningNotificationTarget(context, initialNotificationId).then(result => { if (alive) onOpen(result.item); }).catch(err => { if (alive) { setError(errorText(err)); onAccessError(err); } });
    return () => { alive = false; };
  }, [api, context, initialNotificationId, onOpen, onAccessError]);
  async function act(operation) {
    setBusy(true); setError('');
    try { await operation(); setVersion(v => v + 1); }
    catch (err) { setError(errorText(err)); onAccessError(err); }
    finally { setBusy(false); }
  }
  async function more() {
    setLoading(true);
    try { const result = tab === 'notifications' ? await api.learningNotifications(context, { status, cursor: nextCursor }) : await api.notificationDeliveries(context, { status: deliveryStatus, cursor: nextCursor }); setRows(current => [...current, ...result.items]); setNextCursor(result.pageInfo.nextCursor); }
    catch (err) { setError(errorText(err)); onAccessError(err); }
    finally { setLoading(false); }
  }
  return <main className="workspace-content learning-panel"><div className="course-section-head"><h1>Уведомления <span className="learning-count">{unreadCount}</span></h1><button type="button" disabled={loading} onClick={() => setVersion(v => v + 1)}>Обновить</button></div>
    <div className="workspace-tabs" role="tablist" aria-label="Уведомления и доставка"><button type="button" role="tab" aria-selected={tab === 'notifications'} onClick={() => setTab('notifications')}>Мои уведомления</button>{context.role === 'admin' && <button type="button" role="tab" aria-selected={tab === 'deliveries'} onClick={() => setTab('deliveries')}>Доставка</button>}</div>
    <div className="workspace-toolbar">{tab === 'notifications' ? <><label>Статус<select value={status} onChange={e => setStatus(e.target.value)}><option value="all">Все</option><option value="unread">Непрочитанные</option><option value="read">Прочитанные</option></select></label>
      <label className="learning-checkbox"><input type="checkbox" checked={emailEnabled} disabled={busy || preferenceLoading} onChange={e => { const enabled = e.target.checked; const previous = emailEnabled; setEmailEnabled(enabled); act(async () => { try { await api.setNotificationPreferences(context, enabled); } catch (err) { setEmailEnabled(previous); throw err; } }); }} />Получать email</label>
      <button type="button" disabled={busy || !unreadCount || !asOf} onClick={() => act(() => api.readAllLearningNotifications(context, asOf))}>Прочитать всё</button></> : <label>Статус доставки<select value={deliveryStatus} onChange={e => setDeliveryStatus(e.target.value)}><option value="">Все</option>{Object.entries(deliveryLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}</div>
    {error && <p role="alert" className="workspace-error">{error}</p>}
    {selectedDelivery && <form className="work-form" onSubmit={e => { e.preventDefault(); act(async () => { await api.retryNotificationDelivery(context, selectedDelivery, reason.trim()); setSelectedDelivery(null); setReason(''); }); }}><div className="course-section-head"><h2>Повтор доставки</h2><button type="button" onClick={() => setSelectedDelivery(null)}>Закрыть</button></div><label>Причина<input required minLength="5" maxLength="500" value={reason} onChange={e => setReason(e.target.value)} /></label><button type="submit" disabled={busy}>Поставить в очередь</button></form>}
    {loading && !rows.length && <p className="workspace-muted">Загрузка…</p>}{!loading && !rows.length && <p className="workspace-muted">Уведомлений нет.</p>}
    {tab === 'notifications' ? <div className="learning-notices">{rows.map(row => <article className={`learning-notice${row.readAt ? '' : ' is-unread'}`} key={row.id}><div><strong>{row.title}</strong><time>{dateTime(row.createdAt)}</time>{row.message && <p>{row.message}</p>}</div><div className="course-actions"><button type="button" disabled={busy} onClick={() => act(async () => { const result = await api.learningNotificationTarget(context, row.id); if (!row.readAt) await api.markLearningNotification(context, row, true); onOpen(result.item); })}>Открыть</button><button type="button" disabled={busy} onClick={() => act(() => api.markLearningNotification(context, row, !row.readAt))}>{row.readAt ? 'Не прочитано' : 'Прочитано'}</button></div></article>)}</div>
      : rows.length > 0 && <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Время</th><th>Событие</th><th>Состояние</th><th>Попытки</th><th>Ошибка</th><th></th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td data-label="Время">{dateTime(row.createdAt)}</td><td data-label="Событие">{row.type}</td><td data-label="Состояние">{deliveryLabel[row.status]}</td><td data-label="Попытки">{row.attempts}</td><td data-label="Ошибка">{row.lastErrorCode || '—'}</td><td data-label="Действия">{row.status === 'failed' && <button type="button" onClick={() => setSelectedDelivery(row)}>Повторить</button>}</td></tr>)}</tbody></table></div>}
    {nextCursor && <button type="button" disabled={loading} onClick={more}>Показать ещё</button>}
  </main>;
}
