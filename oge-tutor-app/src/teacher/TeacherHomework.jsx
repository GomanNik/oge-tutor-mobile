/*
 * OGE Tutor App — teacher homework lifecycle screens.
 * Homework actions use backend-ready dates, submission entities and immutable contract status codes.
 */
import React, { useState } from 'react';
import { HOMEWORK_STATUS, statusLabel } from '../api/contracts.js';
import { AttachmentPicker } from '../shared/attachments.jsx';
import { selectHomework, selectStudent } from '../app/selectors.js';
import { HOMEWORK_FILTERS } from '../shared/constants.js';
import { dateInputValue, endOfLocalDayIso, formatDateLabel, formatDateTimeLabel, isPastIso } from '../shared/dateTime.js';
import { formatMaterialCount, homeworkStatusHint, isHomeworkClosed, isHomeworkEditable, isHomeworkReviewable, isHomeworkWaitingStudent, parseTaskNumberInput, parseTaskNumbers } from '../shared/formatters.js';
import { logger } from '../shared/logger.js';
import { Badge, Button, Card, EmptyState, Field, Header, MaterialList, RowCard, Section, SelectField, TextArea, cx, iconByStatus, toneByStatus } from '../shared/ui.jsx';

const getStudent = selectStudent;
const getHomework = selectHomework;

function homeworkDueLabel(homework) {
  return formatDateLabel(homework?.dueAt || homework?.deadline, 'дедлайн не указан');
}

function fileTitleFromAttempt(attempt) {
  return attempt?.file || attempt?.fileResource?.originalName || 'Решение';
}

function validateHomeworkTaskNumbers(raw) {
  const result = parseTaskNumberInput(raw);
  if (result.invalidTokens.length) return { error: `Некорректные номера заданий: ${result.invalidTokens.join(', ')}.`, taskNumbers: [] };
  if (result.outOfRange.length) return { error: `Номера заданий должны быть от 1 до 25: ${result.outOfRange.join(', ')}.`, taskNumbers: [] };
  if (result.duplicates.length) return { error: `Повторяются номера заданий: ${result.duplicates.join(', ')}.`, taskNumbers: [] };
  if (!result.taskNumbers.length) return { error: 'Укажите хотя бы один номер задания.', taskNumbers: [] };
  return { error: '', taskNumbers: result.taskNumbers };
}

function validateHomeworkDueDate(dateValue) {
  const dueAt = endOfLocalDayIso(dateValue);
  if (!dueAt) return { error: 'Укажите корректный дедлайн.', dueAt: '' };
  if (isPastIso(dueAt)) return { error: 'Дедлайн не может быть в прошлом.', dueAt: '' };
  return { error: '', dueAt };
}

export function HomeworkList({ data, openCreate, openHomework }) {
  const [filter, setFilter] = useState('all');
  const list = filter === 'all' ? data.homeworks : data.homeworks.filter((hw) => hw.status === filter);
  const filterLabel = HOMEWORK_FILTERS.find((item) => item.value === filter)?.label || 'Все';

  return (
    <>
      <Header title="Домашние задания" subtitle="Полная цепочка: выдача, отправка, проверка, доработка и закрытие" />
      <Button onClick={openCreate}>Выдать ДЗ</Button>
      <div className="tab-row">
        {HOMEWORK_FILTERS.map((item) => (
          <button key={item.value} className={cx('tab-btn', filter === item.value && 'active')} onClick={() => setFilter(item.value)}>{item.label}</button>
        ))}
      </div>
      <Section title={filter === 'all' ? 'Все домашки' : filterLabel} />
      {list.length ? list.map((hw) => {
        const student = getStudent(data, hw.studentId);
        const attempts = hw.attempts?.length || 0;
        const lockedText = isHomeworkClosed(hw) ? 'закрыто' : homeworkStatusHint(hw);
        return (
          <RowCard
            key={hw.id}
            icon={iconByStatus(hw.status)}
            iconTone={toneByStatus(hw.status)}
            title={hw.title}
            subtitle={`${student?.name || 'Ученик не найден'} · ${homeworkDueLabel(hw)} · ${formatMaterialCount(hw.materials.length)} · ${attempts} отправок · ${lockedText}`}
            badge={hw.status}
            badgeTone={toneByStatus(hw.status)}
            onClick={() => openHomework(hw.id)}
          />
        );
      }) : <EmptyState title="Домашек нет" text="По выбранному статусу ничего не найдено." />}
    </>
  );
}

