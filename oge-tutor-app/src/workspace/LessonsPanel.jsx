import React, { useEffect, useState } from 'react';

const STATUS = { planned: 'Запланировано', rescheduled: 'Перенесено', completed: 'Проведено', canceled: 'Отменено' };
const ATTENDANCE = { unknown: 'Не отмечено', present: 'Присутствовал', absent: 'Отсутствовал', excused: 'Уважительная причина' };
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const day = date => new Date(date).toLocaleDateString('sv-SE');
const toInput = date => {
  const value = new Date(date);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const toIso = value => new Date(value).toISOString();
const displayTime = value => new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
const errorText = error => error?.message || 'Не удалось выполнить запрос.';

function choice(items, selected, onChange, title, key) {
  return <fieldset className="lesson-choices"><legend>{title}</legend>
    {items.map(item => <label key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={event => {
      onChange(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id));
    }} />{item.displayName}{item[key] === 'lead' ? ' · ведущий' : ''}</label>)}
  </fieldset>;
}

function LessonForm({ api, context, course, lesson, teachers, enrollments, onSaved, onCancel, onAccessError }) {
  const [topic, setTopic] = useState(lesson?.topic || '');
  const [startAt, setStartAt] = useState(lesson ? toInput(lesson.startAt) : toInput(new Date(Date.now() + 86400000)));
  const [endAt, setEndAt] = useState(lesson ? toInput(lesson.endAt) : toInput(new Date(Date.now() + 90000000)));
  const [format, setFormat] = useState(lesson?.format || course.defaultFormat);
  const [teacherLinkIds, setTeacherLinkIds] = useState(lesson ? lesson.teachers.map(item => item.courseTeacherId) : teachers.filter(item => item.status === 'active' && item.role === 'lead').map(item => item.id));
  const [participantEnrollmentIds, setParticipantEnrollmentIds] = useState(lesson ? lesson.participants.map(item => item.enrollmentId) : []);
  const [note, setNote] = useState(lesson?.note || '');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const eligibleTeachers = teachers.filter(item => item.status === 'active');
  const eligibleStudents = enrollments.filter(item => item.status === 'active');
  const canSubmit = topic.trim().length >= 2 && startAt && endAt && teacherLinkIds.length > 0 && participantEnrollmentIds.length > 0;
  const changed = setter => value => { setter(value); setPreview(null); };
  function body() {
    return {
      courseId: course.id, topic: topic.trim(), startAt: toIso(startAt), endAt: toIso(endAt),
      timezone: zone, format, teacherLinkIds, participantEnrollmentIds, note: note.trim(),
    };
  }
  async function check() {
    setBusy(true); setError(''); setPreview(null);
    try { setPreview(await api.previewLesson(context, body())); }
    catch (err) { setError(errorText(err)); onAccessError(err); }
    finally { setBusy(false); }
  }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (lesson) await api.updateLesson(context, lesson, (({ courseId: _courseId, ...patch }) => patch)(body()));
      else await api.createLesson(context, body());
      onSaved();
    } catch (err) { setError(errorText(err)); setPreview(null); onAccessError(err); }
    finally { setBusy(false); }
  }
  return <form className="lesson-form" onSubmit={save} aria-label={lesson ? 'Изменить занятие' : 'Новое занятие'}>
    <div className="course-section-head"><h3>{lesson ? 'Изменить занятие' : 'Новое занятие'}</h3><button type="button" onClick={onCancel}>Закрыть</button></div>
    <div className="course-inline-form">
      <label>Тема<input required minLength="2" maxLength="160" value={topic} onChange={event => changed(setTopic)(event.target.value)} /></label>
      <label>Начало<input type="datetime-local" required value={startAt} onChange={event => changed(setStartAt)(event.target.value)} /></label>
      <label>Конец<input type="datetime-local" required min={startAt} value={endAt} onChange={event => changed(setEndAt)(event.target.value)} /></label>
      <label>Формат<select value={format} onChange={event => changed(setFormat)(event.target.value)}>
        <option value="individual">Индивидуально</option>{course.defaultFormat === 'group' && <option value="group">Группа</option>}
      </select></label>
    </div>
    <p className="workspace-muted">Часовой пояс устройства: {zone}</p>
    {choice(eligibleTeachers, teacherLinkIds, changed(setTeacherLinkIds), 'Преподаватели', 'role')}
    <div className="course-section-head"><h4>Ученики</h4><button type="button" onClick={() => { setParticipantEnrollmentIds(eligibleStudents.map(item => item.id)); setPreview(null); }}>Выбрать всех</button></div>
    {choice(eligibleStudents, participantEnrollmentIds, changed(setParticipantEnrollmentIds), 'Участники занятия', 'status')}
    <label>Заметка для команды<textarea maxLength="1000" value={note} onChange={event => changed(setNote)(event.target.value)} /></label>
    {preview && <div className="course-batch-preview" role="status"><strong>{preview.canCreate ? 'Время свободно' : 'Есть пересечения'}</strong>
      {preview.conflicts.map(item => <p key={`${item.kind}:${item.userId}`}>{item.kind === 'teacher' ? 'Преподаватель' : 'Ученик'}: {item.userId}</p>)}
    </div>}
    {error && <p className="workspace-error" role="alert">{error}</p>}
    <div className="course-actions">{!lesson && <button type="button" disabled={busy || !canSubmit} onClick={check}>Проверить время</button>}
      <button type="submit" disabled={busy || !canSubmit || (!lesson && !preview?.canCreate)}>{busy ? 'Сохраняем…' : lesson ? 'Сохранить' : 'Запланировать'}</button>
    </div>
  </form>;
}

