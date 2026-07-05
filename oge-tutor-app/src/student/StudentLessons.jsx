/*
 * OGE Tutor App — student lesson screens.
 * Lesson UI formats backend ISO/RFC3339 schedule fields.
 */
import React from 'react';
import { LESSON_STATUS, statusLabel } from '../api/contracts.js';
import { Badge, Card, EmptyState, Header, MaterialList, RowCard, Section, toneByStatus } from '../shared/ui.jsx';
import { ACTIVE_LESSON_STATUSES } from '../shared/constants.js';
import { formatDateLabel, formatTimeLabel } from '../shared/dateTime.js';
import { formatMaterialCount } from '../shared/formatters.js';

function lessonTitle(lesson) {
  return `${formatDateLabel(lesson.startAt)}, ${formatTimeLabel(lesson.startAt)}`;
}

export function StudentLessons({ lessons, openLesson }) {
  const planned = lessons.filter((lesson) => ACTIVE_LESSON_STATUSES.includes(lesson.status));
  const history = lessons.filter((lesson) => !ACTIVE_LESSON_STATUSES.includes(lesson.status));
  return (
    <>
      <Header title="Уроки" subtitle="Дата, время, тема и материалы занятия" />
      <Section title="Ближайшие уроки" />
      {planned.map((lesson) => (
        <RowCard key={lesson.id} icon="□" iconTone="violet" title={lessonTitle(lesson)} subtitle={`${lesson.topic} · ${formatMaterialCount(lesson.materials?.length || 0)}`} badge={lesson.status} badgeTone={toneByStatus(lesson.status)} onClick={() => openLesson(lesson.id)} />
      ))}
      {!planned.length ? <EmptyState title="Ближайших уроков нет" text="Когда преподаватель запланирует занятие, оно появится в этом списке." /> : null}
      <Section title="История занятий" />
      {history.map((lesson) => (
        <RowCard key={lesson.id} icon={lesson.status === LESSON_STATUS.CANCELED ? '×' : '✓'} iconTone={toneByStatus(lesson.status)} title={lessonTitle(lesson)} subtitle={`${lesson.topic} · ${formatMaterialCount(lesson.materials?.length || 0)}`} badge={lesson.status} badgeTone={toneByStatus(lesson.status)} onClick={() => openLesson(lesson.id)} />
      ))}
      {!history.length ? <EmptyState title="История занятий пуста" text="Проведённые и отменённые уроки появятся здесь." /> : null}
    </>
  );
}

export function StudentLessonDetail({ lesson, onBack }) {
  if (!lesson) return <Card><strong>Урок не найден.</strong><p className="subtitle">Возможно, запись уже изменилась.</p></Card>;
  return (
    <>
      <Header title="Карточка урока" subtitle={lesson.topic} onBack={onBack} right={<Badge tone={toneByStatus(lesson.status)}>{statusLabel(lesson.status)}</Badge>} />
      <Card className="form-stack">
        <div className="lesson-time-card">
          <div>
            <p className="metric-title">Дата</p>
            <p className="lesson-time-main">{formatDateLabel(lesson.startAt)}</p>
          </div>
          <div>
            <p className="metric-title">Время</p>
            <p className="lesson-time-main">{formatTimeLabel(lesson.startAt)}</p>
          </div>
        </div>
        {lesson.note ? <p className="subtitle">{lesson.note}</p> : <p className="subtitle">Заметка по уроку пока не добавлена.</p>}
      </Card>
      <Section title="Материалы к уроку" />
      <Card><MaterialList items={lesson.materials || []} /></Card>
    </>
  );
}
