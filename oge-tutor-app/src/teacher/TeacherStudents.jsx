/*
 * OGE Tutor App — teacher student list, creation, and student card.
 * Student management actions are delegated to backend API methods.
 */
import React, { useState } from 'react';
import { TEACHER_ROUTE } from '../api/contracts.js';
import { statusLabel } from '../api/contracts.js';
import { getStudentProgressView } from '../domain/progress/index.js';
import { selectStudent } from '../app/selectors.js';
import { formatDateLabel, formatTimeLabel } from '../shared/dateTime.js';
import { formatMaterialCount } from '../shared/formatters.js';
import { Avatar, Badge, Button, Card, Field, Header, RowCard, Section, TextArea, cx, iconByStatus, solidBg, toneByStatus } from '../shared/ui.jsx';
import { StudentProgressTab } from './student-progress/StudentProgressTab.jsx';

const getStudent = selectStudent;

const STUDENT_CARD_TAB = Object.freeze({
  OVERVIEW: 'overview',
  LESSONS: 'lessons',
  HOMEWORK: 'homework',
  MATERIALS: 'materials',
  PROGRESS: 'progress',
  ACCESS: 'access',
});

const STUDENT_CARD_TABS = [
  { value: STUDENT_CARD_TAB.OVERVIEW, label: 'Обзор' },
  { value: STUDENT_CARD_TAB.LESSONS, label: 'Уроки' },
  { value: STUDENT_CARD_TAB.HOMEWORK, label: 'ДЗ' },
  { value: STUDENT_CARD_TAB.MATERIALS, label: 'Материалы' },
  { value: STUDENT_CARD_TAB.PROGRESS, label: 'Прогресс' },
  { value: STUDENT_CARD_TAB.ACCESS, label: 'Доступ' },
];

export function StudentsList({ data, openStudent, openCreate }) {
  return (
    <>
      <Header title="Ученики" subtitle="Список учеников, доступ, прогресс и текущие задачи" />
      <Button onClick={openCreate}>Добавить ученика</Button>
      <Section title="Активные ученики" />
      {data.students.map((student) => {
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
      })}
    </>
  );
}