function LessonRow({ api, context, lesson, onChanged, onAccessError }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [options, setOptions] = useState(null);
  const [attendance, setAttendance] = useState({});
  const [correction, setCorrection] = useState(null);
  const [reason, setReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [canceling, setCanceling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canManage = context.role !== 'student' && !lesson.legacy;
  async function action(operation) {
    setBusy(true); setError('');
    try { await operation(); setEditing(false); setCorrection(null); setCanceling(false); onChanged(); }
    catch (err) { setError(errorText(err)); onAccessError(err); }
    finally { setBusy(false); }
  }
  async function beginEdit() {
    setBusy(true); setError('');
    try {
      const [course, teachers, enrollments] = await Promise.all([
        api.course(context, lesson.courseId), api.courseTeachers(context, lesson.courseId), api.courseEnrollments(context, lesson.courseId),
      ]);
      setOptions({ course: course.item, teachers: teachers.items, enrollments: enrollments.items }); setEditing(true);
    } catch (err) { setError(errorText(err)); onAccessError(err); }
    finally { setBusy(false); }
  }
  const statuses = lesson.participants.map(item => ({ enrollmentId: item.enrollmentId, attendance: attendance[item.enrollmentId] || item.attendance }));
  const completeReady = new Date(lesson.startAt) <= new Date() && statuses.length > 0 && statuses.every(item => item.attendance !== 'unknown');
  return <article className="lesson-item">
    <div className="course-section-head"><div><strong>{lesson.topic}</strong><p>{displayTime(lesson.startAt)} – {displayTime(lesson.endAt)} · {lesson.courseTitle}</p></div><span>{STATUS[lesson.status]}</span></div>
    <div className="course-actions"><button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Свернуть' : 'Подробнее'}</button></div>
    {expanded && <div className="lesson-details">
      <p>Преподаватели: {lesson.teachers.map(item => item.displayName).join(', ')}</p>
      {lesson.participants.map(item => <div className="lesson-attendance-row" key={item.enrollmentId}>
        <span>{item.displayName || 'Моё участие'}</span><span>{ATTENDANCE[item.attendance]}</span>
        {canManage && ['planned', 'rescheduled'].includes(lesson.status) && <select aria-label={`Посещаемость ${item.displayName}`} value={attendance[item.enrollmentId] || item.attendance} onChange={event => setAttendance(current => ({ ...current, [item.enrollmentId]: event.target.value }))}>
          {Object.entries(ATTENDANCE).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>}
        {canManage && lesson.status === 'completed' && <button type="button" onClick={() => { setCorrection(item.enrollmentId); setAttendance(current => ({ ...current, [item.enrollmentId]: item.attendance })); setReason(''); }}>Исправить</button>}
      </div>)}
      {lesson.note && canManage && <p>Заметка: {lesson.note}</p>}
      {lesson.completionComment && canManage && <p>Итог: {lesson.completionComment}</p>}
      {canManage && ['planned', 'rescheduled'].includes(lesson.status) && <div className="course-actions">
        <button type="button" disabled={busy} onClick={beginEdit}>Изменить</button>
        <button type="button" disabled={busy || !completeReady} onClick={() => action(() => api.completeLesson(context, lesson, { attendance: statuses }))}>Проведено</button>
        <button type="button" disabled={busy} onClick={() => setCanceling(value => !value)}>Отменить</button>
      </div>}
      {canceling && <form className="course-inline-form" onSubmit={event => { event.preventDefault(); action(() => api.cancelLesson(context, lesson, cancelReason.trim())); }}>
        <label>Причина отмены<input required minLength="5" maxLength="500" value={cancelReason} onChange={event => setCancelReason(event.target.value)} /></label>
        <button type="submit" disabled={busy || cancelReason.trim().length < 5}>Подтвердить отмену</button>
        <button type="button" onClick={() => setCanceling(false)}>Назад</button>
      </form>}
      {correction && <form className="course-inline-form" onSubmit={event => { event.preventDefault(); const current = statuses.find(item => item.enrollmentId === correction); action(() => api.correctLessonAttendance(context, lesson, { enrollmentId: correction, attendance: current.attendance === 'unknown' ? 'present' : current.attendance, reason: reason.trim() })); }}>
        <label>Новая отметка<select value={attendance[correction] || lesson.participants.find(item => item.enrollmentId === correction)?.attendance} onChange={event => setAttendance(current => ({ ...current, [correction]: event.target.value }))}>
          {Object.entries(ATTENDANCE).filter(([key]) => key !== 'unknown').map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label>Причина<input required minLength="5" maxLength="500" value={reason} onChange={event => setReason(event.target.value)} /></label>
        <button type="submit" disabled={busy || reason.trim().length < 5}>Сохранить исправление</button><button type="button" onClick={() => setCorrection(null)}>Отмена</button>
      </form>}
      {editing && options && <LessonForm api={api} context={context} lesson={lesson} {...options} onSaved={() => { setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} onAccessError={onAccessError} />}
      {error && <p className="workspace-error" role="alert">{error}</p>}
    </div>}
  </article>;
}

export default function LessonsPanel({ api, context, course = null, onAccessError, openLessonId = '' }) {
  const [from, setFrom] = useState(() => day(Date.now() - 7 * 86400000));
  const [to, setTo] = useState(() => day(Date.now() + 60 * 86400000));
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const [options, setOptions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [openedLesson, setOpenedLesson] = useState(null);
  useEffect(() => {
    if (!openLessonId) return;
    let alive = true;
    api.lesson(context, openLessonId).then(result => { if (alive) setOpenedLesson(result.item); })
      .catch(err => { if (alive) { setError(errorText(err)); onAccessError(err); } });
    return () => { alive = false; };
  }, [api, context, openLessonId, version, onAccessError]);
  const refresh = () => { setPage(1); setVersion(value => value + 1); };
  useEffect(() => { setPage(1); setRows([]); }, [context, course?.id, from, to]);
  useEffect(() => {
    if (!from || !to || to <= from || (new Date(to).getTime() - new Date(from).getTime()) > 89 * 86400000) return;
    let alive = true;
    setLoading(true); setError('');
    api.lessons(context, { courseId: course?.id, from: toIso(`${from}T00:00`), to: toIso(`${to}T23:59`), page, pageSize: 25 })
      .then(result => { if (alive) { setRows(previous => page === 1 ? result.items : [...previous, ...result.items]); setTotal(result.total); } })
      .catch(err => { if (alive) { setError(errorText(err)); onAccessError(err); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [api, context, course?.id, from, to, page, version, onAccessError]);
  async function beginCreate() {
    setError('');
    try {
      const [teachers, enrollments] = await Promise.all([api.courseTeachers(context, course.id), api.courseEnrollments(context, course.id)]);
      setOptions({ teachers: teachers.items, enrollments: enrollments.items }); setCreating(true);
    } catch (err) { setError(errorText(err)); onAccessError(err); }
  }
  const invalidRange = !from || !to || to <= from || (new Date(to).getTime() - new Date(from).getTime()) > 89 * 86400000;
  return <section className={course ? 'course-section lesson-panel' : 'workspace-content lesson-panel'}>
    <div className="course-section-head"><h2>{course ? 'Занятия' : 'Расписание'}</h2>
      {course && !course.legacy && course.status === 'active' && context.role !== 'student' && <button type="button" onClick={beginCreate}>Запланировать</button>}
    </div>
    <div className="course-inline-form"><label>С<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>По<input type="date" value={to} onChange={event => setTo(event.target.value)} /></label></div>
    {invalidRange && <p className="workspace-error" role="alert">Выберите диапазон не более 90 дней.</p>}
    {creating && options && <LessonForm api={api} context={context} course={course} {...options} onSaved={() => { setCreating(false); refresh(); }} onCancel={() => setCreating(false)} onAccessError={onAccessError} />}
    {error && <p className="workspace-error" role="alert">{error}</p>}
    {loading && rows.length === 0 && <p className="workspace-muted">Загрузка…</p>}
    {!loading && rows.length === 0 && !error && !invalidRange && <p className="workspace-muted">Занятий в этом периоде нет.</p>}
    {openedLesson && <div className="lesson-list"><LessonRow key={openedLesson.id} api={api} context={context} lesson={openedLesson} onChanged={refresh} onAccessError={onAccessError} /></div>}
    <div className="lesson-list">{rows.filter(lesson => lesson.id !== openedLesson?.id).map(lesson => <LessonRow key={lesson.id} api={api} context={context} lesson={lesson} onChanged={refresh} onAccessError={onAccessError} />)}</div>
    {rows.length < total && <button type="button" className="workspace-more" disabled={loading} onClick={() => setPage(value => value + 1)}>Показать ещё</button>}
  </section>;
}
