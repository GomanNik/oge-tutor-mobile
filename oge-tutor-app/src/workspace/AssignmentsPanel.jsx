import React, { useEffect, useState } from 'react';

const assignmentStatus = { draft: 'Черновик', published: 'Выдана', closed: 'Закрыта', archived: 'Архив' };
const recipientStatus = { assigned: 'Ожидает', submitted: 'Сдана', needs_revision: 'Доработка', reviewed: 'Проверена', exempted: 'Освобождён', closed: 'Закрыта' };
const errorText = error => error?.message || 'Не удалось выполнить запрос.';
const safeHttpUrl = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; } };
const dateTime = value => new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
const toInput = value => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const future = () => toInput(Date.now() + 7 * 86400000);

function FilePicker({ api, context, files, setFiles, onError }) {
  const [busy, setBusy] = useState(false);
  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try { const result = await api.uploadWorkFile(context, file); setFiles(current => [...current, result.item]); }
    catch (error) { onError(error); }
    finally { setBusy(false); }
  }
  async function remove(file) {
    try { await api.deleteWorkFile(context, file.id); setFiles(current => current.filter(item => item.id !== file.id)); }
    catch (error) { onError(error); }
  }
  return <div className="work-files"><label>Файлы<input type="file" disabled={busy || files.length >= 10} onChange={upload} /></label>
    {files.map(file => <span key={file.id}><button type="button" onClick={() => api.downloadWorkFile(context, file).catch(onError)}>{file.originalName}</button>
      <button type="button" aria-label={`Убрать ${file.originalName}`} onClick={() => setFiles(current => current.filter(item => item.id !== file.id))}>×</button>
      <button type="button" onClick={() => remove(file)}>Удалить файл</button></span>)}
  </div>;
}

function RecipientChoice({ api, context, courseId, selected, setSelected, exclude = [] }) {
  const [enrollments, setEnrollments] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!courseId) return;
    let alive = true;
    api.courseEnrollments(context, courseId).then(result => { if (alive) setEnrollments(result.items); })
      .catch(err => { if (alive) setError(errorText(err)); });
    return () => { alive = false; };
  }, [api, context, courseId]);
  const eligible = enrollments.filter(item => item.status === 'active' && !exclude.includes(item.id));
  return <fieldset className="lesson-choices"><legend>Получатели</legend>
    <div className="course-section-head"><span>{selected.length} выбрано</span><button type="button" onClick={() => setSelected(eligible.map(item => item.id))}>Выбрать всех</button></div>
    {eligible.map(item => <label key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={event => setSelected(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} />{item.displayName}</label>)}
    {!eligible.length && <p className="workspace-muted">Нет доступных учеников.</p>}
    {error && <p className="workspace-error" role="alert">{error}</p>}
  </fieldset>;
}

