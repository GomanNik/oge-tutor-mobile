/*
 * OGE Tutor App — teacher lesson list, detail, creation, editing, transfer.
 * Lesson forms validate schedule, timezone, duration, task numbers and same-student conflicts before API calls.
 */
import React, { useState } from 'react';
import { LESSON_SOURCE, LESSON_STATUS, TEACHER_ROUTE, statusLabel } from '../api/contracts.js';
import { AttachmentPicker } from '../shared/attachments.jsx';
import { selectLesson, selectStudent } from '../app/selectors.js';
import { ACTIVE_LESSON_STATUSES, HISTORY_LESSON_STATUSES } from '../shared/constants.js';
import {
  appTimezone,
  buildLessonSchedule,
  dateInputValue,
  formatDateLabel,
  formatTimeLabel,
  isPastIso,
  minutesBetween,
  normalizeDurationMinutes,
  timeInputValue,
} from '../shared/dateTime.js';
import { formatMaterialCount, parseTaskNumberInput } from '../shared/formatters.js';
import { Badge, Button, Card, EmptyState, Field, Header, MaterialList, RowCard, Section, SelectField, TextArea, cx, iconByStatus, toneByStatus } from '../shared/ui.jsx';
import { isSameDayIso, isWithinNextDaysIso } from '../domain/productSelectors.js';

const getStudent = selectStudent;
const getLesson = selectLesson;
const CONFLICT_STATUSES = [LESSON_STATUS.PLANNED, LESSON_STATUS.RESCHEDULED];

function lessonTitle(lesson) {
  return `${formatDateLabel(lesson.startAt, 'дата не указана', lesson.timezone)}, ${formatTimeLabel(lesson.startAt, 'время не указано', lesson.timezone)}`;
}

function parseTaskNumbersStrict(value) {
  return parseTaskNumberInput(value);
}

function stringifyTaskNumbers(value) {
  return (value || []).join(', ');
}

function formFromLesson(lesson) {
  const timezone = lesson?.timezone || appTimezone();
  return {
    studentId: lesson?.studentId || '',
    date: dateInputValue(lesson?.startAt, timezone),
    time: timeInputValue(lesson?.startAt, timezone),
    durationMinutes: String(lesson?.durationMinutes || minutesBetween(lesson?.startAt, lesson?.endAt, 60)),
    timezone,
    topic: lesson?.topic || '',
    focusTaskNumbers: stringifyTaskNumbers(lesson?.focusTaskNumbers),
    note: lesson?.note || '',
    completionComment: lesson?.completionComment || '',
    materials: lesson?.materials || [],
  };
}

