/*
 * OGE Tutor App — teacher student list, creation, and working student card.
 * The student card is the operational center for schedule, homework, materials, progress and access.
 */
import React, { useState } from 'react';
import { ACCESS_STATUS, TEACHER_ROUTE } from '../api/contracts.js';
import { statusLabel } from '../api/contracts.js';
import { getStudentProgressView } from '../domain/progress/index.js';
import { selectStudent } from '../app/selectors.js';
import { getStudentHistory } from '../domain/productSelectors.js';
import { formatDateLabel, formatTimeLabel } from '../shared/dateTime.js';
import { formatMaterialCount } from '../shared/formatters.js';
import { Avatar, Badge, Button, Card, EmptyState, Field, Header, RowCard, Section, SelectField, TextArea, cx, iconByStatus, solidBg, toneByStatus } from '../shared/ui.jsx';
import { StudentProgressTab } from './student-progress/StudentProgressTab.jsx';

const getStudent = selectStudent;

const STUDENT_CARD_TAB = Object.freeze({
  OVERVIEW: 'overview',
  SCHEDULE: 'schedule',
  HOMEWORK: 'homework',
  MATERIALS: 'materials',
  PROGRESS: 'progress',
  HISTORY: 'history',
});

const STUDENT_CARD_TABS = [
  { value: STUDENT_CARD_TAB.OVERVIEW, label: 'Обзор' },
  { value: STUDENT_CARD_TAB.SCHEDULE, label: 'Расписание' },
  { value: STUDENT_CARD_TAB.HOMEWORK, label: 'ДЗ' },
  { value: STUDENT_CARD_TAB.MATERIALS, label: 'Материалы' },
  { value: STUDENT_CARD_TAB.PROGRESS, label: 'Прогресс' },
  { value: STUDENT_CARD_TAB.HISTORY, label: 'История' },
];

function AccessPreview({ preview, label = 'Dev-ссылка доступа' }) {
  if (!preview?.link) return null;
  return (
    <div className="inline-note success">
      <div>{label}</div>
      <a href={preview.link} target="_blank" rel="noreferrer">{preview.link}</a>
      {preview.token ? <div className="file-source">{preview.token}</div> : null}
    </div>
  );
}

export function StudentsList({ data, openStudent, openCreate }) {
  return (
    <>
      <Header title="Ученики" subtitle="Список учеников, доступ, прогресс и текущие задачи" />
      <Button onClick={openCreate}>Добавить ученика</Button>
      <Section title="Ученики" />
      {data.students.length ? data.students.map((student) => {
        const progress = getStudentProgressView(student);

        return (
          <button key={student.id} className="row-card" onClick={() => openStudent(student.id)}>
            <Avatar avatarId={student.avatar} bg={student.bg} size="sm" />
            <div className="row-main">
              <div className="row-title-line">
                <div className="row-title">{student.name}</div>
                <Badge tone={toneByStatus(student.access)}>{statusLabel(student.access)}</Badge>
              </div>
              <div className="row-subtitle">{student.email} · покрытие {progress.coveragePercent}% · освоение {progress.masteryPercent}%</div>
            </div>
            <div className="row-arrow">›</div>
          </button>
        );
      }) : <EmptyState title="Ученики не добавлены" text="Создайте ученика и отправьте ссылку доступа. После этого появятся расписание, ДЗ и прогресс." action="Добавить ученика" onAction={openCreate} />}
    </>
  );
}