function AssignmentEditor({ api, context, courses, assignment, onSaved, onCancel, onAccessError }) {
  const [courseId, setCourseId] = useState(assignment?.courseId || courses.find(c => c.status === 'active')?.id || '');
  const course = courses.find(item => item.id === courseId);
  const [title, setTitle] = useState(assignment?.title || '');
  const [instructions, setInstructions] = useState(assignment?.instructions || '');
  const [dueAt, setDueAt] = useState(assignment ? toInput(assignment.dueAt) : future());
  const [tasks, setTasks] = useState([]);
  const [taskIds, setTaskIds] = useState(assignment?.taskDefinitionIds || []);
  const [files, setFiles] = useState(assignment?.files || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!course?.programVersionId) return;
    let alive = true;
    api.catalogTasks(context, course.programVersionId, { pageSize: 100 }).then(result => { if (alive) setTasks(result.items); })
      .catch(err => { if (alive) { setError(errorText(err)); onAccessError(err); } });
    return () => { alive = false; };
  }, [api, context, course?.programVersionId, onAccessError]);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const body = { title: title.trim(), instructions: instructions.trim(), dueAt: new Date(dueAt).toISOString(), taskDefinitionIds: taskIds, fileIds: files.map(file => file.id) };
      const result = assignment ? await api.updateAssignment(context, assignment, body) : await api.createAssignment(context, { ...body, courseId });
      onSaved(result.item);
    } catch (err) { setError(errorText(err)); onAccessError(err); }
    finally { setBusy(false); }
  }
  return <form className="work-form" onSubmit={save} aria-label={assignment ? 'Изменить работу' : 'Новая работа'}>
    <div className="course-section-head"><h2>{assignment ? 'Изменить работу' : 'Новая работа'}</h2><button type="button" onClick={onCancel}>Закрыть</button></div>
    <label>Курс<select required disabled={Boolean(assignment)} value={courseId} onChange={event => { setCourseId(event.target.value); setTaskIds([]); }}><option value="">Выберите курс</option>{courses.filter(item => item.status === 'active').map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    <label>Название<input required minLength="2" maxLength="160" value={title} onChange={event => setTitle(event.target.value)} /></label>
    <label>Условие<textarea required minLength="1" maxLength="20000" value={instructions} onChange={event => setInstructions(event.target.value)} /></label>
    <label>Срок<input type="datetime-local" required min={toInput(Date.now() + 60000)} value={dueAt} onChange={event => setDueAt(event.target.value)} /></label>
    {tasks.length > 0 && <fieldset className="lesson-choices"><legend>Задания программы</legend>{tasks.map(task => <label key={task.id}><input type="checkbox" checked={taskIds.includes(task.id)} onChange={event => setTaskIds(current => event.target.checked ? [...current, task.id] : current.filter(id => id !== task.id))} />{task.code} · {task.title}</label>)}</fieldset>}
    <FilePicker api={api} context={context} files={files} setFiles={setFiles} onError={err => { setError(errorText(err)); onAccessError(err); }} />
    {error && <p className="workspace-error" role="alert">{error}</p>}
    <button type="submit" disabled={busy || !courseId}>{busy ? 'Сохраняем…' : 'Сохранить черновик'}</button>
  </form>;
}

