import React, { useEffect, useRef, useState } from 'react';
import { legacyIsReadOnly } from './legacyPolicy.js';
import LessonsPanel from './LessonsPanel.jsx';

const STATUS = { draft: 'Черновик', active: 'Активен', paused: 'Приостановлен', completed: 'Завершён', archived: 'В архиве' };
const ENROLLMENT_STATUS = { invited: 'Приглашён', active: 'Учится', paused: 'Пауза', completed: 'Завершил', withdrawn: 'Выбыл' };
const TEACHER_ROLE = { lead: 'Ведущий', assistant: 'Помощник', substitute: 'Замена' };
const FORMAT = { individual: 'Индивидуальный', group: 'Группа' };
const errorText = error => error?.message || 'Не удалось выполнить запрос.';

function MemberPicker({ api, context, role, value, onChange, label }) {
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    api.members(context, { role, status: 'active', q: query, limit: 25 })
      .then(result => { if (alive) { setMembers(result.items); setError(''); } })
      .catch(err => { if (alive) { setMembers([]); setError(errorText(err)); } });
    return () => { alive = false; };
  }, [api, context, role, query]);
  return <div className="course-member-picker">
    <label>{label}<input type="search" value={query} placeholder="Найти по имени или email" onChange={event => { setQuery(event.target.value); onChange(''); }} /></label>
    <label>Участник<select required value={value} onChange={event => onChange(event.target.value)}>
      <option value="">Выберите участника</option>
      {members.map(member => <option key={member.id} value={member.userId}>{member.displayName} · {member.email}</option>)}
    </select></label>
    {error && <p className="workspace-error" role="alert">{error}</p>}
  </div>;
}

function CreateCourse({ api, context, onCreated, onCancel, onAccessError }) {
  const [programQuery, setProgramQuery] = useState('');
  const [programs, setPrograms] = useState([]);
  const [programId, setProgramId] = useState('');
  const [versions, setVersions] = useState([]);
  const [versionId, setVersionId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState('individual');
  const [capacity, setCapacity] = useState(1);
  const [startsOn, setStartsOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [endsOn, setEndsOn] = useState('');
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api.programs(context, { q: programQuery, status: 'active', pageSize: 100 })
      .then(result => { if (alive) setPrograms(result.items); })
      .catch(err => { if (alive) { setError(errorText(err)); onAccessError(err); } });
    return () => { alive = false; };
  }, [api, context, programQuery, onAccessError]);

  useEffect(() => {
    if (!programId) { setVersions([]); setVersionId(''); return; }
    let alive = true;
    api.versions(context, programId, { versionStatus: 'published', pageSize: 100 })
      .then(result => { if (alive) setVersions(result.items); })
      .catch(err => { if (alive) { setError(errorText(err)); onAccessError(err); } });
    return () => { alive = false; };
  }, [api, context, programId, onAccessError]);

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api.createCourse(context, {
        programVersionId: versionId, title: title.trim(), defaultFormat: format,
        capacity: Number(capacity), startsOn, endsOn, timezone: timezone.trim(), leadTeacherUserId: teacherId,
      });
      onCreated(result.item);
    } catch (err) { setError(errorText(err)); onAccessError(err); }
    finally { setBusy(false); }
  }

  return <section className="course-create" aria-label="Новый курс">
    <div className="course-section-head"><h2>Новый курс</h2><button type="button" onClick={onCancel}>Отмена</button></div>
    <form onSubmit={submit} className="course-form">
      <label>Поиск программы<input type="search" value={programQuery} onChange={event => { setProgramQuery(event.target.value); setProgramId(''); setVersionId(''); }} /></label>
      <label>Программа<select required value={programId} onChange={event => { setProgramId(event.target.value); setVersionId(''); }}>
        <option value="">Выберите программу</option>
        {programs.map(program => <option key={program.id} value={program.id}>{program.name} · {program.examType.toUpperCase()} · {program.variant}</option>)}
      </select></label>
      <label>Версия<select required value={versionId} onChange={event => setVersionId(event.target.value)}>
        <option value="">Выберите опубликованную версию</option>
        {versions.map(version => <option key={version.id} value={version.id}>{version.period} · редакция {version.revisionNumber}</option>)}
      </select></label>
      <label>Название<input required minLength="2" maxLength="120" value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>Формат<select value={format} onChange={event => { setFormat(event.target.value); setCapacity(event.target.value === 'individual' ? 1 : 2); }}>
        <option value="individual">Индивидуальный</option><option value="group">Группа</option>
      </select></label>
      <label>Мест<input type="number" min="1" max="100" required value={capacity} disabled={format === 'individual'} onChange={event => setCapacity(event.target.value)} /></label>
      <label>Начало<input type="date" required value={startsOn} onChange={event => setStartsOn(event.target.value)} /></label>
      <label>Окончание<input type="date" required min={startsOn} value={endsOn} onChange={event => setEndsOn(event.target.value)} /></label>
      <label>Часовой пояс<input required value={timezone} onChange={event => setTimezone(event.target.value)} /></label>
      <MemberPicker api={api} context={context} role="teacher" value={teacherId} onChange={setTeacherId} label="Ведущий преподаватель" />
      {error && <p className="workspace-error" role="alert">{error}</p>}
      <button type="submit" disabled={busy || !versionId || !teacherId}>{busy ? 'Создаём…' : 'Создать курс'}</button>
    </form>
  </section>;
}