export function CreateStudent({ actions, onBack }) {
  const [form, setForm] = useState({ name: '', email: '', grade: '', goal: '', note: '' });
  const [error, setError] = useState('');
  const [invitePreview, setInvitePreview] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  async function submit() {
    try {
      setIsSaving(true);
      setError('');
      const result = await actions.createStudent(form);
      setInvitePreview(result?.invite || null);
    } catch (err) {
      setError(err?.message || 'Не удалось создать ученика.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <Header title="Добавить ученика" subtitle="После создания аккаунта backend подготовит ссылку установки пароля." onBack={onBack} />
      <Card className="form-stack">
        {error ? <div className="inline-error">{error}</div> : null}
        <Field label="Имя ученика" value={form.name} onChange={(name) => setForm({ ...form, name })} placeholder="Иван Петров" />
        <Field label="Email" value={form.email} onChange={(email) => setForm({ ...form, email })} placeholder="student@mail.ru" />
        <Field label="Класс" value={form.grade} onChange={(grade) => setForm({ ...form, grade })} placeholder="Например: 9 класс" />
        <Field label="Цель" value={form.goal} onChange={(goal) => setForm({ ...form, goal })} placeholder="Например: ОГЭ на 4" />
        <TextArea label="Заметка преподавателя" value={form.note} onChange={(note) => setForm({ ...form, note })} placeholder="Что важно помнить по ученику" />
        <div className="card card-amber-soft">Публичной регистрации нет: преподаватель создаёт аккаунт, а backend готовит ссылку для установки пароля.</div>
        <AccessPreview preview={invitePreview} label="Dev-ссылка приглашения" />
        {invitePreview ? <Button variant="light" onClick={onBack}>К списку учеников</Button> : null}
        <Button onClick={submit} disabled={!form.name.trim() || !form.email.trim() || isSaving || Boolean(invitePreview)}>{isSaving ? 'Создаём…' : 'Создать доступ'}</Button>
      </Card>
    </>
  );
}

function suggestedTaskNumber(student, lessons, homeworks) {
  const progress = getStudentProgressView(student);
  return progress.weak[0] || homeworks.flatMap((item) => item.taskNumbers || [])[0] || lessons.flatMap((item) => item.focusTaskNumbers || [])[0] || '';
}

function StudentActions({ student, lessons, homeworks, openMode, runAccessAction, isAccessBusy }) {
  const taskNumber = suggestedTaskNumber(student, lessons, homeworks);
  return (
    <div className="student-action-grid">
      <Button variant="soft" onClick={() => openMode('create-lesson', TEACHER_ROUTE.SCHEDULE, { studentId: student.id })}>Создать урок</Button>
      <Button variant="soft" onClick={() => openMode('create-homework', TEACHER_ROUTE.HOMEWORK, { studentId: student.id })}>Выдать ДЗ</Button>
      <Button variant="soft" onClick={() => openMode('upload-material', TEACHER_ROUTE.MATERIALS, { studentId: student.id, taskNumber })}>Загрузить материал</Button>
      <Button variant="soft" onClick={() => runAccessAction('invite')} disabled={isAccessBusy}>Отправить invite</Button>
      <Button variant="soft" onClick={() => runAccessAction('reset')} disabled={isAccessBusy}>Сбросить доступ</Button>
      {student.access === ACCESS_STATUS.DISABLED ? (
        <Button onClick={() => runAccessAction('enable')} disabled={isAccessBusy}>Включить доступ</Button>
      ) : (
        <Button variant="danger" onClick={() => runAccessAction('disable')} disabled={isAccessBusy}>Отключить доступ</Button>
      )}
    </div>
  );
}

function StudentEditForm({ student, actions, onBack }) {
  const [form, setForm] = useState({
    name: student.name || '',
    email: student.email || '',
    grade: student.grade || '',
    goal: student.goal || '',
    avatar: student.avatar || 'bear',
    bg: student.bg || 'blue',
    note: student.note || '',
  });
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  async function save() {
    if (!form.name.trim()) {
      setError('Имя ученика обязательно.');
      return;
    }

    try {
      setIsSaving(true);
      setError('');
      await actions.updateStudentProfile(student.id, {
        name: form.name.trim(),
        grade: form.grade.trim(),
        goal: form.goal.trim(),
        avatar: form.avatar,
        bg: form.bg,
        note: form.note.trim(),
      });
      if (form.email.trim() && form.email.trim() !== student.email) {
        await actions.updateStudentAccount(student.id, { email: form.email.trim() });
      }
      onBack();
    } catch (err) {
      setError(err?.message || 'Не удалось сохранить ученика.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <Header title="Редактировать ученика" subtitle={student.name} onBack={onBack} />
      <Card className="form-stack">
        {error ? <div className="inline-error">{error}</div> : null}
        <Field label="Имя" value={form.name} onChange={(name) => setForm({ ...form, name })} />
        <Field label="Email" value={form.email} onChange={(email) => setForm({ ...form, email })} />
        <Field label="Класс" value={form.grade} onChange={(grade) => setForm({ ...form, grade })} />
        <Field label="Цель" value={form.goal} onChange={(goal) => setForm({ ...form, goal })} />
        <SelectField label="Иконка" value={form.avatar} onChange={(avatar) => setForm({ ...form, avatar })} options={[
          { value: 'bear', label: 'Спокойная' },
          { value: 'cat', label: 'Аккуратная' },
          { value: 'fox', label: 'Быстрая' },
          { value: 'owl', label: 'Учебная' },
        ]} />
        <SelectField label="Цвет" value={form.bg} onChange={(bg) => setForm({ ...form, bg })} options={[
          { value: 'blue', label: 'Синий' },
          { value: 'emerald', label: 'Зелёный' },
          { value: 'rose', label: 'Розовый' },
          { value: 'amber', label: 'Тёплый' },
          { value: 'slate', label: 'Графит' },
        ]} />
        <TextArea label="Заметка преподавателя" value={form.note} onChange={(note) => setForm({ ...form, note })} />
        <Button onClick={save} disabled={isSaving}>{isSaving ? 'Сохраняем…' : 'Сохранить ученика'}</Button>
      </Card>
    </>
  );
}

function NoteEditForm({ student, actions, onBack }) {
  const [note, setNote] = useState(student.note || '');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  async function save() {
    try {
      setError('');
      setIsSaving(true);
      await actions.updateStudentProfile(student.id, {
        name: student.name,
        grade: student.grade,
        goal: student.goal,
        avatar: student.avatar,
        bg: student.bg,
        note,
      });
      onBack();
    } catch (err) {
      setError(err?.message || 'Не удалось сохранить заметку.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <Header title="Заметка преподавателя" subtitle={student.name} onBack={onBack} />
      <Card className="form-stack">
        {error ? <div className="inline-error">{error}</div> : null}
        <TextArea label="Заметка" value={note} onChange={setNote} placeholder="Что важно помнить по ученику" />
        <Button onClick={save} disabled={isSaving}>{isSaving ? 'Сохраняем…' : 'Сохранить заметку'}</Button>
      </Card>
    </>
  );
}

export function StudentCard({ data, actions, studentId, openMode, openHomework, openLesson, onBack }) {
  const [tab, setTab] = useState(STUDENT_CARD_TAB.OVERVIEW);
  const [mode, setMode] = useState('view');
  const [accessMessage, setAccessMessage] = useState('');
  const [accessError, setAccessError] = useState('');
  const [accessPreview, setAccessPreview] = useState(null);
  const [isAccessBusy, setIsAccessBusy] = useState(false);
  const student = getStudent(data, studentId);

  if (!student) {
    return <Card><strong>Ученик не найден.</strong><p className="subtitle">Возможно, запись была удалена или доступ изменён.</p></Card>;
  }

  const lessons = data.lessons.filter((item) => item.studentId === studentId);
  const homeworks = data.homeworks.filter((item) => item.studentId === studentId);
  const relevantTaskNumbers = new Set([
    ...(student.progressByTask || []).filter((item) => item.coverageStatus && item.coverageStatus !== 'not_started').map((item) => Number(item.taskNumber)),
    ...lessons.flatMap((item) => item.focusTaskNumbers || []).map(Number),
    ...homeworks.flatMap((item) => item.taskNumbers || []).map(Number),
  ].filter((taskNumber) => Number.isInteger(taskNumber)));
  const studentMaterials = data.materials.filter((topic) => relevantTaskNumbers.has(Number(topic.taskNumber)));
  const history = getStudentHistory(data, studentId);
  const progress = getStudentProgressView(student);
  const nearestLesson = lessons.filter((item) => ['planned', 'rescheduled'].includes(item.status)).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))[0];
  const activeHomework = homeworks.find((item) => ['submitted', 'overdue', 'assigned', 'needs_revision'].includes(item.status));

  async function runAccessAction(kind) {
    const actionMap = {
      invite: [actions.resendStudentInvite, 'Ссылка приглашения обновлена.'],
      reset: [actions.resetStudentPassword, 'Ссылка установки пароля обновлена.'],
      disable: [actions.disableStudentAccess, 'Доступ ученика отключён.'],
      enable: [actions.enableStudentAccess, 'Доступ ученика включён.'],
    };
    const [action, successText] = actionMap[kind] || [];
    if (!action) return;

    try {
      setIsAccessBusy(true);
      setAccessError('');
      setAccessMessage('');
      setAccessPreview(null);
      const result = await action(student.id);
      setAccessPreview(result?.invite || result?.reset || null);
      setAccessMessage(successText);
    } catch (err) {
      setAccessError(err?.message || 'Не удалось выполнить действие.');
    } finally {
      setIsAccessBusy(false);
    }
  }

  if (mode === 'edit') return <StudentEditForm student={student} actions={actions} onBack={() => setMode('view')} />;
  if (mode === 'note') return <NoteEditForm student={student} actions={actions} onBack={() => setMode('view')} />;

  return (
    <>
      <Header title={student.name} subtitle={[student.grade, student.goal].filter(Boolean).join(' · ') || 'Профиль ученика'} onBack={onBack} right={<Badge tone={toneByStatus(student.access)}>{statusLabel(student.access)}</Badge>} />
      <div className={`profile-hero student-hero ${solidBg(student.bg)}`}>
        <div className="profile-content">
          <Avatar avatarId={student.avatar} bg={student.bg} size="lg" />
          <p className="profile-name">{student.name}</p>
          <p className="profile-email">{student.email}</p>
        </div>
      </div>

      <div className="student-profile-actions">
        <Button variant="soft" onClick={() => setMode('edit')}>Редактировать данные</Button>
        <Button variant="soft" onClick={() => setMode('note')}>Редактировать заметку</Button>
      </div>

      <div className="tab-row">
        {STUDENT_CARD_TABS.map((item) => (
          <button className={cx('tab-btn', tab === item.value && 'active')} key={item.value} onClick={() => setTab(item.value)}>{item.label}</button>
        ))}
      </div>

      {tab === STUDENT_CARD_TAB.OVERVIEW ? (
        <>
          <Section title="Управление учеником" />
          <StudentActions student={student} lessons={lessons} homeworks={homeworks} openMode={openMode} runAccessAction={runAccessAction} isAccessBusy={isAccessBusy} />
          {accessMessage ? <div className="inline-note success">{accessMessage}</div> : null}
          <AccessPreview preview={accessPreview} />
          {accessError ? <div className="inline-error">{accessError}</div> : null}

          <Section title="Сводка" />
          <div className="metric-grid">
            <Card><p className="metric-title">Покрытие</p><p className="metric-value">{progress.coveragePercent}%</p></Card>
            <Card><p className="metric-title">Освоение</p><p className="metric-value">{progress.masteryPercent}%</p></Card>
            <Card><p className="metric-title">На проверке</p><p className="metric-value">{homeworks.filter((item) => item.status === 'submitted').length}</p></Card>
            <Card><p className="metric-title">Слабые</p><p className="metric-value">{progress.weak.length}</p></Card>
          </div>

          <Section title="Заметка преподавателя" />
          <Card><p className="subtitle">{student.note || 'Заметок пока нет.'}</p></Card>

          <Section title="Следующие действия" />
          {nearestLesson ? (
            <RowCard icon="□" iconTone={toneByStatus(nearestLesson.status)} title={`${formatDateLabel(nearestLesson.startAt)}, ${formatTimeLabel(nearestLesson.startAt)}`} subtitle={`${nearestLesson.topic} · ${formatMaterialCount(nearestLesson.materials?.length || 0)}`} badge={nearestLesson.status} badgeTone={toneByStatus(nearestLesson.status)} onClick={() => openLesson(nearestLesson.id)} />
          ) : <EmptyState title="Урок не запланирован" text="Создайте урок прямо из карточки — ученик будет выбран автоматически." action="Создать урок" onAction={() => openMode('create-lesson', TEACHER_ROUTE.SCHEDULE, { studentId: student.id })} />}
          {activeHomework ? (
            <RowCard icon={iconByStatus(activeHomework.status)} iconTone={toneByStatus(activeHomework.status)} title={activeHomework.title} subtitle={`${statusLabel(activeHomework.status)} · ${formatDateLabel(activeHomework.dueAt || activeHomework.deadline)}`} badge={activeHomework.status} badgeTone={toneByStatus(activeHomework.status)} onClick={() => openHomework(activeHomework.id)} />
          ) : <EmptyState title="Активного ДЗ нет" text="Выдайте домашнее задание из карточки, чтобы не выбирать ученика заново." action="Выдать ДЗ" onAction={() => openMode('create-homework', TEACHER_ROUTE.HOMEWORK, { studentId: student.id })} />}
        </>
      ) : null}

      {tab === STUDENT_CARD_TAB.SCHEDULE ? (
        <>
          <Section title="Расписание ученика" action="Создать урок" onAction={() => openMode('create-lesson', TEACHER_ROUTE.SCHEDULE, { studentId: student.id })} />
          {lessons.length ? lessons.map((lesson) => (
            <RowCard key={lesson.id} icon={lesson.status === 'completed' ? '✓' : lesson.status === 'canceled' ? '×' : '□'} iconTone={toneByStatus(lesson.status)} title={`${formatDateLabel(lesson.startAt)}, ${formatTimeLabel(lesson.startAt)}`} subtitle={`${lesson.topic} · ${formatMaterialCount(lesson.materials?.length || 0)}`} badge={lesson.status} badgeTone={toneByStatus(lesson.status)} onClick={() => openLesson(lesson.id)} />
          )) : <EmptyState title="Уроков пока нет" text="Создайте урок для этого ученика, форма уже будет предзаполнена." action="Создать урок" onAction={() => openMode('create-lesson', TEACHER_ROUTE.SCHEDULE, { studentId: student.id })} />}
        </>
      ) : null}

      {tab === STUDENT_CARD_TAB.HOMEWORK ? (
        <>
          <Section title="Домашние задания" action="Выдать ДЗ" onAction={() => openMode('create-homework', TEACHER_ROUTE.HOMEWORK, { studentId: student.id })} />
          {homeworks.length ? homeworks.map((hw) => (
            <RowCard key={hw.id} icon={iconByStatus(hw.status)} iconTone={toneByStatus(hw.status)} title={hw.title} subtitle={`${formatMaterialCount(hw.materials.length)} · ${formatDateLabel(hw.dueAt || hw.deadline)}`} badge={hw.status} badgeTone={toneByStatus(hw.status)} onClick={() => openHomework(hw.id)} />
          )) : <EmptyState title="ДЗ пока нет" text="Выдайте первое задание из карточки ученика." action="Выдать ДЗ" onAction={() => openMode('create-homework', TEACHER_ROUTE.HOMEWORK, { studentId: student.id })} />}
        </>
      ) : null}

      {tab === STUDENT_CARD_TAB.MATERIALS ? (
        <>
          <Section title="Материалы ученика" action="Загрузить" onAction={() => openMode('upload-material', TEACHER_ROUTE.MATERIALS, { studentId: student.id, taskNumber: suggestedTaskNumber(student, lessons, homeworks) })} />
          {studentMaterials.length ? studentMaterials.map((topic) => (
            <RowCard key={topic.id} icon={topic.taskNumber} iconTone="blue" title={topic.title} subtitle={formatMaterialCount(topic.files.length)} />
          )) : <EmptyState title="Материалов по ученику нет" text="Появятся материалы по пройденным, назначенным или запланированным заданиям." action="Загрузить материал" onAction={() => openMode('upload-material', TEACHER_ROUTE.MATERIALS, { studentId: student.id, taskNumber: suggestedTaskNumber(student, lessons, homeworks) })} />}
        </>
      ) : null}

      {tab === STUDENT_CARD_TAB.PROGRESS ? (
        <StudentProgressTab student={student} data={data} actions={actions} />
      ) : null}

      {tab === STUDENT_CARD_TAB.HISTORY ? (
        <>
          <Section title="История изменений" />
          {history.length ? history.map((item) => (
            <RowCard key={item.id} icon="•" iconTone={item.tone} title={item.title} subtitle={item.subtitle} />
          )) : <EmptyState title="История пока пуста" text="Здесь появятся проведённые уроки, отправки ДЗ, проверки и изменения прогресса." />}
        </>
      ) : null}
    </>
  );
}