function hasLessonConflict(data, candidate, excludeLessonId = '') {
  const start = Date.parse(candidate.startAt);
  const end = Date.parse(candidate.endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;

  return (data.lessons || []).some((lesson) => {
    if (lesson.id === excludeLessonId) return false;
    if (lesson.studentId !== candidate.studentId) return false;
    if (!CONFLICT_STATUSES.includes(lesson.status)) return false;

    const existingStart = Date.parse(lesson.startAt);
    const existingEnd = Date.parse(lesson.endAt);
    if (!Number.isFinite(existingStart) || !Number.isFinite(existingEnd)) return false;

    return start < existingEnd && end > existingStart;
  });
}

function validateTaskNumbers(raw, { required = false } = {}) {
  const result = parseTaskNumbersStrict(raw);
  if (result.invalidTokens.length) return { error: `Некорректные номера заданий: ${result.invalidTokens.join(', ')}.`, taskNumbers: [] };
  if (result.outOfRange.length) return { error: `Номера заданий должны быть от 1 до 25: ${result.outOfRange.join(', ')}.`, taskNumbers: [] };
  if (result.duplicates.length) return { error: `Повторяются номера заданий: ${result.duplicates.join(', ')}.`, taskNumbers: [] };
  if (required && !result.taskNumbers.length) return { error: 'Укажите хотя бы один номер ОГЭ, которому был посвящён урок.', taskNumbers: [] };
  return { error: '', taskNumbers: result.taskNumbers };
}

function validateLessonForm(form, data, { excludeLessonId = '', allowPast = false, requireFocusTasks = false } = {}) {
  if (!form.studentId) return { error: 'Выберите ученика.' };
  if (!form.date || !form.time) return { error: 'Укажите дату и время урока.' };

  const durationMinutes = normalizeDurationMinutes(form.durationMinutes);
  if (!durationMinutes) return { error: 'Длительность урока должна быть от 1 до 480 минут.' };

  const schedule = buildLessonSchedule({ date: form.date, time: form.time, durationMinutes, timezone: form.timezone || appTimezone() });
  if (!schedule.startAt || !schedule.endAt || Date.parse(schedule.endAt) <= Date.parse(schedule.startAt)) {
    return { error: 'Проверьте дату, время и длительность урока.' };
  }

  if (!allowPast && isPastIso(schedule.startAt)) return { error: 'Нельзя запланировать урок в прошлом.' };
  if (hasLessonConflict(data, { ...schedule, studentId: form.studentId }, excludeLessonId)) return { error: 'У этого ученика уже есть урок на пересекающееся время.' };

  const tasks = validateTaskNumbers(form.focusTaskNumbers, { required: requireFocusTasks });
  if (tasks.error) return { error: tasks.error };

  return { error: '', schedule, taskNumbers: tasks.taskNumbers };
}

export function ScheduleScreen({ data, openCreate, openLesson }) {
  const [view, setView] = useState('week');
  const [studentFilter, setStudentFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');
  const baseList = [...data.lessons].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const now = new Date();
  const filtered = baseList.filter((lesson) => {
    if (studentFilter !== 'all' && lesson.studentId !== studentFilter) return false;
    if (statusFilter === 'active' && !ACTIVE_LESSON_STATUSES.includes(lesson.status)) return false;
    if (statusFilter === 'history' && !HISTORY_LESSON_STATUSES.includes(lesson.status)) return false;
    if (statusFilter !== 'all' && statusFilter !== 'active' && statusFilter !== 'history' && lesson.status !== statusFilter) return false;
    if (view === 'day') return isSameDayIso(lesson.startAt, now);
    if (view === 'week') return isWithinNextDaysIso(lesson.startAt, 7, now);
    return true;
  });

  return (
    <>
      <Header title="Расписание" subtitle="День, неделя, список занятий и действия по урокам" />
      <Button onClick={() => openCreate()}>Создать урок</Button>

      <div className="tab-row">
        {[
          ['day', 'День'],
          ['week', 'Неделя'],
          ['list', 'Список'],
        ].map(([id, label]) => (
          <button type="button" key={id} className={cx('tab-btn', view === id && 'active')} onClick={() => setView(id)}>{label}</button>
        ))}
      </div>

      <Card className="schedule-filter-card">
        <SelectField
          label="Ученик"
          value={studentFilter}
          onChange={setStudentFilter}
          options={[{ value: 'all', label: 'Все ученики' }, ...data.students.map((student) => ({ value: student.id, label: student.name }))]}
        />
        <SelectField
          label="Статус"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'active', label: 'Ближайшие' },
            { value: 'all', label: 'Все' },
            { value: LESSON_STATUS.PLANNED, label: statusLabel(LESSON_STATUS.PLANNED) },
            { value: LESSON_STATUS.RESCHEDULED, label: statusLabel(LESSON_STATUS.RESCHEDULED) },
            { value: 'history', label: 'История' },
            { value: LESSON_STATUS.COMPLETED, label: statusLabel(LESSON_STATUS.COMPLETED) },
            { value: LESSON_STATUS.CANCELED, label: statusLabel(LESSON_STATUS.CANCELED) },
          ]}
        />
      </Card>

      <Section title={view === 'day' ? 'Занятия сегодня' : view === 'week' ? 'Ближайшая неделя' : 'Все занятия'} />
      {filtered.length ? filtered.map((lesson) => {
        const student = getStudent(data, lesson.studentId);
        return (
          <RowCard
            key={lesson.id}
            icon={ACTIVE_LESSON_STATUSES.includes(lesson.status) ? '□' : iconByStatus(lesson.status)}
            iconTone={toneByStatus(lesson.status)}
            title={lessonTitle(lesson)}
            subtitle={`${student?.name || 'Ученик не найден'} · ${lesson.topic || 'Тема не указана'} · ${formatMaterialCount(lesson.materials?.length || 0)}`}
            badge={lesson.status}
            badgeTone={toneByStatus(lesson.status)}
            onClick={() => openLesson(lesson.id)}
          />
        );
      }) : (
        <EmptyState
          title="Занятий не найдено"
          text="Измените фильтр или создайте урок. Из карточки ученика форма откроется уже с выбранным учеником."
          action="Создать урок"
          onAction={() => openCreate()}
        />
      )}
    </>
  );
}