function BatchEnroll({ api, context, courseId, onApplied, onAccessError, disabled = false }) {
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState({});
  const [status, setStatus] = useState('active');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api.members(context, { role: 'student', status: 'active', q: query, limit: 50 })
      .then(result => { if (alive) setMembers(result.items); })
      .catch(err => { if (alive) { setError(errorText(err)); onAccessError(err); } });
    return () => { alive = false; };
  }, [api, context, query, onAccessError]);

  const body = { courseId, studentUserIds: Object.keys(selected), status };
  async function check() {
    setBusy(true); setError(''); setPreview(null);
    try { setPreview(await api.previewEnrollmentBatch(context, body)); }
    catch (err) { setError(errorText(err)); onAccessError(err); }
    finally { setBusy(false); }
  }
  async function apply() {
    setBusy(true); setError('');
    try {
      await api.applyEnrollmentBatch(context, body);
      setSelected({}); setPreview(null); onApplied();
    } catch (err) { setError(errorText(err)); setPreview(null); onAccessError(err); }
    finally { setBusy(false); }
  }

  return <div className="course-batch">
    <div className="course-section-head"><h3>Массовый набор</h3><span>{Object.keys(selected).length} выбрано</span></div>
    <div className="course-inline-form"><label>Поиск учеников<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label>Статус<select value={status} onChange={event => { setStatus(event.target.value); setPreview(null); }}><option value="active">Зачислить</option><option value="invited">Пригласить</option></select></label>
    </div>
    <div className="course-batch-members">{members.map(member => <label key={member.id}>
      <input type="checkbox" checked={Boolean(selected[member.userId])} disabled={disabled || busy || (!selected[member.userId] && Object.keys(selected).length >= 50)} onChange={event => {
        setSelected(current => { const next = { ...current }; if (event.target.checked) next[member.userId] = member.displayName; else delete next[member.userId]; return next; });
        setPreview(null);
      }} />{member.displayName}
    </label>)}</div>
    <div className="course-actions"><button type="button" disabled={disabled || busy || Object.keys(selected).length === 0} onClick={check}>Проверить набор</button>
      {preview?.canApply && <button type="button" disabled={disabled || busy} onClick={apply}>Зачислить всех</button>}
    </div>
    {preview && <div className="course-batch-preview"><strong>{preview.canApply ? 'Можно применить' : 'Есть конфликты'}</strong>
      {preview.items.map(item => <p key={item.studentUserId}>{item.displayName || item.studentUserId}: {item.reason || 'Готов'}</p>)}
    </div>}
    {error && <p className="workspace-error" role="alert">{error}</p>}
  </div>;
}