export function CreateStudent({ actions, onBack }) {
  const [form, setForm] = useState({ name: '', email: '', grade: '', goal: '', note: '' });
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  async function submit() {
    try {
      setIsSaving(true);
      setError('');
      await actions.createStudent(form);
      onBack();
    } catch (err) {
      setError(err?.message || 'Не удалось создать ученика.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <Header title="Добавить ученика" subtitle="После создания аккаунта backend отправляет ученику письмо для установки пароля." onBack={onBack} />
      <Card className="form-stack">
        {error ? <div className="inline-error">{error}</div> : null}
        <Field label="Имя ученика" value={form.name} onChange={(name) => setForm({ ...form, name })} placeholder="Иван Петров" />
        <Field label="Email" value={form.email} onChange={(email) => setForm({ ...form, email })} placeholder="student@mail.ru" />
        <Field label="Класс" value={form.grade} onChange={(grade) => setForm({ ...form, grade })} placeholder="Например: 9 класс" />
        <Field label="Цель" value={form.goal} onChange={(goal) => setForm({ ...form, goal })} placeholder="Например: ОГЭ на 4" />
        <TextArea label="Комментарий" value={form.note} onChange={(note) => setForm({ ...form, note })} placeholder="Что важно помнить по ученику" />
        <div className="card card-amber-soft">Публичной регистрации нет: преподаватель создаёт аккаунт, а ученик задаёт пароль по ссылке из письма.</div>
        <Button onClick={submit} disabled={!form.name.trim() || !form.email.trim() || isSaving}>{isSaving ? 'Создаём…' : 'Создать и отправить письмо'}</Button>
      </Card>
    </>
  );
}

export function StudentCard({ data, actions, studentId, openMode, openHomework, openLesson, onBack }) {
  const [tab, setTab] = useState(STUDENT_CARD_TAB.OVERVIEW);
  const [accessMessage, setAccessMessage] = useState('');
  const [accessError, setAccessError] = useState('');
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

  async function runAccessAction(action, successText) {
    try {
      setAccessError('');
      setAccessMessage('');
      await action(student.id);
      setAccessMessage(successText);
    } catch (err) {
      setAccessError(err?.message || 'Не удалось выполнить действие.');
    }
  }

  return (
    <>
      <Header title={student.name} subtitle={[student.grade, student.goal].filter(Boolean).join(' · ') || 'Профиль ученика'} onBack={onBack} right={<Badge tone={toneByStatus(student.access)}>{statusLabel(student.access)}</Badge>} />
      <div className={`profile-hero ${solidBg(student.bg)}`}>
        <div className="profile-content">
          <Avatar avatarId={student.avatar} bg={student.bg} size="lg" />
          <p className="profile-name">{student.name}</p>
          <p className="profile-email">{student.email}</p>
        </div>
      </div>

      <div className="tab-row">
        {STUDENT_CARD_TABS.map((item) => (
          <button className={cx('tab-btn', tab === item.value && 'active')} key={item.value} onClick={() => setTab(item.value)}>{item.label}</button>
        ))}
      </div>

      {tab === STUDENT_CARD_TAB.OVERVIEW ? (
        <>
          <Section title="Что важно" />
          <Card>{student.note || 'Заметок пока нет.'}</Card>
          <Section title="Текущие задачи" />
          {lessons.slice(0, 1).map((lesson) => (
            <RowCard key={lesson.id} icon="📅" iconTone="violet" title={`${formatDateLabel(lesson.startAt)}, ${formatTimeLabel(lesson.startAt)}`} subtitle={`${lesson.topic} · ${formatMaterialCount(lesson.materials?.length || 0)}`} badge={lesson.status} badgeTone={toneByStatus(lesson.status)} onClick={() => openLesson(lesson.id)} />
          ))}
          {homeworks.slice(0, 2).map((hw) => (
            <RowCard key={hw.id} icon={iconByStatus(hw.status)} iconTone={toneByStatus(hw.status)} title={hw.title} subtitle={`${statusLabel(hw.status)} · ${formatDateLabel(hw.dueAt || hw.deadline)}`} badge={hw.status} badgeTone={toneByStatus(hw.status)} onClick={() => openHomework(hw.id)} />
          ))}
        </>
      ) : null}

      {tab === STUDENT_CARD_TAB.LESSONS ? (
        <>
          <Section title="Уроки ученика" action="Создать" onAction={() => openMode('create-lesson', TEACHER_ROUTE.LESSONS)} />
          {lessons.map((lesson) => (
            <RowCard key={lesson.id} icon="📅" iconTone={toneByStatus(lesson.status)} title={`${formatDateLabel(lesson.startAt)}, ${formatTimeLabel(lesson.startAt)}`} subtitle={`${lesson.topic} · ${formatMaterialCount(lesson.materials?.length || 0)}`} badge={lesson.status} badgeTone={toneByStatus(lesson.status)} onClick={() => openLesson(lesson.id)} />
          ))}
        </>
      ) : null}

      {tab === STUDENT_CARD_TAB.HOMEWORK ? (
        <>
          <Section title="Домашние задания" action="Выдать" onAction={() => openMode('create-homework', TEACHER_ROUTE.HOMEWORK)} />
          {homeworks.map((hw) => (
            <RowCard key={hw.id} icon={iconByStatus(hw.status)} iconTone={toneByStatus(hw.status)} title={hw.title} subtitle={`${formatMaterialCount(hw.materials.length)} · ${formatDateLabel(hw.dueAt || hw.deadline)}`} badge={hw.status} badgeTone={toneByStatus(hw.status)} onClick={() => openHomework(hw.id)} />
          ))}
        </>
      ) : null}

      {tab === STUDENT_CARD_TAB.MATERIALS ? (
        <>
          <Section title="Материалы" action="Загрузить" onAction={() => openMode('upload-material', TEACHER_ROUTE.MATERIALS)} />
          {studentMaterials.length ? studentMaterials.map((topic) => <RowCard key={topic.id} icon={topic.taskNumber} iconTone="blue" title={topic.title} subtitle={formatMaterialCount(topic.files.length)} />) : <Card><p className="subtitle">Для ученика пока нет материалов по пройденным, назначенным или запланированным заданиям.</p></Card>}
        </>
      ) : null}

      {tab === STUDENT_CARD_TAB.PROGRESS ? (
        <StudentProgressTab student={student} data={data} actions={actions} />
      ) : null}

      {tab === STUDENT_CARD_TAB.ACCESS ? (
        <>
          <Section title="Доступ ученика" />
          <Card className="form-stack">
            <div className="file-row">
              <div>
                <div className="file-name">Email входа</div>
                <div className="file-source">{student.email}</div>
              </div>
              <Badge tone={toneByStatus(student.access)}>{statusLabel(student.access)}</Badge>
            </div>
            {accessMessage ? <div className="inline-note success">{accessMessage}</div> : null}
            {accessError ? <div className="inline-error">{accessError}</div> : null}
            <Button variant="light" onClick={() => runAccessAction(actions.resendStudentInvite, 'Письмо повторно отправлено.')}>Отправить письмо повторно</Button>
            <Button variant="soft" onClick={() => runAccessAction(actions.resetStudentPassword, 'Ссылка установки пароля обновлена.')}>Сбросить ссылку установки пароля</Button>
            <Button variant="danger" onClick={() => runAccessAction(actions.disableStudentAccess, 'Доступ ученика отключён.')}>Отключить доступ</Button>
          </Card>
        </>
      ) : null}
    </>
  );
}