function ReviewForm({ api, context, assignment, recipient, submission, onSaved, onAccessError }) {
  const latest = submission.reviews.at(-1);
  const draft = latest?.status === 'draft' ? latest : null;
  const [decision, setDecision] = useState(draft?.decision || latest?.decision || 'accepted');
  const [comment, setComment] = useState(draft?.comment || latest?.comment || '');
  const [reason, setReason] = useState(draft?.reason || '');
  const [files, setFiles] = useState(draft?.files || []);
  const [scores, setScores] = useState(draft?.scores || latest?.scores || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function scoreFor(taskId, criterionCode) { return scores.find(item => item.taskDefinitionId === taskId && (item.criterionCode || '') === criterionCode)?.score ?? ''; }
  function setScore(taskId, criterionCode, value) {
    setScores(current => [...current.filter(item => !(item.taskDefinitionId === taskId && item.criterionCode === criterionCode)), ...(value === '' ? [] : [{ taskDefinitionId: taskId, ...(criterionCode ? { criterionCode } : {}), score: Number(value) }])]);
  }
  async function act(operation) {
    setBusy(true); setError('');
    try { await operation(); onSaved(); }
    catch (err) { setError(errorText(err)); onAccessError(err); }
    finally { setBusy(false); }
  }
  const body = { decision, comment: comment.trim(), scores, fileIds: files.map(file => file.id), ...(reason.trim() ? { reason: reason.trim() } : {}) };
  return <form className="work-form" onSubmit={event => { event.preventDefault(); act(() => draft ? api.updateReview(context, draft, body) : api.createReview(context, submission.id, recipient.revision, body)); }}>
    <h4>{draft ? 'Черновик проверки' : latest ? 'Исправить проверку' : 'Проверить попытку'}</h4>
    <label>Решение<select value={decision} onChange={event => setDecision(event.target.value)}><option value="accepted">Принять</option><option value="rework">На доработку</option></select></label>
    <label>Комментарий<textarea maxLength="10000" required={decision === 'rework'} value={comment} onChange={event => setComment(event.target.value)} /></label>
    {latest?.status === 'published' && <label>Причина исправления<input required minLength="5" maxLength="500" value={reason} onChange={event => setReason(event.target.value)} /></label>}
    {assignment.tasks?.map(task => <fieldset className="work-scores" key={task.id}><legend>{task.code} · {task.title}</legend>
      {(task.criteria.length ? task.criteria : [{ code: '', title: 'Балл', maxScore: task.maxScore }]).map(criterion => <label key={criterion.code}>{criterion.title} · до {criterion.maxScore}
        <input type="number" min="0" max={criterion.maxScore ?? 1000} value={scoreFor(task.id, criterion.code)} onChange={event => setScore(task.id, criterion.code, event.target.value)} /></label>)}
    </fieldset>)}
    <FilePicker api={api} context={context} files={files} setFiles={setFiles} onError={err => setError(errorText(err))} />
    {error && <p className="workspace-error" role="alert">{error}</p>}
    <div className="course-actions"><button disabled={busy} type="submit">Сохранить проверку</button>
      {draft && <button disabled={busy} type="button" onClick={() => act(() => api.publishReview(context, draft))}>Опубликовать результат</button>}</div>
  </form>;
}

function RecipientDetail({ api, context, assignment, recipient, refresh, onAccessError }) {
  const [submissions, setSubmissions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [reason, setReason] = useState('');
  const [dueAt, setDueAt] = useState(toInput(recipient.dueAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    api.submissions(context, recipient.id, { page, pageSize: 10 }).then(result => { if (alive) { setSubmissions(result.items); setTotal(result.total); } })
      .catch(err => { if (alive) { setError(errorText(err)); onAccessError(err); } });
    return () => { alive = false; };
  }, [api, context, recipient.id, page, version, onAccessError]);
  async function act(operation) {
    setBusy(true); setError('');
    try { await operation(); setVersion(value => value + 1); refresh(); }
    catch (err) { setError(errorText(err)); onAccessError(err); }
    finally { setBusy(false); }
  }
  return <div className="work-recipient-detail">
    <p>{recipientStatus[recipient.status]} · срок {dateTime(recipient.dueAt)}{recipient.overdue ? ' · просрочено' : ''}</p>
    {context.role === 'student' && assignment.status === 'published' && !assignment.legacy && ['assigned', 'needs_revision'].includes(recipient.status) && <form className="work-form" onSubmit={event => { event.preventDefault(); act(() => api.submitAssignment(context, recipient, { text, fileIds: files.map(file => file.id) })); }}>
      <label>Ответ<textarea maxLength="30000" value={text} onChange={event => setText(event.target.value)} /></label>
      <FilePicker api={api} context={context} files={files} setFiles={setFiles} onError={err => setError(errorText(err))} />
      <button type="submit" disabled={busy || (!text.trim() && !files.length)}>Сдать работу</button>
    </form>}
    {context.role !== 'student' && assignment.status === 'published' && !assignment.legacy && !['submitted', 'reviewed'].includes(recipient.status) && <form className="work-form" onSubmit={event => { event.preventDefault(); act(() => api.updateAssignmentRecipient(context, assignment.id, recipient, { reason: reason.trim(), dueAt: new Date(dueAt).toISOString() })); }}>
      <label>Персональный срок<input type="datetime-local" required value={dueAt} onChange={event => setDueAt(event.target.value)} /></label>
      <label>Причина<input required minLength="5" maxLength="500" value={reason} onChange={event => setReason(event.target.value)} /></label>
      <div className="course-actions"><button disabled={busy} type="submit">Изменить срок</button>
        <button disabled={busy || !reason.trim()} type="button" onClick={() => act(() => api.updateAssignmentRecipient(context, assignment.id, recipient, { status: 'exempted', reason: reason.trim() }))}>Освободить</button>
        {['exempted', 'closed'].includes(recipient.status) && <button disabled={busy || !reason.trim()} type="button" onClick={() => act(() => api.updateAssignmentRecipient(context, assignment.id, recipient, { status: 'assigned', reason: reason.trim(), dueAt: new Date(dueAt).toISOString() }))}>Открыть снова</button>}</div>
    </form>}
    {submissions.map(submission => <section className="work-attempt" key={submission.id}><h4>Попытка {submission.attempt} · {dateTime(submission.submittedAt)}{submission.late ? ' · после срока' : ''}</h4>
      {submission.text && <p className="work-answer">{submission.text}</p>}
      {submission.files.map(file => <button key={file.id} type="button" onClick={() => api.downloadWorkFile(context, file).catch(err => setError(errorText(err)))}>{file.originalName}</button>)}
      {submission.reviews.map(review => <div className="work-review" key={review.id}><strong>{review.status === 'draft' ? 'Черновик' : review.decision === 'accepted' ? 'Принято' : 'На доработку'}</strong> · {review.comment}
        {review.scores?.length > 0 && <p>Баллы: {review.scores.map(score => `${score.criterionCode || score.taskDefinitionId}: ${score.score}`).join(', ')}</p>}
        {review.files.map(file => <button key={file.id} type="button" onClick={() => api.downloadWorkFile(context, file).catch(err => setError(errorText(err)))}>{file.originalName}</button>)}
        {review.legacyMaterials?.map((item, index) => safeHttpUrl(item.url) && <a key={index} href={safeHttpUrl(item.url)} rel="noreferrer" target="_blank">{item.title || 'Материал'}</a>)}
      </div>)}
      {context.role === 'teacher' && assignment.canReview && !assignment.legacy && submission.attempt === submissions[0]?.attempt && <ReviewForm key={`${submission.id}:${submission.reviews.at(-1)?.id || ''}:${submission.reviews.at(-1)?.revision || 0}`} api={api} context={context} assignment={assignment} recipient={recipient} submission={submission} onSaved={() => { setVersion(value => value + 1); refresh(); }} onAccessError={onAccessError} />}
    </section>)}
    {total > 10 && <div className="course-actions"><button type="button" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Назад</button><span>{page} / {Math.ceil(total / 10)}</span><button type="button" disabled={page * 10 >= total} onClick={() => setPage(p => p + 1)}>Далее</button></div>}
    {error && <p className="workspace-error" role="alert">{error}</p>}
  </div>;
}

function AssignmentDetail({ api, context, item, onChanged, onBack, onAccessError, courses }) {
  const [assignment, setAssignment] = useState(item);
  const [recipients, setRecipients] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState([]);
  const [activeRecipientId, setActiveRecipientId] = useState('');
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    Promise.all([api.assignment(context, item.id), api.assignmentRecipients(context, item.id, { page, pageSize: 25 })])
      .then(([detail, list]) => { if (alive) { setAssignment(detail.item); setRecipients(list.items); setTotal(list.total); } })
      .catch(err => { if (alive) { setError(errorText(err)); onAccessError(err); } });
    return () => { alive = false; };
  }, [api, context, item.id, page, version, onAccessError]);
  async function act(operation) {
    setBusy(true); setError('');
    try { await operation(); setSelected([]); setVersion(value => value + 1); onChanged(); }
    catch (err) { setError(errorText(err)); onAccessError(err); }
    finally { setBusy(false); }
  }
  const active = recipients.find(row => row.id === activeRecipientId);
  return <section className="work-detail"><div className="course-section-head"><div><button type="button" onClick={onBack}>← К списку</button><h2>{assignment.title}</h2></div><span>{assignmentStatus[assignment.status]}</span></div>
    <p>{assignment.courseTitle} · срок {dateTime(assignment.dueAt)}</p><p className="work-answer">{assignment.instructions}</p>
    {assignment.tasks?.length > 0 && <p>Задания: {assignment.tasks.map(task => task.code).join(', ')}</p>}
    {assignment.legacy && <p className="workspace-muted">Историческая работа · редактирование в прежнем кабинете.</p>}
    {assignment.files?.map(file => <button key={file.id} type="button" onClick={() => api.downloadWorkFile(context, file).catch(err => setError(errorText(err)))}>{file.originalName}</button>)}
    {assignment.legacyMaterials?.map((material, index) => safeHttpUrl(material.url) && <a key={index} href={safeHttpUrl(material.url)} rel="noreferrer" target="_blank">{material.title || 'Материал'}</a>)}
    {context.role !== 'student' && !assignment.legacy && <div className="work-actions">
      {assignment.status === 'draft' && <button type="button" onClick={() => setEditing(value => !value)}>Изменить</button>}
      {['published', 'closed', 'draft'].includes(assignment.status) && <label>Причина действия<input minLength="5" maxLength="500" value={reason} onChange={event => setReason(event.target.value)} /></label>}
      {assignment.status === 'published' && <button type="button" disabled={busy || reason.trim().length < 5} onClick={() => act(() => api.assignmentAction(context, assignment, 'close', reason.trim()))}>Закрыть работу</button>}
      {['draft', 'closed'].includes(assignment.status) && <button type="button" disabled={busy || reason.trim().length < 5} onClick={() => act(() => api.assignmentAction(context, assignment, 'archive', reason.trim()))}>В архив</button>}
    </div>}
    {editing && <AssignmentEditor api={api} context={context} courses={courses} assignment={assignment} onSaved={updated => { setAssignment(updated); setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} onAccessError={onAccessError} />}
    {context.role !== 'student' && !assignment.legacy && ['draft', 'published'].includes(assignment.status) && <form className="work-publish" onSubmit={event => { event.preventDefault(); act(() => api.publishAssignment(context, assignment, selected, assignment.status === 'published')); }}>
      <RecipientChoice api={api} context={context} courseId={assignment.courseId} selected={selected} setSelected={setSelected} exclude={recipients.map(row => row.enrollmentId)} />
      <button type="submit" disabled={busy || !selected.length}>{assignment.status === 'draft' ? 'Выдать работу' : 'Добавить получателей'}</button>
    </form>}
    <div className="course-section-head"><h3>Получатели</h3><span>{total}</span></div>
    <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Ученик</th><th>Срок</th><th>Состояние</th><th></th></tr></thead><tbody>
      {recipients.map(recipient => <tr key={recipient.id}><td data-label="Ученик">{recipient.displayName || 'Моя работа'}</td><td data-label="Срок">{dateTime(recipient.dueAt)}</td><td data-label="Состояние">{recipientStatus[recipient.status]}{recipient.overdue ? ' · просрочено' : ''}</td><td data-label="Действия"><button type="button" onClick={() => setActiveRecipientId(recipient.id === activeRecipientId ? '' : recipient.id)}>{recipient.id === activeRecipientId ? 'Свернуть' : 'Открыть'}</button></td></tr>)}
    </tbody></table></div>
    {active && context.role !== 'admin' && <RecipientDetail key={active.id} api={api} context={context} assignment={assignment} recipient={active} refresh={() => { setVersion(value => value + 1); onChanged(); }} onAccessError={onAccessError} />}
    {total > 25 && <div className="course-actions"><button type="button" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Назад</button><span>{page} / {Math.ceil(total / 25)}</span><button type="button" disabled={page * 25 >= total} onClick={() => setPage(p => p + 1)}>Далее</button></div>}
    {error && <p className="workspace-error" role="alert">{error}</p>}
  </section>;
}

function MaterialEditor({ api, context, courses, item, onSaved, onCancel, onAccessError }) {
  const [courseId, setCourseId] = useState(courses.find(c => c.status === 'active' && (!item || c.programVersionId === item.programVersionId))?.id || '');
  const course = courses.find(c => c.id === courseId);
  const [tasks, setTasks] = useState([]);
  const [taskIds, setTaskIds] = useState(item?.taskDefinitionIds || []);
  const [title, setTitle] = useState(item?.title || '');
  const [description, setDescription] = useState(item?.description || '');
  const [url, setUrl] = useState(item?.url || '');
  const [files, setFiles] = useState(item?.file ? [item.file] : []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!course?.programVersionId) return;
    let alive = true;
    api.catalogTasks(context, course.programVersionId, { pageSize: 100 }).then(result => { if (alive) setTasks(result.items); })
      .catch(err => { if (alive) setError(errorText(err)); });
    return () => { alive = false; };
  }, [api, context, course?.programVersionId]);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const body = { title: title.trim(), description: description.trim(), taskDefinitionIds: taskIds, ...(files[0] ? { fileId: files[0].id } : { url: url.trim() }) };
      const result = item ? await api.updateLearningMaterial(context, item, body) : await api.createLearningMaterial(context, { ...body, programVersionId: course.programVersionId });
      onSaved(result.item);
    } catch (err) { setError(errorText(err)); onAccessError(err); }
    finally { setBusy(false); }
  }
  return <form className="work-form" onSubmit={save}><div className="course-section-head"><h2>{item ? 'Изменить материал' : 'Новый материал'}</h2><button type="button" onClick={onCancel}>Закрыть</button></div>
    {!item && <label>Курс и программа<select required value={courseId} onChange={event => { setCourseId(event.target.value); setTaskIds([]); }}><option value="">Выберите курс</option>{courses.filter(c => c.status === 'active').map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>}
    <label>Название<input required minLength="2" maxLength="160" value={title} onChange={event => setTitle(event.target.value)} /></label>
    <label>Описание<textarea maxLength="10000" value={description} onChange={event => setDescription(event.target.value)} /></label>
    {tasks.length > 0 && <fieldset className="lesson-choices"><legend>Задания</legend>{tasks.map(task => <label key={task.id}><input type="checkbox" checked={taskIds.includes(task.id)} onChange={event => setTaskIds(current => event.target.checked ? [...current, task.id] : current.filter(id => id !== task.id))} />{task.code} · {task.title}</label>)}</fieldset>}
    <label>Ссылка<input type="url" disabled={files.length > 0} value={url} onChange={event => setUrl(event.target.value)} placeholder="https://" /></label>
    <FilePicker api={api} context={context} files={files} setFiles={next => setFiles(current => (typeof next === 'function' ? next(current) : next).slice(-1))} onError={err => setError(errorText(err))} />
    {error && <p className="workspace-error" role="alert">{error}</p>}
    <button type="submit" disabled={busy || (!item && !courseId) || (!url.trim() && !files.length)}>{busy ? 'Сохраняем…' : 'Сохранить материал'}</button>
  </form>;
}