export function CreateHomework({ data, actions, onBack }) {
  const [form, setForm] = useState({ studentId: '', title: '', taskNumbers: '', dueDate: '', description: '', materials: [] });
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  async function submit() {
    logger.ui('action=homework.create.click screen=TeacherHomework userRole=teacher');
    const tasks = validateHomeworkTaskNumbers(form.taskNumbers);
    const due = validateHomeworkDueDate(form.dueDate);

    if (!form.studentId) {
      setError('Выберите ученика.');
      return;
    }
    if (!form.title.trim()) {
      setError('Укажите название домашней работы.');
      return;
    }
    if (tasks.error) {
      setError(tasks.error);
      return;
    }
    if (due.error) {
      setError(due.error);
      return;
    }

    try {
      setIsSaving(true);
      setError('');
      const payload = {
        studentId: form.studentId,
        title: form.title.trim(),
        taskNumbers: tasks.taskNumbers,
        dueAt: due.dueAt,
        description: form.description.trim(),
        materials: form.materials,
      };
      logger.form('homework.create.submit', payload);
      const result = await actions.createHomework(payload);
      logger.nav('after homework.create back to list', { homeworkId: result?.homework?.id, requestId: result?.requestId });
      onBack();
    } catch (err) {
      setError(err?.message || 'Не удалось выдать ДЗ.');
    } finally {
      setIsSaving(false);
    }
  }

  const canCreate = Boolean(form.studentId && form.title.trim() && validateHomeworkTaskNumbers(form.taskNumbers).taskNumbers.length && form.dueDate);

  return (
    <>
      <Header title="Выдать ДЗ" subtitle="Домашка содержит задание, дедлайн и связанные материалы" onBack={onBack} />
      <Card className="form-stack">
        {error ? <div className="inline-error">{error}</div> : null}
        <SelectField label="Ученик" value={form.studentId} onChange={(studentId) => setForm({ ...form, studentId })} options={[{ value: '', label: 'Выберите ученика' }, ...data.students.map((s) => ({ value: s.id, label: s.name }))]} />
        <Field label="Название" value={form.title} onChange={(title) => setForm({ ...form, title })} placeholder="Вариант 7: задания 1–5" />
        <Field label="Номера заданий" value={form.taskNumbers} onChange={(taskNumbers) => setForm({ ...form, taskNumbers })} placeholder="1, 2, 3" />
        <Field label="Дедлайн" type="date" value={form.dueDate} onChange={(dueDate) => setForm({ ...form, dueDate })} />
        <TextArea label="Описание" value={form.description} onChange={(description) => setForm({ ...form, description })} />
      </Card>
      <Section title="Связанные материалы" />
      <AttachmentPicker materials={data.materials} value={form.materials} onChange={(materials) => setForm({ ...form, materials })} title="Прикрепить к домашке" suggestedTaskNumbers={parseTaskNumbers(form.taskNumbers)} />
      <div style={{ marginTop: 14 }}><Button onClick={submit} disabled={!canCreate || isSaving}>{isSaving ? 'Выдаём…' : 'Выдать ДЗ'}</Button></div>
    </>
  );
}