export function LessonDetail({ data, actions, lessonId, openMode, onBack }) {
  const lesson = getLesson(data, lessonId);
  const student = lesson ? getStudent(data, lesson.studentId) : null;
  const [mode, setMode] = useState('view');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState(() => formFromLesson(lesson));

  if (!lesson) {
    return <Card><strong>Урок не найден.</strong><p className="subtitle">Возможно, запись уже изменена на backend.</p></Card>;
  }

  const isEditable = ACTIVE_LESSON_STATUSES.includes(lesson.status);

  async function saveEdit() {
    const validated = validateLessonForm(form, data, { excludeLessonId: lesson.id });
    if (validated.error) {
      setError(validated.error);
      return;
    }
    if (!form.topic.trim()) {
      setError('Укажите тему урока.');
      return;
    }

    try {
      setIsSaving(true);
      setError('');
      await actions.updateLesson(lesson.id, {
        studentId: form.studentId,
        ...validated.schedule,
        topic: form.topic.trim(),
        focusTaskNumbers: validated.taskNumbers,
        note: form.note.trim(),
        materials: form.materials,
      });
      setMode('view');
    } catch (err) {
      setError(err?.message || 'Не удалось сохранить урок.');
    } finally {
      setIsSaving(false);
    }
  }

  async function transferLesson() {
    const validated = validateLessonForm(form, data, { excludeLessonId: lesson.id });
    if (validated.error) {
      setError(validated.error);
      return;
    }

    try {
      setIsSaving(true);
      setError('');
      await actions.updateLesson(lesson.id, {
        ...validated.schedule,
        note: form.note.trim(),
        status: LESSON_STATUS.RESCHEDULED,
      });
      setMode('view');
    } catch (err) {
      setError(err?.message || 'Не удалось перенести урок.');
    } finally {
      setIsSaving(false);
    }
  }

  async function cancelLesson() {
    try {
      setIsSaving(true);
      setError('');
      await actions.updateLesson(lesson.id, { status: LESSON_STATUS.CANCELED });
    } catch (err) {
      setError(err?.message || 'Не удалось отменить урок.');
    } finally {
      setIsSaving(false);
    }
  }

  async function completeLesson() {
    const tasks = validateTaskNumbers(form.focusTaskNumbers, { required: true });
    if (tasks.error) {
      setError(tasks.error);
      return;
    }

    try {
      setIsSaving(true);
      setError('');
      await actions.completeLesson(lesson.id, {
        focusTaskNumbers: tasks.taskNumbers,
        completionComment: form.completionComment.trim(),
      });
      setMode('view');
    } catch (err) {
      setError(err?.message || 'Не удалось завершить урок.');
    } finally {
      setIsSaving(false);
    }
  }

  const canSaveLesson = Boolean(form.studentId && form.date && form.time && form.topic.trim() && normalizeDurationMinutes(form.durationMinutes));
  const canTransferLesson = Boolean(form.studentId && form.date && form.time && normalizeDurationMinutes(form.durationMinutes));
  const canCompleteByTime = isPastIso(lesson.startAt);

  if (mode === 'edit') {
    return (
      <>
        <Header title="Редактировать урок" subtitle={`${student?.name || 'Ученик'} · ${lesson.topic}`} onBack={() => setMode('view')} />
        <Card className="form-stack">
          {error ? <div className="inline-error">{error}</div> : null}
          <SelectField label="Ученик" value={form.studentId} onChange={(studentId) => setForm({ ...form, studentId })} options={[{ value: '', label: 'Выберите ученика' }, ...data.students.map((s) => ({ value: s.id, label: s.name }))]} />
          <Field label="Дата" type="date" value={form.date} onChange={(date) => setForm({ ...form, date })} />
          <Field label="Время" type="time" value={form.time} onChange={(time) => setForm({ ...form, time })} />
          <Field label="Длительность, мин" type="number" value={form.durationMinutes} onChange={(durationMinutes) => setForm({ ...form, durationMinutes })} placeholder="60" />
          <Field label="Тема" value={form.topic} onChange={(topic) => setForm({ ...form, topic })} placeholder="Уравнения и неравенства" />
          <Field label="Номера заданий ОГЭ на уроке" value={form.focusTaskNumbers} onChange={(focusTaskNumbers) => setForm({ ...form, focusTaskNumbers })} placeholder="6, 7" />
          <TextArea label="Заметка преподавателя" value={form.note} onChange={(note) => setForm({ ...form, note })} />
        </Card>
        <Section title="Материалы к уроку" />
        <AttachmentPicker materials={data.materials} value={form.materials} onChange={(materials) => setForm({ ...form, materials })} title="Прикрепить к уроку" />
        <div style={{ marginTop: 14 }}><Button onClick={saveEdit} disabled={!canSaveLesson || isSaving}>{isSaving ? 'Сохраняем…' : 'Сохранить изменения'}</Button></div>
      </>
    );
  }

  if (mode === 'complete') {
    return (
      <>
        <Header title="Завершить урок" subtitle={`${student?.name || 'Ученик'} · ${lesson.topic}`} onBack={() => setMode('view')} />
        <Card className="form-stack">
          {error ? <div className="inline-error">{error}</div> : null}
          <div className="card card-amber-soft">
            После завершения урока задания из поля «Номера ОГЭ» перейдут в статус «требует оценки», а преподаватель увидит уведомление в карточке ученика.
          </div>
          <Field label="Номера заданий ОГЭ на уроке" value={form.focusTaskNumbers} onChange={(focusTaskNumbers) => setForm({ ...form, focusTaskNumbers })} placeholder="6, 7" />
          <TextArea label="Комментарий по завершению" value={form.completionComment} onChange={(completionComment) => setForm({ ...form, completionComment })} placeholder="Что важно учесть при оценке освоения" />
          {!canCompleteByTime ? (
            <div className="inline-note warning">Урок ещё в будущем. Завершение станет доступно после начала занятия или после переноса времени.</div>
          ) : null}
          <Button onClick={completeLesson} disabled={isSaving || !canCompleteByTime}>{isSaving ? 'Завершаем…' : 'Завершить урок и запросить оценку освоения'}</Button>
        </Card>
      </>
    );
  }

  if (mode === 'transfer') {
    return (
      <>
        <Header title="Перенести урок" subtitle={`${student?.name || 'Ученик'} · ${lesson.topic}`} onBack={() => setMode('view')} />
        <Card className="form-stack">
          {error ? <div className="inline-error">{error}</div> : null}
          <Field label="Новая дата" type="date" value={form.date} onChange={(date) => setForm({ ...form, date })} />
          <Field label="Новое время" type="time" value={form.time} onChange={(time) => setForm({ ...form, time })} />
          <Field label="Длительность, мин" type="number" value={form.durationMinutes} onChange={(durationMinutes) => setForm({ ...form, durationMinutes })} placeholder="60" />
          <TextArea label="Причина / заметка" value={form.note} onChange={(note) => setForm({ ...form, note })} placeholder="Например: перенесли по просьбе ученика" />
          <Button onClick={transferLesson} disabled={!canTransferLesson || isSaving}>{isSaving ? 'Переносим…' : 'Перенести урок'}</Button>
        </Card>
      </>
    );
  }

  return (
    <>
      <Header title="Карточка урока" subtitle={`${student?.name || 'Ученик'} · ${lesson.topic}`} onBack={onBack} right={<Badge tone={toneByStatus(lesson.status)}>{statusLabel(lesson.status)}</Badge>} />
      <Card className="form-stack">
        <div className="lesson-time-card">
          <div>
            <p className="metric-title">Дата</p>
            <p className="lesson-time-main">{formatDateLabel(lesson.startAt, 'дата не указана', lesson.timezone)}</p>
          </div>
          <div>
            <p className="metric-title">Время</p>
            <p className="lesson-time-main">{formatTimeLabel(lesson.startAt, 'время не указано', lesson.timezone)}</p>
          </div>
        </div>
        <p className="subtitle">Длительность: {lesson.durationMinutes || minutesBetween(lesson.startAt, lesson.endAt, 60)} мин · Часовой пояс: {lesson.timezone || appTimezone()} · Источник: {lesson.source || LESSON_SOURCE.MANUAL}</p>
        <p className="subtitle">Номера ОГЭ на уроке: {lesson.focusTaskNumbers?.length ? lesson.focusTaskNumbers.join(', ') : 'не указаны'}</p>
        {lesson.completedAt ? <p className="subtitle">Завершён: {formatDateLabel(lesson.completedAt, 'дата не указана', lesson.timezone)}, {formatTimeLabel(lesson.completedAt, 'время не указано', lesson.timezone)}</p> : null}
        {lesson.completionComment ? <p className="subtitle">Итог урока: {lesson.completionComment}</p> : null}
        {lesson.note ? <p className="subtitle">{lesson.note}</p> : <p className="subtitle">Заметка преподавателя пока не добавлена.</p>}
      </Card>
      <Section title="Материалы к уроку" />
      <Card><MaterialList items={lesson.materials || []} /></Card>
      {lesson.status === LESSON_STATUS.COMPLETED ? <Card className="card-green-soft"><strong>Урок проведён</strong><p className="subtitle">Он остаётся в истории и больше не выглядит как ближайшее занятие.</p></Card> : null}
      {lesson.status === LESSON_STATUS.CANCELED ? <Card className="card-red-soft"><strong>Урок отменён</strong><p className="subtitle">Отменённое занятие нельзя завершить. При необходимости создайте новый урок.</p></Card> : null}

      {error && mode === 'view' ? <div className="inline-error">{error}</div> : null}
      {isEditable ? (
        <>
          <Section title="Действия" />
          {!canCompleteByTime ? <div className="inline-note warning">Будущий урок нельзя отметить проведённым без изменения времени. Перенесите урок или дождитесь начала занятия.</div> : null}
          <div className="btn-grid-2">
            <Button variant="soft" onClick={() => setMode('edit')} disabled={isSaving}>Редактировать</Button>
            <Button variant="soft" onClick={() => setMode('transfer')} disabled={isSaving}>Перенести</Button>
            <Button onClick={() => setMode('complete')} disabled={isSaving || !canCompleteByTime}>Проведён</Button>
            <Button variant="danger" onClick={cancelLesson} disabled={isSaving}>Отменить</Button>
          </div>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <Button variant="soft" onClick={() => setMode('edit')} disabled={isSaving}>Добавить материалы</Button>
            <Button
              variant="soft"
              onClick={() => openMode?.('create-homework', TEACHER_ROUTE.HOMEWORK, {
                studentId: lesson.studentId,
                lessonId: lesson.id,
                taskNumbers: lesson.focusTaskNumbers || [],
                title: lesson.topic ? `По уроку: ${lesson.topic}` : '',
              })}
              disabled={isSaving}
            >
              Выдать ДЗ по уроку
            </Button>
          </div>
        </>
      ) : null}
    </>
  );
}