function MaterialDetail({ api, context, item, courses, onBack, onChanged, onAccessError }) {
  const [material, setMaterial] = useState(item);
  const [courseId, setCourseId] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [lessons, setLessons] = useState([]);
  const [selected, setSelected] = useState([]);
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    api.learningMaterial(context, item.id).then(result => { if (alive) setMaterial(result.item); })
      .catch(err => { if (alive) { setError(errorText(err)); onAccessError(err); } });
    return () => { alive = false; };
  }, [api, context, item.id, version, onAccessError]);
  useEffect(() => {
    if (!courseId) return;
    let alive = true;
    api.lessons(context, { courseId, from: new Date(Date.now() - 30 * 86400000).toISOString(), to: new Date(Date.now() + 59 * 86400000).toISOString(), pageSize: 100 }).then(result => { if (alive) setLessons(result.items); }).catch(() => {});
    return () => { alive = false; };
  }, [api, context, courseId]);
  async function act(operation) {
    setBusy(true); setError('');
    try { await operation(); setVersion(v => v + 1); setSelected([]); onChanged(); }
    catch (err) { setError(errorText(err)); onAccessError(err); }
    finally { setBusy(false); }
  }
  return <section className="work-detail"><div className="course-section-head"><div><button type="button" onClick={onBack}>← К списку</button><h2>{material.title}</h2></div><span>{material.archivedAt ? 'Архив' : 'Материал'}</span></div>
    <p>{material.subjectName} · {material.programName}</p><p className="work-answer">{material.description}</p>
    {safeHttpUrl(material.url) && <a href={safeHttpUrl(material.url)} target="_blank" rel="noreferrer">Открыть ссылку</a>}
    {material.file && <button type="button" onClick={() => api.downloadWorkFile(context, material.file).catch(err => setError(errorText(err)))}>{material.file.originalName}</button>}
    {material.legacy && <p className="workspace-muted">Исторический материал · редактирование в прежнем кабинете.</p>}
    {(material.canEdit || material.canArchive) && <div className="work-actions">
      {material.canEdit && <button type="button" onClick={() => setEditing(true)}>Изменить</button>}
      {material.canArchive && <><label>Причина<input minLength="5" maxLength="500" value={reason} onChange={event => setReason(event.target.value)} /></label>
        <button type="button" disabled={busy || reason.trim().length < 5} onClick={() => act(() => api.archiveLearningMaterial(context, material, reason.trim()))}>В архив</button></>}
    </div>}
    {editing && <MaterialEditor api={api} context={context} courses={courses} item={material} onSaved={updated => { setMaterial(updated); setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} onAccessError={onAccessError} />}
    {context.role !== 'student' && !material.legacy && !material.archivedAt && <form className="work-publish" onSubmit={event => { event.preventDefault(); act(() => api.publishLearningMaterial(context, material, { courseId, ...(lessonId ? { lessonId } : {}), recipientEnrollmentIds: selected })); }}>
      <h3>Опубликовать</h3><label>Курс<select required value={courseId} onChange={event => { setCourseId(event.target.value); setSelected([]); setLessonId(''); }}><option value="">Выберите курс</option>{courses.filter(c => c.status === 'active' && c.programVersionId === material.programVersionId).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
      {courseId && <><label>Занятие<select value={lessonId} onChange={event => setLessonId(event.target.value)}><option value="">Курс целиком</option>{lessons.filter(l => l.status !== 'canceled').map(l => <option key={l.id} value={l.id}>{l.topic} · {dateTime(l.startAt)}</option>)}</select></label>
        <RecipientChoice api={api} context={context} courseId={courseId} selected={selected} setSelected={setSelected} /></>}
      <button type="submit" disabled={busy || !selected.length}>Опубликовать</button>
    </form>}
    {material.publications?.length > 0 && <div className="work-publications"><h3>Публикации</h3>{material.publications.map(p => <div key={p.id}><span>{courses.find(c => c.id === p.courseId)?.title || p.courseId} · {dateTime(p.publishedAt)} · {p.recipientEnrollmentIds.length} получателей{p.revokedAt ? ' · отозвана' : ''}</span>
      {context.role !== 'student' && !p.revokedAt && <button type="button" disabled={busy || reason.trim().length < 5} onClick={() => act(() => api.revokeLearningMaterial(context, material, p, reason.trim()))}>Отозвать</button>}</div>)}</div>}
    {error && <p className="workspace-error" role="alert">{error}</p>}
  </section>;
}

export default function AssignmentsPanel({ api, context, onAccessError, openTarget = null }) {
  const [tab, setTab] = useState('assignments');
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!openTarget) return;
    let alive = true;
    const material = openTarget.type === 'material';
    (material ? api.learningMaterial(context, openTarget.id) : api.assignment(context, openTarget.id))
      .then(result => { if (alive) { setTab(material ? 'materials' : 'assignments'); setSelected(result.item); } })
      .catch(err => { if (alive) { setError(errorText(err)); onAccessError(err); } });
    return () => { alive = false; };
  }, [api, context, openTarget, onAccessError]);
  useEffect(() => {
    let alive = true;
    api.courses(context, { pageSize: 100 }).then(result => { if (alive) setCourses(result.items); })
      .catch(err => { if (alive) { setError(errorText(err)); onAccessError(err); } });
    return () => { alive = false; };
  }, [api, context, onAccessError]);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    const filter = { page, pageSize: 25, courseId, q: query, ...(tab === 'assignments' ? { status } : { programVersionId: courses.find(c => c.id === courseId)?.programVersionId, status: status || 'active' }) };
    const operation = tab === 'assignments' ? api.assignments(context, filter) : api.learningMaterials(context, filter);
    operation.then(result => { if (alive) { setItems(result.items); setTotal(result.total); } })
      .catch(err => { if (alive) { setError(errorText(err)); onAccessError(err); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [api, context, tab, courseId, status, query, page, version, courses, onAccessError]);
  const refresh = () => setVersion(value => value + 1);
  return <main className="workspace-content"><div className="course-section-head"><h1>Работы и материалы</h1>{context.role !== 'student' && !selected && <button type="button" onClick={() => setCreating(true)}>Создать</button>}</div>
    <div className="workspace-tabs" role="tablist" aria-label="Работы и материалы">{[['assignments', 'Работы'], ['materials', 'Материалы']].map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} type="button" onClick={() => { setTab(value); setStatus(''); setPage(1); setSelected(null); setCreating(false); }}>{label}</button>)}</div>
    {selected ? tab === 'assignments' ? <AssignmentDetail api={api} context={context} item={selected} courses={courses} onChanged={refresh} onBack={() => setSelected(null)} onAccessError={onAccessError} /> : <MaterialDetail api={api} context={context} item={selected} courses={courses} onChanged={refresh} onBack={() => setSelected(null)} onAccessError={onAccessError} /> : <>
      {creating && (tab === 'assignments' ? <AssignmentEditor api={api} context={context} courses={courses} onSaved={item => { setCreating(false); setSelected(item); refresh(); }} onCancel={() => setCreating(false)} onAccessError={onAccessError} /> : <MaterialEditor api={api} context={context} courses={courses} onSaved={item => { setCreating(false); setSelected(item); refresh(); }} onCancel={() => setCreating(false)} onAccessError={onAccessError} />)}
      <div className="workspace-toolbar"><label>Поиск<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
        <label>Курс<select value={courseId} onChange={event => { setCourseId(event.target.value); setPage(1); }}><option value="">Все курсы</option>{courses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
        <label>Статус<select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">{tab === 'assignments' ? 'Все' : 'Активные'}</option>{tab === 'assignments' ? Object.entries(assignmentStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>) : <option value="archived">Архив</option>}</select></label>
      </div>
      {error && <p className="workspace-error" role="alert">{error}</p>}
      {loading && <p className="workspace-muted">Загрузка…</p>}
      {!loading && !items.length && <p className="workspace-muted">Пока нет записей.</p>}
      {items.length > 0 && <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Название</th><th>{tab === 'assignments' ? 'Курс' : 'Программа'}</th><th>{tab === 'assignments' ? 'Срок' : 'Добавлен'}</th><th>Статус</th><th></th></tr></thead><tbody>
        {items.map(item => <tr key={item.id}><td data-label="Название"><strong>{item.title}</strong></td><td data-label={tab === 'assignments' ? 'Курс' : 'Программа'}>{tab === 'assignments' ? item.courseTitle : item.programName}</td><td data-label={tab === 'assignments' ? 'Срок' : 'Добавлен'}>{dateTime(tab === 'assignments' ? item.dueAt : item.createdAt)}</td><td data-label="Статус">{tab === 'assignments' ? assignmentStatus[item.status] : item.archivedAt ? 'Архив' : 'Активен'}</td><td data-label="Действия"><button type="button" onClick={() => setSelected(item)}>Открыть</button></td></tr>)}
      </tbody></table></div>}
      {total > 25 && <div className="course-actions"><button type="button" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Назад</button><span>{page} / {Math.ceil(total / 25)}</span><button type="button" disabled={page * 25 >= total} onClick={() => setPage(p => p + 1)}>Далее</button></div>}
    </>}
  </main>;
}
