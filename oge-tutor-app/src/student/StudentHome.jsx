/*
 * OGE Tutor App — student home screen.
 * Stage 4: the home screen is a working dashboard, not a static report.
 */
import React from 'react';
import { STUDENT_ROUTE } from '../api/contracts.js';
import { TASKS } from '../domain/tasks/index.js';
import { getStudentProgressView } from '../domain/progress/index.js';
import { HOMEWORK_STATUS, LESSON_STATUS } from '../api/contracts.js';
import { Avatar, Badge, Card, toneByStatus } from '../shared/ui.jsx';
import { formatDateLabel, formatTimeLabel } from '../shared/dateTime.js';

function getFirstName(name) {
  return String(name || '').trim().split(' ')[0] || 'ученик';
}

function getNearestLesson(lessons) {
  return lessons.find((lesson) => [LESSON_STATUS.PLANNED, LESSON_STATUS.RESCHEDULED].includes(lesson.status)) || null;
}

function getPriorityHomework(homeworks) {
  return (
    homeworks.find((hw) => hw.status === HOMEWORK_STATUS.NEEDS_REVISION) ||
    homeworks.find((hw) => hw.status === HOMEWORK_STATUS.OVERDUE) ||
    homeworks.find((hw) => hw.status === HOMEWORK_STATUS.ASSIGNED) ||
    homeworks.find((hw) => hw.status === HOMEWORK_STATUS.SUBMITTED) ||
    null
  );
}

function getTask(taskNumber) {
  return TASKS.find((task) => task.n === taskNumber) || { n: taskNumber, title: `Задание ${taskNumber}` };
}

function getWeakTaskMeta(taskNumber, homeworks) {
  const linkedHomeworks = homeworks.filter((hw) => hw.taskNumbers?.includes(taskNumber));
  const hasActiveHomework = linkedHomeworks.some((hw) => [HOMEWORK_STATUS.ASSIGNED, HOMEWORK_STATUS.NEEDS_REVISION, HOMEWORK_STATUS.OVERDUE].includes(hw.status));
  const hasWaitingHomework = linkedHomeworks.some((hw) => hw.status === HOMEWORK_STATUS.SUBMITTED);

  if (hasActiveHomework) return 'есть ДЗ';
  if (hasWaitingHomework) return 'ждёт проверки';
  if (linkedHomeworks.length) return 'есть история';
  return 'нужно повторить';
}

function TodayAction({ icon, title, value, subtitle, badge, badgeTone = 'blue', onClick }) {
  return (
    <button type="button" className="today-action-card" onClick={onClick}>
      <div className="today-action-icon" aria-hidden="true">{icon}</div>
      <div className="today-action-main">
        <div className="today-action-head">
          <p className="today-action-title">{title}</p>
          {badge ? <Badge tone={badgeTone}>{badge}</Badge> : null}
        </div>
        <p className="today-action-value">{value}</p>
        {subtitle ? <p className="today-action-subtitle">{subtitle}</p> : null}
      </div>
    </button>
  );
}