function CourseDetail({ api, context, course, onChanged, onBack, onAccessError, legacyRole, onLegacy }) {
  const [teachers, setTeachers] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [title, setTitle] = useState(course.title);
  const [capacity, setCapacity] = useState(course.capacity);
  const [endsOn, setEndsOn] = useState(course.endsOn || '');
  const [teacherId, setTeacherId] = useState('');
  const [teacherRole, setTeacherRole] = useState('assistant');
  const [studentId, setStudentId] = useState('');
  const [newStatus, setNewStatus] = useState('active');
  const [goal, setGoal] = useState('');
  const [note, setNote] = useState('');
  const [editingEnrollment, setEditingEnrollment] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const admin = context.role === 'admin';

  useEffect(() => { setTitle(course.title); setCapacity(course.capacity); setEndsOn(course.endsOn || ''); }, [course]);
  useEffect(() => {
    let alive = true;
    Promise.all([api.courseTeachers(context, course.id), api.courseEnrollments(context, course.id)])
      .then(([teacherList, enrollmentList]) => { if (alive) { setTeachers(teacherList.items); setEnrollments(enrollmentList.items); } })
      .catch(err => { if (alive) { setError(errorText(err)); onAccessError(err); } });
    return () => { alive = false; };
  }, [api, context, course.id, version, onAccessError]);

  async function perform(operation) {
    setBusy(true); setError('');
    try { const result = await operation(); onChanged(result.item?.program ? result.item : course); setVersion(value => value + 1); return result; }
    catch (err) { setError(errorText(err)); onAccessError(err); return null; }
    finally { setBusy(false); }
  }

  async function saveCourse(event) {
    event.preventDefault();
    await perform(() => api.updateCourse(context, course, { title: title.trim(), capacity: Number(capacity), endsOn }));
  }

  async function courseAction(action) {
    const messages = { complete: 'Завершить курс и все действующие зачисления?', archive: 'Отправить курс в архив?' };
    if (messages[action] && !window.confirm(messages[action])) return;
    await perform(() => api.courseAction(context, course, action));
  }

  async function addTeacher(event) {
    event.preventDefault();
    const result = await perform(() => api.addCourseTeacher(context, course.id, { teacherUserId: teacherId, role: teacherRole }));
    if (result) setTeacherId('');
  }

  async function addEnrollment(event) {
    event.preventDefault();
    const result = await perform(() => api.addCourseEnrollment(context, course.id, { studentUserId: studentId, status: newStatus, goal: goal.trim(), note: note.trim() }));
    if (result) { setStudentId(''); setGoal(''); setNote(''); }
  }

  async function changeEnrollment(event) {
    event.preventDefault();
    const result = await perform(() => api.updateCourseEnrollment(context, course.id, editingEnrollment, {
      ...(editingEnrollment.nextStatus !== editingEnrollment.status ? { status: editingEnrollment.nextStatus } : {}),
      goal: editingEnrollment.goal, note: editingEnrollment.note,
    }));
    if (result) setEditingEnrollment(null);
  }

  return <div className="workspace-content course-detail">
    <div className="course-section-head"><button type="button" onClick={onBack}>← К курсам</button><span>{STATUS[course.status]}</span></div>
    <h1>{course.title}</h1>
    <p className="course-subtitle">{course.program.subjectName} · {course.program.examType.toUpperCase()} · {course.program.variant} · {course.program.period}</p>
    <div className="course-facts"><span>{FORMAT[course.defaultFormat]}</span>{context.role !== 'student' && <span>{course.activeEnrollmentCount} / {course.capacity} мест</span>}<span>{course.startsOn} — {course.endsOn || 'Без срока'}</span><span>{course.timezone}</span></div>
    {legacyIsReadOnly(course) && <p className="workspace-muted">Исторический курс доступен для чтения. Занятия и работы пока ведутся в прежнем кабинете.</p>}
    {course.legacy && legacyRole === context.role && <button type="button" onClick={onLegacy}>Открыть учебный кабинет</button>}
    {admin && !legacyIsReadOnly(course) && <section className="course-section">
      <div className="course-section-head"><h2>Параметры</h2><div className="course-actions">
        {(['draft', 'paused'].includes(course.status)) && <button type="button" disabled={busy} onClick={() => courseAction('activate')}>Активировать</button>}
        {course.status === 'active' && <button type="button" disabled={busy} onClick={() => courseAction('pause')}>Пауза</button>}
        {['active', 'paused'].includes(course.status) && <button type="button" disabled={busy} onClick={() => courseAction('complete')}>Завершить</button>}
        {['draft', 'completed'].includes(course.status) && <button type="button" disabled={busy} onClick={() => courseAction('archive')}>В архив</button>}
      </div></div>
      {!['completed', 'archived'].includes(course.status) && <form className="course-inline-form" onSubmit={saveCourse}>
        <label>Название<input required minLength="2" maxLength="120" value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label>Мест<input type="number" min="1" max="100" disabled={course.defaultFormat === 'individual'} value={capacity} onChange={event => setCapacity(event.target.value)} /></label>
        <label>Окончание<input type="date" required min={course.startsOn} value={endsOn} onChange={event => setEndsOn(event.target.value)} /></label>
        <button type="submit" disabled={busy}>Сохранить</button>
      </form>}
    </section>}
    {error && <p className="workspace-error" role="alert">{error}</p>}
    <section className="course-section"><div className="course-section-head"><h2>Преподаватели</h2></div>
      <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Имя</th><th>Роль</th><th>Статус</th>{admin && <th>Действия</th>}</tr></thead><tbody>
        {teachers.map(teacher => <tr key={teacher.id}><td data-label="Имя">{teacher.displayName}</td><td data-label="Роль">{TEACHER_ROLE[teacher.role]}</td><td data-label="Статус">{teacher.status === 'active' ? 'Назначен' : 'Завершил'}</td>
          {admin && <td data-label="Действия">{teacher.status === 'active' && !legacyIsReadOnly(course) && <>
            <select aria-label={`Роль ${teacher.displayName}`} value={teacher.role} disabled={busy} onChange={event => perform(() => api.updateCourseTeacher(context, course.id, teacher, { role: event.target.value }))}>
              {Object.entries(TEACHER_ROLE).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <button type="button" disabled={busy} onClick={() => { if (window.confirm('Завершить назначение преподавателя?')) perform(() => api.updateCourseTeacher(context, course.id, teacher, { status: 'ended' })); }}>Снять</button>
          </>}</td>}
        </tr>)}
      </tbody></table></div>
      {admin && !legacyIsReadOnly(course) && !['completed', 'archived'].includes(course.status) && <form className="course-inline-form" onSubmit={addTeacher}>
        <MemberPicker api={api} context={context} role="teacher" value={teacherId} onChange={setTeacherId} label="Добавить преподавателя" />
        <label>Роль<select value={teacherRole} onChange={event => setTeacherRole(event.target.value)}>{Object.entries(TEACHER_ROLE).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <button type="submit" disabled={busy || !teacherId}>Добавить</button>
      </form>}
    </section>
    <section className="course-section"><div className="course-section-head"><h2>{context.role === 'student' ? 'Моё участие' : 'Ученики'}</h2></div>
      <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Ученик</th><th>Статус</th><th>Цель</th>{admin && <th>Действия</th>}</tr></thead><tbody>
        {enrollments.map(enrollment => <tr key={enrollment.id}><td data-label="Ученик">{enrollment.displayName}</td><td data-label="Статус">{ENROLLMENT_STATUS[enrollment.status]}</td><td data-label="Цель">{enrollment.goal || '—'}</td>
          {admin && <td data-label="Действия">{!legacyIsReadOnly(course) && <button type="button" onClick={() => setEditingEnrollment({ ...enrollment, nextStatus: enrollment.status })}>Изменить</button>}</td>}
        </tr>)}
      </tbody></table></div>
      {admin && !legacyIsReadOnly(course) && !['completed', 'archived'].includes(course.status) && <form className="course-inline-form" onSubmit={addEnrollment}>
        <MemberPicker api={api} context={context} role="student" value={studentId} onChange={setStudentId} label="Добавить ученика" />
        <label>Статус<select value={newStatus} onChange={event => setNewStatus(event.target.value)}><option value="active">Зачислить</option><option value="invited">Пригласить</option></select></label>
        <label>Цель<input maxLength="500" value={goal} onChange={event => setGoal(event.target.value)} /></label>
        <label>Заметка для команды<textarea maxLength="1000" value={note} onChange={event => setNote(event.target.value)} /></label>
        <button type="submit" disabled={busy || !studentId}>Добавить</button>
      </form>}
      {admin && !legacyIsReadOnly(course) && !['completed', 'archived'].includes(course.status) && <BatchEnroll api={api} context={context} courseId={course.id} disabled={busy} onApplied={() => { onChanged(course); setVersion(value => value + 1); }} onAccessError={onAccessError} />}
      {editingEnrollment && <form className="course-inline-form course-edit-enrollment" onSubmit={changeEnrollment}>
        <h3>{editingEnrollment.displayName}</h3>
        <label>Статус<select value={editingEnrollment.nextStatus} onChange={event => setEditingEnrollment(current => ({ ...current, nextStatus: event.target.value }))}>
          <option value={editingEnrollment.status}>{ENROLLMENT_STATUS[editingEnrollment.status]}</option>
          {({ invited: ['active', 'withdrawn'], active: ['paused', 'completed', 'withdrawn'], paused: ['active', 'completed', 'withdrawn'] })[editingEnrollment.status]?.map(status => <option key={status} value={status}>{ENROLLMENT_STATUS[status]}</option>)}
        </select></label>
        <label>Цель<input maxLength="500" value={editingEnrollment.goal} onChange={event => setEditingEnrollment(current => ({ ...current, goal: event.target.value }))} /></label>
        <label>Заметка для команды<textarea maxLength="1000" value={editingEnrollment.note || ''} onChange={event => setEditingEnrollment(current => ({ ...current, note: event.target.value }))} /></label>
        <button type="submit" disabled={busy}>Сохранить</button><button type="button" onClick={() => setEditingEnrollment(null)}>Отмена</button>
      </form>}
    </section>
    <LessonsPanel api={api} context={context} course={course} onAccessError={onAccessError} />
  </div>;
}

export default function CoursesPanel({ api, context, onAccessError, legacyRole, onLegacy, openCourseId = '' }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [format, setFormat] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const sequence = useRef(0);

  useEffect(() => { setPage(1); setRows([]); setSelectedId(''); setSelected(null); }, [context, query, status, format]);
  useEffect(() => { if (openCourseId) setSelectedId(openCourseId); }, [openCourseId, context]);
  useEffect(() => {
    const current = ++sequence.current;
    let alive = true;
    setLoading(true); setError('');
    api.courses(context, { q: query, status, format, page, pageSize: 25 })
      .then(result => { if (alive && sequence.current === current) { setRows(previous => page === 1 ? result.items : [...previous, ...result.items]); setTotal(result.total); } })
      .catch(err => { if (alive && sequence.current === current) { setError(errorText(err)); onAccessError(err); } })
      .finally(() => { if (alive && sequence.current === current) setLoading(false); });
    return () => { alive = false; };
  }, [api, context, query, status, format, page, version, onAccessError]);

  useEffect(() => {
    if (!selectedId) return;
    let alive = true;
    api.course(context, selectedId)
      .then(result => { if (alive) setSelected(result.item); })
      .catch(err => { if (alive) { setError(errorText(err)); onAccessError(err); } });
    return () => { alive = false; };
  }, [api, context, selectedId, version, onAccessError]);

  function changed(item) {
    if (item?.program) setSelected(item);
    setVersion(value => value + 1);
  }

  if (selectedId) return selected ? <CourseDetail key={selectedId} api={api} context={context} course={selected} onChanged={changed} onBack={() => { setSelectedId(''); setSelected(null); }} onAccessError={onAccessError} legacyRole={legacyRole} onLegacy={onLegacy} />
    : <main className="workspace-content"><button type="button" onClick={() => setSelectedId('')}>← К курсам</button><p className="workspace-muted">Загрузка курса…</p>{error && <p className="workspace-error" role="alert">{error}</p>}</main>;

  return <main className="workspace-content courses-panel">
    <div className="course-section-head"><h1>Курсы</h1>{context.role === 'admin' && <button type="button" onClick={() => setCreating(value => !value)}>{creating ? 'Закрыть форму' : 'Создать курс'}</button>}</div>
    {creating && <CreateCourse api={api} context={context} onCancel={() => setCreating(false)} onAccessError={onAccessError} onCreated={item => { setCreating(false); changed(item); setSelectedId(item.id); }} />}
    <div className="workspace-toolbar course-toolbar">
      <label>Поиск<input type="search" value={query} placeholder="Название курса" onChange={event => setQuery(event.target.value)} /></label>
      <label>Статус<select value={status} onChange={event => setStatus(event.target.value)}><option value="">Все</option>{Object.entries(STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Формат<select value={format} onChange={event => setFormat(event.target.value)}><option value="">Все</option>{Object.entries(FORMAT).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    </div>
    {error && <p className="workspace-error" role="alert">{error}</p>}
    {loading && rows.length === 0 && <p className="workspace-muted">Загрузка…</p>}
    {!loading && rows.length === 0 && !error && <p className="workspace-muted">Курсов пока нет.</p>}
    {rows.length > 0 && <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Курс</th><th>Программа</th><th>Формат</th><th>Статус</th><th>Мест</th><th></th></tr></thead><tbody>
      {rows.map(course => <tr key={course.id}><td data-label="Курс"><strong>{course.title}</strong><small>{course.startsOn} — {course.endsOn || 'Без срока'}</small></td>
        <td data-label="Программа">{course.program.subjectName} · {course.program.examType.toUpperCase()} · {course.program.variant}</td>
        <td data-label="Формат">{FORMAT[course.defaultFormat]}</td><td data-label="Статус">{STATUS[course.status]}</td>
        <td data-label="Мест">{context.role === 'student' ? '—' : `${course.activeEnrollmentCount} / ${course.capacity}`}</td>
        <td data-label="Действия"><button type="button" onClick={() => { setSelected(null); setSelectedId(course.id); }}>Открыть</button></td>
      </tr>)}
    </tbody></table></div>}
    {rows.length < total && <button type="button" className="workspace-more" disabled={loading} onClick={() => setPage(value => value + 1)}>{loading ? 'Загрузка…' : 'Показать ещё'}</button>}
    {legacyRole === context.role && <button type="button" className="course-legacy-link" onClick={onLegacy}>Открыть учебный кабинет</button>}
  </main>;
}
