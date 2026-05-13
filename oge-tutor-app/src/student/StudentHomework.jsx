/*
 * OGE Tutor App — student homework screens.
 * Student submissions send real File objects to the API layer when backend mode is enabled.
 */
import React, { useState } from 'react';
import { HOMEWORK_STATUS, statusLabel } from '../api/contracts.js';
import { formatDateLabel, formatDateTimeLabel } from '../shared/dateTime.js';
import { Badge, Button, Card, Field, Header, MaterialList, RowCard, Section, iconByStatus, toneByStatus } from '../shared/ui.jsx';

function homeworkDueLabel(homework) {
  return formatDateLabel(homework?.dueAt || homework?.deadline, 'дедлайн не указан');
}

function attemptFileTitle(attempt) {
  return attempt?.file || attempt?.fileResource?.originalName || 'Решение';
}

export function StudentHomeworkList({ homeworks, openHomework }) {
  return (
    <>
      <Header title="Домашние задания" subtitle="Задания, дедлайны и загрузка решений" />
      {homeworks.map((hw) => <RowCard key={hw.id} icon={iconByStatus(hw.status)} iconTone={toneByStatus(hw.status)} title={hw.title} subtitle={`${hw.topic} · ${homeworkDueLabel(hw)}`} badge={hw.status} badgeTone={toneByStatus(hw.status)} onClick={() => openHomework(hw.id)} />)}
    </>
  );
}

export function StudentHomeworkDetail({ homework, onBack, onSubmit }) {
  const [fileTitle, setFileTitle] = useState('');
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  if (!homework) return <Card><strong>Домашняя работа не найдена.</strong><p className="subtitle">Возможно, запись уже изменилась.</p></Card>;

  const attempts = homework.attempts || [];
  const canSubmit = [HOMEWORK_STATUS.ASSIGNED, HOMEWORK_STATUS.NEEDS_REVISION, HOMEWORK_STATUS.OVERDUE].includes(homework.status);
  const isWaitingReview = homework.status === HOMEWORK_STATUS.SUBMITTED;
  const isClosed = homework.status === HOMEWORK_STATUS.REVIEWED;
  const hasTeacherFeedback = [HOMEWORK_STATUS.REVIEWED, HOMEWORK_STATUS.NEEDS_REVISION].includes(homework.status) && (homework.teacherComment || homework.reviewMaterials?.length);
  const submitLabel = homework.status === HOMEWORK_STATUS.NEEDS_REVISION ? 'Отправить исправленное решение' : homework.status === HOMEWORK_STATUS.OVERDUE ? 'Сдать после дедлайна' : 'Загрузить решение';

  async function submit() {
    if (!file) {
      setError('Выберите реальный файл решения. Названия без файла недостаточно.');
      return;
    }
    try {
      setIsSaving(true);
      setError('');
      await onSubmit(homework.id, { file, fileTitle: fileTitle.trim() || file.name });
      setFile(null);
      setFileTitle('');
    } catch (err) {
      setError(err?.message || 'Не удалось отправить решение.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <Header title="Карточка ДЗ" subtitle={homework.topic} onBack={onBack} right={<Badge tone={toneByStatus(homework.status)}>{statusLabel(homework.status)}</Badge>} />
      <Card className="form-stack">
        <div>
          <strong>{homework.title}</strong>
          <p className="subtitle">{homework.description}</p>
        </div>
        <div className="lesson-time-card">
          <div>
            <p className="metric-title">Дедлайн</p>
            <p className="lesson-time-main">{homeworkDueLabel(homework)}</p>
          </div>
          <div>
            <p className="metric-title">Статус</p>
            <p className="lesson-time-main">{statusLabel(homework.status)}</p>
          </div>
        </div>
      </Card>

      <Section title="Материалы к заданию" />
      <Card><MaterialList items={homework.materials || []} /></Card>

      {hasTeacherFeedback ? (
        <>
          <Section title={homework.status === HOMEWORK_STATUS.NEEDS_REVISION ? 'Что исправить' : 'Комментарий преподавателя'} />
          <Card className={homework.status === HOMEWORK_STATUS.NEEDS_REVISION ? 'card-amber-soft' : ''}>
            <strong>{homework.status === HOMEWORK_STATUS.NEEDS_REVISION ? 'Работа возвращена на доработку' : 'ДЗ проверено'}</strong>
            <p className="subtitle">{homework.teacherComment || 'Комментарий не добавлен.'}</p>
          </Card>
          {homework.reviewMaterials?.length ? (
            <>
              <Section title="Материалы от преподавателя" />
              <Card><MaterialList items={homework.reviewMaterials} /></Card>
            </>
          ) : null}
        </>
      ) : null}

      <Section title="Решение" />
      <Card className="form-stack">
        {homework.solutionFile ? (
          <div className="file-row"><div className="file-name">📄 {homework.solutionFile}</div><div className="file-source">последняя отправка {homework.submittedAt ? formatDateTimeLabel(homework.submittedAt) : ''}</div></div>
        ) : (
          <div className="file-row" style={{ justifyContent: 'center', color: 'var(--blue)' }}>Решение ещё не загружено</div>
        )}

        {canSubmit ? (
          <>
            <label className="file-drop-zone">
              <input type="file" onChange={(event) => {
                const nextFile = event.target.files?.[0] || null;
                setFile(nextFile);
                setFileTitle(nextFile?.name || '');
              }} />
              <span className="file-drop-icon">📄</span>
              <strong>{fileTitle || 'Выбрать файл решения'}</strong>
              <span>Файл будет передан в API через FormData.</span>
            </label>
            <Field label="Название файла" value={fileTitle} onChange={setFileTitle} placeholder="Например: solution.pdf" disabled={!file} />
            {error ? <div className="inline-error">{error}</div> : null}
            <Button onClick={submit} disabled={!file || isSaving}>{isSaving ? 'Отправляем…' : submitLabel}</Button>
          </>
        ) : null}

        {isWaitingReview ? <div className="card card-amber-soft">Решение отправлено преподавателю. Пока работа ожидает проверки, изменить отправку нельзя.</div> : null}
        {isClosed ? <div className="card card-green-soft">Домашняя работа проверена и закрыта. Её можно только просматривать.</div> : null}
      </Card>

      <Section title="История отправок" />
      <Card>
        {attempts.length ? attempts.map((attempt, index) => (
          <div className="file-row" key={attempt.id || `${attemptFileTitle(attempt)}-${index}`}>
            <div>
              <div className="file-name">📄 {attemptFileTitle(attempt)}</div>
              <div className="file-source">{formatDateTimeLabel(attempt.submittedAt)} · {statusLabel(attempt.reviewStatus || HOMEWORK_STATUS.SUBMITTED)}</div>
            </div>
          </div>
        )) : <p className="subtitle">Отправок пока нет.</p>}
      </Card>
    </>
  );
}