function PreparationCard({ progress, weakTasks, homeworks, openProgress, openWeakTask }) {
  const firstWeakTask = weakTasks[0];

  return (
    <Card className="student-prep-card">
      <div className="prep-head">
        <div>
          <p className="prep-eyebrow">Подготовка</p>
          <strong className="prep-title">Освоение и покрытие</strong>
          <p className="prep-subtitle">Коротко: что уже проходили и что лучше повторить дальше.</p>
        </div>
        <button type="button" className="link-btn" onClick={openProgress}>Подробнее</button>
      </div>

      <div className="prep-grid">
        <button type="button" className="prep-progress-card" onClick={openProgress}>
          <p className="prep-progress-label">Освоение изученного</p>
          <p className="prep-progress-value">{progress.masteryPercent}%</p>
          <div className="prep-progress-bar" aria-hidden="true">
            <span style={{ width: `${progress.masteryPercent}%` }} />
          </div>
          <p className="prep-progress-note">без учёта непройденных номеров</p>
        </button>

        <div className="prep-stat-stack">
          <div className="prep-stat-card mark">
            <p className="prep-stat-label">Оценка</p>
            <p className="prep-stat-value">{progress.predictedMark}</p>
          </div>
          <div className="prep-stat-card score">
            <p className="prep-stat-label">Баллы</p>
            <p className="prep-stat-value small">{progress.primaryScore}/31</p>
          </div>
        </div>
      </div>

      <div className="repeat-panel">
        <div className="repeat-head">
          <div>
            <strong>Что повторить</strong>
            <p className="subtitle">Сюда попадают только пройденные номера, которые преподаватель оценил как слабые.</p>
          </div>
        </div>

        {weakTasks.length ? (
          <div className="weak-task-grid">
            {weakTasks.map((task) => (
              <button type="button" className="weak-task-card" key={task.n} onClick={() => openWeakTask(task.n)}>
                <span className="weak-task-number">{task.n}</span>
                <span className="weak-task-title">{task.title}</span>
                <span className="weak-task-meta">{getWeakTaskMeta(task.n, homeworks)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="inline-note success">Слабых заданий сейчас нет. Можно поддерживать темп текущими ДЗ и повторением.</div>
        )}

        <button type="button" className="btn btn-soft repeat-cta" onClick={() => firstWeakTask ? openWeakTask(firstWeakTask.n) : openProgress()}>
          {firstWeakTask ? 'Открыть первое слабое задание' : 'Открыть прогресс'}
        </button>
      </div>
    </Card>
  );
}

export default function StudentHome({ student, lessons, homeworks, onNavigate, openWeakTask }) {
  const nearestLesson = getNearestLesson(lessons);
  const activeHomework = getPriorityHomework(homeworks);
  const progress = getStudentProgressView(student);
  const weakTasks = progress.weak.slice(0, 3).map(getTask).filter(Boolean);
  return (
    <>
      <div className="home-hero">
        <div className="home-hero-main">
          <h1 className="title">Привет, {getFirstName(student.name)}</h1>
          <p className="subtitle">{nearestLesson || activeHomework ? 'План на день собран из расписания, ДЗ и прогресса.' : 'Сегодня нет срочных действий. Можно открыть материалы или прогресс.'}</p>
        </div>
        <Avatar avatarId={student.avatar} bg={student.bg} size="md" />
      </div>

      <Card className="today-card">
        <div className="today-head">
          <div>
            <p className="prep-eyebrow">Сегодня</p>
            <strong className="today-title">План на день</strong>
          </div>
        </div>
        <div className="today-grid">
          <TodayAction
            icon="□"
            title="Урок"
            value={nearestLesson ? formatTimeLabel(nearestLesson.startAt) : '—'}
            subtitle={nearestLesson ? nearestLesson.topic : 'Пока нет запланированных уроков'}
            badge={nearestLesson?.status}
            badgeTone={toneByStatus(nearestLesson?.status)}
            onClick={() => onNavigate(STUDENT_ROUTE.LESSONS)}
          />
          <TodayAction
            icon="✓"
            title="ДЗ"
            value={activeHomework ? formatDateLabel(activeHomework.dueAt || activeHomework.deadline) : '—'}
            subtitle={activeHomework ? activeHomework.title : 'Пока нет активных заданий'}
            badge={activeHomework?.status}
            badgeTone={toneByStatus(activeHomework?.status)}
            onClick={() => onNavigate(STUDENT_ROUTE.HOMEWORK)}
          />
        </div>
      </Card>

      <PreparationCard
        student={student}
        progress={progress}
        weakTasks={weakTasks}
        homeworks={homeworks}
        openProgress={() => onNavigate(STUDENT_ROUTE.PROGRESS)}
        openWeakTask={openWeakTask}
      />
      <div className="home-bottom-spacer" />
    </>
  );
}