export function CreateLesson({ data, actions, context = {}, onBack }) {
  const [form, setForm] = useState({
    studentId: context.studentId || '',
    date: context.date || '',
    time: context.time || '',
    durationMinutes: String(context.durationMinutes || '60'),
    timezone: context.timezone || appTimezone(),
    topic: context.title || context.topic || '',
    focusTaskNumbers: stringifyTaskNumbers(context.taskNumbers || context.focusTaskNumbers),
    note: context.note || '',
    materials: context.materials || [],
  });
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  async function submit() {
    const validated = validateLessonForm(form, data);
    if (validated.error) {
      setError(validated.error);
      return;
    }
    if (!form.topic.trim()) {
      setError('Укажите тему урока.');
      return;
    }

    try {
      setIsSaving(true);
      setError('');
      await actions.createLesson({
        studentId: form.studentId,
        ...validated.schedule,
        source: LESSON_SOURCE.MANUAL,
        topic: form.topic.trim(),
        focusTaskNumbers: validated.taskNumbers,
        note: form.note.trim(),
        materials: form.materials,
      });
      onBack();
    } catch (err) {
      setError(err?.message || 'Не удалось создать урок.');
    } finally {
      setIsSaving(false);
    }
  }

  const canCreateLesson = Boolean(form.studentId && form.date && form.time && form.topic.trim() && normalizeDurationMinutes(form.durationMinutes));

  return (
    <>
      <Header title="Создать урок" subtitle="Планирование занятия, темы и материалов к уроку" onBack={onBack} />
      <Card className="form-stack">
        {error ? <div className="inline-error">{error}</div> : null}
        {context.studentId ? <div className="inline-note success">Ученик выбран из карточки: {getStudent(data, context.studentId)?.name || 'ученик'}.</div> : null}
        <SelectField label="Ученик" value={form.studentId} onChange={(studentId) => setForm({ ...form, studentId })} options={[{ value: '', label: 'Выберите ученика' }, ...data.students.map((s) => ({ value: s.id, label: s.name }))]} />
        <Field label="Дата" type="date" value={form.date} onChange={(date) => setForm({ ...form, date })} />
        <Field label="Время" type="time" value={form.time} onChange={(time) => setForm({ ...form, time })} />
        <Field label="Длительность, мин" type="number" value={form.durationMinutes} onChange={(durationMinutes) => setForm({ ...form, durationMinutes })} placeholder="60" />
        <Field label="Тема" value={form.topic} onChange={(topic) => setForm({ ...form, topic })} placeholder="Уравнения и неравенства" />
        <Field label="Номера заданий ОГЭ на уроке" value={form.focusTaskNumbers} onChange={(focusTaskNumbers) => setForm({ ...form, focusTaskNumbers })} placeholder="6, 7" />
        <TextArea label="Заметка преподавателя" value={form.note} onChange={(note) => setForm({ ...form, note })} />
      </Card>
      <Section title="Материалы к уроку" />
      <AttachmentPicker materials={data.materials} value={form.materials} onChange={(materials) => setForm({ ...form, materials })} title="Прикрепить к уроку" />
      <div style={{ marginTop: 14 }}><Button onClick={submit} disabled={!canCreateLesson || isSaving}>{isSaving ? 'Создаём…' : 'Создать урок'}</Button></div>
    </>
  );
}

export const LessonsList = ScheduleScreen;
