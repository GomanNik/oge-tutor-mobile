import React, { useEffect, useRef, useState } from 'react';

const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const statuses = { active: 'Действует', paused: 'Приостановлена', canceled: 'Отменена', completed: 'Завершена' };
const frequencies = { daily: 'Дни', weekly: 'Недели', monthly: 'Месяцы' };
const actionLabels = { materialize: 'Продлить горизонт', pause: 'Приостановить', resume: 'Возобновить', cancel: 'Отменить серию' };
const errorText = error => error?.message || 'Не удалось выполнить запрос.';
const localTime = (date, timezone) => {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(date));
  const value = type => parts.find(p => p.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`;
};
const display = (date, timezone) => new Date(date).toLocaleString('ru-RU', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' });
const isReadOnly = item => item.legacyReadOnly ?? item.legacy;

export function SeriesPreview({ preview, timezone }) {
  return <section className="series-preview" aria-label="Предпросмотр серии"><h3>{preview.canApply ? 'Пакет готов' : 'Пакет заблокирован'}</h3>
    <p>Добавится: {preview.occurrences.length} · Отменится: {preview.cancelLessons.length} · Сохранится в истории: {preview.preservedCount}</p>
    <div className="series-preview-list">{preview.occurrences.map(row => <div key={`create:${row.key}`}><span>Добавить</span><time>{display(row.startAt, timezone)}</time></div>)}
      {preview.cancelLessons.map(row => <div key={`cancel:${row.id}`}><span>Отменить</span><time>{display(row.startAt, timezone)}</time></div>)}</div>
    {preview.issues.map((issue, index) => <p className="workspace-error" key={`${issue.occurrenceKey}:${index}`}>{issue.occurrenceKey} · {issue.code === 'lesson_conflict' ? 'Пересечение расписания' : issue.code === 'ambiguous_or_nonexistent_local_time' ? 'Неоднозначное или отсутствующее локальное время' : issue.code === 'series_self_overlap' ? 'Занятия серии пересекаются' : 'Дата вне периода курса или участия'}</p>)}
  </section>;
}

export function SeriesForm({ api, context, course, item, teachers, enrollments, onSaved, onClose, onAccessError }) {
  const start = item?.startsAtLocal || localTime(Date.now() + 2 * 86400000, course.timezone);
  const [values, setValues] = useState(() => ({
    topic: item?.topic || '', startsAtLocal: start, untilLocalDate: item?.untilLocalDate || new Date(new Date(`${start.slice(0, 10)}T12:00:00Z`).getTime() + 90 * 86400000).toISOString().slice(0, 10),
    timezone: item?.timezone || course.timezone, frequency: item?.frequency || 'weekly', interval: item?.interval || 1, durationMinutes: item?.durationMinutes || 60,
    materializeDays: item?.materializeDays || 45, dstDisambiguation: item?.dstDisambiguation || 'reject', format: item?.format || course.defaultFormat,
    weekdays: item?.weekdays || [new Date(`${start.slice(0, 10)}T12:00:00Z`).getUTCDay() || 7], monthDays: (item?.monthDays || []).join(', '),
    excludedDates: (item?.excludedDates || []).join('\n'), teacherLinkIds: item?.teacherLinkIds || teachers.filter(t => t.status === 'active' && t.role === 'lead').map(t => t.id),
    participantEnrollmentIds: item?.participantEnrollmentIds || [], note: item?.note || '', reason: '',
  }));
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = useRef(crypto.randomUUID());
  function change(name, value) { setValues(current => ({ ...current, [name]: value })); setPreview(null); key.current = crypto.randomUUID(); }
  function toggle(name, value) { change(name, values[name].includes(value) ? values[name].filter(v => v !== value) : [...values[name], value]); }
  function body() {
    const { reason, ...fields } = values;
    return { ...fields, courseId: course.id, topic: fields.topic.trim(), note: fields.note.trim(), weekdays: fields.frequency === 'weekly' ? fields.weekdays : [],
      monthDays: fields.frequency === 'monthly' ? fields.monthDays.split(/[,;\s]+/).filter(Boolean).map(Number) : [],
      excludedDates: fields.excludedDates.split(/[,;\s]+/).filter(Boolean), ...(item ? { reason: reason.trim() } : {}) };
  }
  async function check() {
    setBusy(true); setError(''); setPreview(null);
    try { setPreview(await api.previewSeries(context, body(), item)); }
    catch (err) { setError(errorText(err)); onAccessError(err); }
    finally { setBusy(false); }
  }
  async function save(event) {
    event.preventDefault();
    if (!preview?.canApply) return;
    setBusy(true); setError('');
    try { await api.saveSeries(context, { ...body(), previewToken: preview.previewToken }, item, key.current); onSaved(); }
    catch (err) { setError(errorText(err)); if ([409, 412].includes(err.status)) setPreview(null); onAccessError(err); }
    finally { setBusy(false); }
  }
  const valid = values.topic.trim().length >= 2 && values.teacherLinkIds.length > 0 && values.participantEnrollmentIds.length > 0 && (!item || values.reason.trim().length >= 5);
  return <form className="series-form" aria-label={item ? 'Изменение серии' : 'Новая серия'} onSubmit={save}>
    <div className="course-section-head"><h3>{item ? 'Изменение серии' : 'Новая серия'}</h3><button type="button" disabled={busy} onClick={onClose}>Закрыть</button></div>
    <fieldset disabled={busy} className="series-fields"><div className="course-inline-form">
      <label>Тема<input required minLength="2" maxLength="160" value={values.topic} onChange={e => change('topic', e.target.value)} /></label>
      <label>Первое локальное начало<input required type="datetime-local" value={values.startsAtLocal} onChange={e => change('startsAtLocal', e.target.value)} /></label>
      <label>Окончание серии<input required type="date" min={values.startsAtLocal.slice(0, 10)} value={values.untilLocalDate} onChange={e => change('untilLocalDate', e.target.value)} /></label>
      <label>Часовой пояс<input required maxLength="100" value={values.timezone} onChange={e => change('timezone', e.target.value)} /></label>
      <label>Повторение<select value={values.frequency} onChange={e => change('frequency', e.target.value)}>{Object.entries(frequencies).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Интервал<input type="number" required min="1" max="12" step="1" value={values.interval} onChange={e => change('interval', Number(e.target.value))} /></label>
      <label>Длительность, мин<input type="number" required min="15" max="480" step="1" value={values.durationMinutes} onChange={e => change('durationMinutes', Number(e.target.value))} /></label>
      <label>Горизонт, дней<input type="number" required min="7" max="90" step="1" value={values.materializeDays} onChange={e => change('materializeDays', Number(e.target.value))} /></label>
      <label>Неоднозначное время<select value={values.dstDisambiguation} onChange={e => change('dstDisambiguation', e.target.value)}><option value="reject">Запретить</option><option value="earlier">Первое вхождение</option><option value="later">Второе вхождение</option></select></label>
      <label>Формат<select value={values.format} onChange={e => change('format', e.target.value)}><option value="individual">Индивидуально</option>{course.defaultFormat === 'group' && <option value="group">Группа</option>}</select></label>
    </div>
    {values.frequency === 'weekly' && <fieldset className="series-weekdays"><legend>Дни недели</legend>{weekdays.map((label, index) => <label key={label}><input type="checkbox" checked={values.weekdays.includes(index + 1)} onChange={() => toggle('weekdays', index + 1)} />{label}</label>)}</fieldset>}
    {values.frequency === 'monthly' && <label>Дни месяца<input value={values.monthDays} onChange={e => change('monthDays', e.target.value)} /></label>}
    <div className="course-inline-form"><label>Исключённые даты<textarea value={values.excludedDates} onChange={e => change('excludedDates', e.target.value)} /></label>
      <label>Заметка команды<textarea maxLength="1000" value={values.note} onChange={e => change('note', e.target.value)} /></label></div>
    <fieldset className="lesson-choices"><legend>Преподаватели серии</legend>{teachers.filter(t => t.status === 'active' || values.teacherLinkIds.includes(t.id)).map(t => <label key={t.id}><input type="checkbox" checked={values.teacherLinkIds.includes(t.id)} onChange={() => toggle('teacherLinkIds', t.id)} />{t.displayName}</label>)}</fieldset>
    <fieldset className="lesson-choices"><legend>Участники серии</legend>{enrollments.filter(e => e.status === 'active' || values.participantEnrollmentIds.includes(e.id)).map(e => <label key={e.id}><input type="checkbox" checked={values.participantEnrollmentIds.includes(e.id)} onChange={() => toggle('participantEnrollmentIds', e.id)} />{e.displayName}</label>)}</fieldset>
    {item && <label>Причина изменения<input required minLength="5" maxLength="500" value={values.reason} onChange={e => change('reason', e.target.value)} /></label>}
    </fieldset>
    {preview && <SeriesPreview preview={preview} timezone={values.timezone} />}
    {error && <p className="workspace-error" role="alert">{error}</p>}
    <div className="course-actions"><button type="button" disabled={busy || !valid} onClick={check}>Предпросмотр серии</button><button type="submit" disabled={busy || !valid || !preview?.canApply}>{busy ? 'Сохраняем…' : item ? 'Применить изменения' : 'Создать серию'}</button></div>
  </form>;
}

function SeriesAction({ api, context, item, action, onSaved, onClose, onAccessError }) {
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = useRef(crypto.randomUUID());
  async function perform(apply) {
    setBusy(true); setError('');
    try {
      const body = { action, reason: reason.trim() };
      if (!apply) setPreview(await api.previewSeriesAction(context, item, body));
      else { await api.seriesAction(context, item, { ...body, previewToken: preview.previewToken }, key.current); onSaved(); }
    } catch (err) { setError(errorText(err)); if ([409, 412].includes(err.status)) setPreview(null); onAccessError(err); }
    finally { setBusy(false); }
  }
  return <form className="series-form" aria-label={actionLabels[action]} onSubmit={e => { e.preventDefault(); if (preview?.canApply) perform(true); }}>
    <div className="course-section-head"><h3>{actionLabels[action]}</h3><button type="button" disabled={busy} onClick={onClose}>Закрыть</button></div>
    <label>Причина<input required minLength="5" maxLength="500" disabled={busy} value={reason} onChange={e => { setReason(e.target.value); setPreview(null); key.current = crypto.randomUUID(); }} /></label>
    {preview && <SeriesPreview preview={preview} timezone={item.timezone} />}{error && <p className="workspace-error" role="alert">{error}</p>}
    <div className="course-actions"><button type="button" disabled={busy || reason.trim().length < 5} onClick={() => perform(false)}>Предпросмотр изменений</button><button type="submit" disabled={busy || !preview?.canApply}>Подтвердить</button></div>
  </form>;
}

export default function SeriesPanel({ api, context, course, onAccessError, onChanged }) {
  const [courses, setCourses] = useState(course ? [course] : []);
  const [courseId, setCourseId] = useState(course?.id || '');
  const [coursePage, setCoursePage] = useState(1);
  const [courseTotal, setCourseTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState(null);
  const [options, setOptions] = useState(null);
  const [action, setAction] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const selected = courses.find(c => c.id === courseId);
  useEffect(() => {
    if (course) return;
    let alive = true;
    api.courses(context, { page: coursePage, pageSize: 100 }).then(result => { if (alive) { setCourses(current => coursePage === 1 ? result.items : [...current, ...result.items]); setCourseTotal(result.total); } })
      .catch(err => { if (alive) { setError(errorText(err)); onAccessError(err); } });
    return () => { alive = false; };
  }, [api, context, course, coursePage, onAccessError]);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    api.lessonSeries(context, { courseId, status, page, pageSize: 25 }).then(result => { if (alive) { setRows(current => page === 1 ? result.items : [...current, ...result.items]); setTotal(result.total); } })
      .catch(err => { if (alive) { setError(errorText(err)); onAccessError(err); } }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [api, context, courseId, status, page, version, onAccessError]);
  function refresh() { setEditing(null); setAction(null); setOptions(null); setPage(1); setVersion(v => v + 1); onChanged?.(); }
  async function edit(item) {
    setLoading(true); setError('');
    try {
      const itemCourse = item ? courses.find(c => c.id === item.courseId) || (await api.course(context, item.courseId)).item : selected;
      if (!itemCourse) return;
      const [teachers, enrollments] = await Promise.all([api.courseTeachers(context, itemCourse.id), api.courseEnrollments(context, itemCourse.id)]);
      setOptions({ course: itemCourse, teachers: teachers.items, enrollments: enrollments.items }); setEditing({ item }); setAction(null);
    } catch (err) { setError(errorText(err)); onAccessError(err); }
    finally { setLoading(false); }
  }
  return <section className="series-panel"><div className="course-section-head"><h2>Серии занятий</h2><button type="button" disabled={loading} onClick={refresh}>Обновить серии</button></div>
    <div className="workspace-toolbar">{!course && <label>Курс серии<select value={courseId} onChange={e => { setCourseId(e.target.value); setPage(1); setRows([]); setEditing(null); setAction(null); }}><option value="">Все курсы</option>{courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>}
      <label>Статус серии<select value={status} onChange={e => { setStatus(e.target.value); setPage(1); setRows([]); }}><option value="">Все</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {selected && selected.status === 'active' && !isReadOnly(selected) && <button type="button" disabled={loading} onClick={() => edit(null)}>Новая серия</button>}
      {!course && courses.length < courseTotal && <button type="button" disabled={loading} onClick={() => setCoursePage(p => p + 1)}>Ещё курсы</button>}</div>
    {editing && options && <SeriesForm key={editing.item?.id || 'new'} api={api} context={context} item={editing.item} {...options} onSaved={refresh} onClose={() => setEditing(null)} onAccessError={onAccessError} />}
    {action && <SeriesAction key={`${action.item.id}:${action.action}`} api={api} context={context} {...action} onSaved={refresh} onClose={() => setAction(null)} onAccessError={onAccessError} />}
    {error && <p className="workspace-error" role="alert">{error}</p>}{loading && !rows.length && <p className="workspace-muted">Загрузка…</p>}{!loading && !rows.length && !error && <p className="workspace-muted">Серий пока нет.</p>}
    <div className="series-list">{rows.map(item => <article className="series-item" key={item.id}><div className="course-section-head"><div><h3>{item.topic}</h3><p>{item.startsAtLocal.replace('T', ' ')} · {item.timezone} · до {item.untilLocalDate}</p><p>{frequencies[item.frequency]} · интервал {item.interval} · {item.durationMinutes} мин · горизонт {item.materializeDays} дней</p></div><span>{statuses[item.status]}</span></div>
      {item.lastErrorCode && <p className="workspace-error">Ошибка продления: {item.lastErrorCode}</p>}
      {!['canceled', 'completed'].includes(item.status) && <div className="course-actions"><button type="button" disabled={loading} onClick={() => edit(item)}>Изменить серию</button>{[...(item.status === 'active' ? ['materialize'] : []), item.status === 'paused' ? 'resume' : 'pause', 'cancel'].map(value => <button key={value} type="button" disabled={loading} onClick={() => { setEditing(null); setAction({ item, action: value }); }}>{actionLabels[value]}</button>)}</div>}
    </article>)}</div>
    {rows.length < total && <button type="button" disabled={loading} onClick={() => setPage(p => p + 1)}>Ещё серии</button>}
  </section>;
}