export function HomeworkDetail({ data, actions, homeworkId, onBack }) {
  const homework = getHomework(data, homeworkId);
  const student = homework ? getStudent(data, homework.studentId) : null;
  const [mode, setMode] = useState('view');
  const [comment, setComment] = useState(homework?.teacherComment || '');
  const [reviewMaterials, setReviewMaterials] = useState(homework?.reviewMaterials || []);
  const [form, setForm] = useState(() => ({
    studentId: homework?.studentId || '',
    title: homework?.title || '',
    taskNumbers: (homework?.taskNumbers || []).join(', '),
    dueDate: dateInputValue(homework?.dueAt),
    description: homework?.description || '',
    materials: homework?.materials || [],
  }));
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  if (!homework) {
    return <Card><strong>Домашняя работа не найдена.</strong><p className="subtitle">Возможно, запись уже изменена на backend.</p></Card>;
  }

  async function saveEdit() {
    logger.ui('action=homework.update.click screen=TeacherHomework userRole=teacher', { homeworkId: homework.id });
    const tasks = validateHomeworkTaskNumbers(form.taskNumbers);
    const due = validateHomeworkDueDate(form.dueDate);

    if (!isHomeworkEditable(homework)) {
      setError('Эту домашнюю работу уже нельзя редактировать.');
      return;
    }
    if (!form.studentId) {
      setError('Выберите ученика.');
      return;
    }
    if (!form.title.trim()) {
      setError('Укажите название домашней работы.');
      return;
    }
    if (tasks.error) {
      setError(tasks.error);
      return;
    }
    if (due.error) {
      setError(due.error);
      return;
    }

    try {
      setIsSaving(true);
      setError('');
      const payload = {
        studentId: form.studentId,
        title: form.title.trim(),
        taskNumbers: tasks.taskNumbers,
        dueAt: due.dueAt,
        description: form.description.trim(),
        materials: form.materials,
      };
      logger.form('homework.update.submit', { homeworkId: homework.id, ...payload });
      await actions.updateHomework(homework.id, payload);
      logger.nav('after homework.update view homeworkId=' + homework.id, { homeworkId: homework.id });
      setMode('view');
    } catch (err) {
      setError(err?.message || 'Не удалось сохранить ДЗ.');
    } finally {
      setIsSaving(false);
    }
  }

  async function applyReview(status) {
    logger.ui('action=homework.review.click screen=TeacherHomework userRole=teacher', { homeworkId: homework.id, status });
    try {
      setIsSaving(true);
      setError('');
      const payload = { status, comment, reviewMaterials };
      logger.form('homework.review.submit', { homeworkId: homework.id, ...payload });
      const result = await actions.reviewHomework(homework.id, payload);
      logger.nav('after homework.review back to list', { homeworkId: result?.homework?.id || homework.id, status, requestId: result?.requestId });
      onBack();
    } catch (err) {
      setError(err?.message || 'Не удалось сохранить проверку.');
    } finally {
      setIsSaving(false);
    }
  }

  const attempts = homework.attempts || [];
  const latestAttempt = attempts[attempts.length - 1];
  const canEdit = isHomeworkEditable(homework);
  const canReview = isHomeworkReviewable(homework);
  const closed = isHomeworkClosed(homework);
  const waitingStudent = isHomeworkWaitingStudent(homework);

  if (mode === 'edit') {
    return (
      <>
        <Header title="Редактировать ДЗ" subtitle={`${student?.name || 'Ученик'} · ${homework.topic}`} onBack={() => setMode('view')} right={<Badge tone={toneByStatus(homework.status)}>{statusLabel(homework.status)}</Badge>} />
        <Card className="form-stack">
          {error ? <div className="inline-error">{error}</div> : null}
          <SelectField label="Ученик" value={form.studentId} onChange={(studentId) => setForm({ ...form, studentId })} options={data.students.map((s) => ({ value: s.id, label: s.name }))} />
          <Field label="Название" value={form.title} onChange={(title) => setForm({ ...form, title })} />
          <Field label="Номера заданий" value={form.taskNumbers} onChange={(taskNumbers) => setForm({ ...form, taskNumbers })} />
          <Field label="Дедлайн" type="date" value={form.dueDate} onChange={(dueDate) => setForm({ ...form, dueDate })} />
          <TextArea label="Описание" value={form.description} onChange={(description) => setForm({ ...form, description })} />
        </Card>
        <Section title="Материалы в ДЗ" />
        <AttachmentPicker materials={data.materials} value={form.materials} onChange={(materials) => setForm({ ...form, materials })} title="Обновить материалы" suggestedTaskNumbers={parseTaskNumbers(form.taskNumbers)} />
        <div style={{ marginTop: 14 }}><Button onClick={saveEdit} disabled={isSaving}>{isSaving ? 'Сохраняем…' : 'Сохранить ДЗ'}</Button></div>
      </>
    );
  }

  if (mode === 'review') {
    return (
      <>
        <Header title="Проверка ДЗ" subtitle={`${student?.name || 'Ученик'} · ${homework.topic}`} onBack={() => setMode('view')} right={<Badge tone="amber">{statusLabel(homework.status)}</Badge>} />
        <Card className="form-stack">
          {error ? <div className="inline-error">{error}</div> : null}
          <div>
            <strong>{homework.title}</strong>
            <p className="subtitle">Последняя отправка: {formatDateTimeLabel(latestAttempt?.submittedAt || homework.submittedAt)}</p>
          </div>
          <div className="file-row"><div className="file-name">📄 {homework.solutionFile || 'Решение не загружено'}</div></div>
        </Card>
        <Section title="Комментарий" />
        <Card className="form-stack">
          <TextArea label="Комментарий ученику" value={comment} onChange={setComment} placeholder="Комментарий к выполненной работе" />
        </Card>
        <Section title="Материалы после проверки" />
        <AttachmentPicker materials={data.materials} value={reviewMaterials} onChange={setReviewMaterials} title="Прикрепить после проверки" suggestedTaskNumbers={homework.taskNumbers || []} />
        <div className="btn-row" style={{ marginTop: 14 }}>
          <Button onClick={() => applyReview(HOMEWORK_STATUS.REVIEWED)} disabled={isSaving}>Проверено</Button>
          <Button variant="danger" onClick={() => applyReview(HOMEWORK_STATUS.NEEDS_REVISION)} disabled={isSaving}>На доработку</Button>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Карточка ДЗ" subtitle={`${student?.name || 'Ученик'} · ${homework.topic}`} onBack={onBack} right={<Badge tone={toneByStatus(homework.status)}>{statusLabel(homework.status)}</Badge>} />
      <Card className="form-stack">
        <div>
          <strong>{homework.title}</strong>
          <p className="subtitle">{homeworkStatusHint(homework)}</p>
        </div>
        <div className="lesson-time-card">
          <div>
            <p className="metric-title">Дедлайн</p>
            <p className="lesson-time-main">{homeworkDueLabel(homework)}</p>
          </div>
          <div>
            <p className="metric-title">Отправок</p>
            <p className="lesson-time-main">{attempts.length}</p>
          </div>
        </div>
        <p className="subtitle">{homework.description || 'Описание не добавлено.'}</p>
        <div className="file-row">
          <div>
            <div className="file-name">📄 {homework.solutionFile || 'Решение не загружено'}</div>
            <div className="file-source">{homework.submittedAt ? `отправлено ${formatDateTimeLabel(homework.submittedAt)}` : 'ожидается от ученика'}</div>
          </div>
        </div>
      </Card>

      <Section title="Материалы в ДЗ" />
      <Card><MaterialList items={homework.materials || []} /></Card>

      {(homework.teacherComment || homework.reviewMaterials?.length) ? (
        <>
          <Section title="Комментарий и материалы преподавателя" />
          <Card className="form-stack">
            {homework.teacherComment ? <p className="subtitle">{homework.teacherComment}</p> : null}
            <MaterialList items={homework.reviewMaterials || []} />
          </Card>
        </>
      ) : null}

      <Section title="История отправок" />
      <Card>
        {attempts.length ? attempts.map((attempt, index) => (
          <div className="file-row" key={attempt.id || `${fileTitleFromAttempt(attempt)}-${index}`}>
            <div>
              <div className="file-name">📄 {fileTitleFromAttempt(attempt)}</div>
              <div className="file-source">{formatDateTimeLabel(attempt.submittedAt)} · {statusLabel(attempt.reviewStatus || HOMEWORK_STATUS.SUBMITTED)}</div>
            </div>
          </div>
        )) : <p className="subtitle">Отправок пока нет.</p>}
      </Card>

      {closed ? <Card className="card-green-soft"><strong>ДЗ закрыто</strong><p className="subtitle">Проверенную домашнюю работу нельзя редактировать или повторно проверять.</p></Card> : null}
      {waitingStudent && !canEdit ? <Card className="card-amber-soft"><strong>Ожидается действие ученика</strong><p className="subtitle">Ученик должен отправить решение или исправленную работу.</p></Card> : null}

      {(canEdit || canReview) ? (
        <>
          <Section title="Действия" />
          <div className="btn-row">
            {canEdit ? <Button variant="soft" onClick={() => setMode('edit')}>Редактировать</Button> : null}
            {canReview ? <Button onClick={() => setMode('review')}>Проверить</Button> : null}
          </div>
        </>
      ) : null}
    </>
  );
}
