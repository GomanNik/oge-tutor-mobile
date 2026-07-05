/*
 * OGE Tutor App — teacher command center.
 * The dashboard is organized around "what should I do today?" instead of static metrics.
 */
import React from 'react';
import { TEACHER_ROUTE } from '../api/contracts.js';
import { HOMEWORK_STATUS, LESSON_STATUS } from '../api/contracts.js';
import { Avatar, Badge, Button, Card, EmptyState, RowCard, Section, toneByStatus } from '../shared/ui.jsx';
import { NotificationsPreview } from '../shared/NotificationsScreen.jsx';
import { selectTeacherOverview, getStudentById } from '../domain/productSelectors.js';
import { formatDateLabel, formatTimeLabel } from '../shared/dateTime.js';
import { formatMaterialCount } from '../shared/formatters.js';

function LessonRow({ data, lesson, openLesson }) {
  const student = getStudentById(data, lesson.studentId);
  return (
    <RowCard
      icon={lesson.status === LESSON_STATUS.RESCHEDULED ? '↻' : '□'}
      iconTone={toneByStatus(lesson.status)}
      title={`${formatTimeLabel(lesson.startAt)} · ${student?.name || 'Ученик не найден'}`}
      subtitle={`${lesson.topic || 'Тема не указана'} · ${formatMaterialCount(lesson.materials?.length || 0)}`}
      badge={lesson.status}
      badgeTone={toneByStatus(lesson.status)}
      onClick={() => openLesson(lesson.id)}
    />
  );
}

function HomeworkReviewRow({ data, homework, openHomework }) {
  const student = getStudentById(data, homework.studentId);
  return (
    <RowCard
      icon={homework.status === HOMEWORK_STATUS.OVERDUE ? '!' : '✓'}
      iconTone={toneByStatus(homework.status)}
      title={homework.title}
      subtitle={`${student?.name || 'Ученик не найден'} · ${formatDateLabel(homework.dueAt)}`}
      badge={homework.status}
      badgeTone={toneByStatus(homework.status)}
      onClick={() => openHomework(homework.id)}
    />
  );
}

function QuickAction({ icon, label, onClick }) {
  return (
    <button type="button" className="quick-btn" onClick={onClick}>
      <span className="quick-icon" aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function formatLessonCount(count) {
  const value = Number(count) || 0;
  const lastDigit = value % 10;
  const lastTwoDigits = value % 100;
  if (lastDigit === 1 && lastTwoDigits !== 11) return `${value} занятие`;
  if ([2, 3, 4].includes(lastDigit) && ![12, 13, 14].includes(lastTwoDigits)) return `${value} занятия`;
  return `${value} занятий`;
}

export default function TeacherHome({ data, notifications = [], openStudent, openLesson, openHomework, openMode, navigate }) {
  const overview = selectTeacherOverview(data);
  const nearestStudent = overview.nearestLesson ? getStudentById(data, overview.nearestLesson.studentId) : null;

  return (
    <>
      <div className="home-hero teacher-home-hero">
        <div className="home-hero-main">
          <h1 className="title">Главная</h1>
          <p className="subtitle">Что нужно сделать сегодня: занятия, проверки, просрочки и события доступа.</p>
        </div>
        <button type="button" className="avatar-action" onClick={() => navigate(TEACHER_ROUTE.PROFILE)} aria-label="Открыть профиль">
          <Avatar avatarId={data.teacher.avatar} bg={data.teacher.bg} size="md" />
        </button>
      </div>

      <Card className="today-focus-card">
        <div className="today-head">
          <div>
            <p className="prep-eyebrow">Сегодня</p>
            <strong className="today-title">{overview.todayLessons.length ? `${formatLessonCount(overview.todayLessons.length)} в расписании` : 'Занятий на сегодня нет'}</strong>
            <p className="prep-subtitle">
              {overview.nearestLesson
                ? `Ближайшее: ${formatDateLabel(overview.nearestLesson.startAt)}, ${formatTimeLabel(overview.nearestLesson.startAt)} · ${nearestStudent?.name || 'ученик'}`
                : 'Можно разобрать сданные работы или подготовить материалы.'}
            </p>
          </div>
          <Badge tone={overview.toReview.length || overview.overdue.length ? 'amber' : 'green'}>
            {overview.toReview.length + overview.overdue.length ? 'есть задачи' : 'спокойно'}
          </Badge>
        </div>

        <div className="dashboard-action-strip">
          <button type="button" onClick={() => navigate(TEACHER_ROUTE.SCHEDULE)}>
            <strong>{overview.todayLessons.length}</strong>
            <span>сегодня</span>
          </button>
          <button type="button" onClick={() => navigate(TEACHER_ROUTE.HOMEWORK)}>
            <strong>{overview.toReview.length}</strong>
            <span>на проверке</span>
          </button>
          <button type="button" onClick={() => navigate(TEACHER_ROUTE.HOMEWORK)}>
            <strong>{overview.overdue.length}</strong>
            <span>просрочено</span>
          </button>
        </div>
      </Card>

      <Section title="Быстрые действия" />
      <div className="quick-grid quick-grid-3">
        <QuickAction icon="+" label="Добавить ученика" onClick={() => openMode('create-student', TEACHER_ROUTE.STUDENTS)} />
        <QuickAction icon="□" label="Создать урок" onClick={() => openMode('create-lesson', TEACHER_ROUTE.SCHEDULE)} />
        <QuickAction icon="✓" label="Выдать ДЗ" onClick={() => openMode('create-homework', TEACHER_ROUTE.HOMEWORK)} />
        <QuickAction icon="▦" label="Загрузить материал" onClick={() => openMode('upload-material', TEACHER_ROUTE.MATERIALS)} />
        <QuickAction icon="↦" label="Открыть расписание" onClick={() => navigate(TEACHER_ROUTE.SCHEDULE)} />
        <QuickAction icon="∑" label="Проверить работы" onClick={() => navigate(TEACHER_ROUTE.HOMEWORK)} />
      </div>

      <Section title="Занятия сегодня" action="Расписание" onAction={() => navigate(TEACHER_ROUTE.SCHEDULE)} />
      {overview.todayLessons.length ? overview.todayLessons.map((lesson) => (
        <LessonRow key={lesson.id} data={data} lesson={lesson} openLesson={openLesson} />
      )) : (
        <EmptyState
          title="Сегодня нет уроков"
          text="Создайте занятие из расписания или карточки ученика, если нужно поставить урок на конкретного ученика."
          action="Создать урок"
          onAction={() => openMode('create-lesson', TEACHER_ROUTE.SCHEDULE)}
        />
      )}

      <Section title="Ближайшее занятие" />
      {overview.nearestLesson ? (
        <Card className="form-stack">
          <div className="lesson-time-card">
            <div>
              <p className="metric-title">Дата</p>
              <p className="lesson-time-main">{formatDateLabel(overview.nearestLesson.startAt)}</p>
            </div>
            <div>
              <p className="metric-title">Время</p>
              <p className="lesson-time-main">{formatTimeLabel(overview.nearestLesson.startAt)}</p>
            </div>
          </div>
          <p className="subtitle">{nearestStudent?.name || 'Ученик не найден'} · {overview.nearestLesson.topic}</p>
          <Button variant="soft" onClick={() => openLesson(overview.nearestLesson.id)}>Открыть урок</Button>
        </Card>
      ) : <EmptyState title="Ближайших занятий нет" text="Когда появится запланированный урок, он станет главным действием на главной." />}

      <Section title="ДЗ на проверке" action="Все ДЗ" onAction={() => navigate(TEACHER_ROUTE.HOMEWORK)} />
      {overview.toReview.length ? overview.toReview.slice(0, 3).map((hw) => (
        <HomeworkReviewRow key={hw.id} data={data} homework={hw} openHomework={openHomework} />
      )) : <EmptyState title="Проверять нечего" text="Сданные работы появятся здесь сразу после отправки учеником." />}

      <Section title="Просроченные ДЗ" />
      {overview.overdue.length ? overview.overdue.slice(0, 3).map((hw) => (
        <HomeworkReviewRow key={hw.id} data={data} homework={hw} openHomework={openHomework} />
      )) : <EmptyState title="Просрочек нет" text="Дедлайны под контролем." />}

      <NotificationsPreview
        notifications={notifications}
        onOpenAll={() => navigate(TEACHER_ROUTE.NOTIFICATIONS)}
        onOpen={(item) => {
          if (item.homeworkId) openHomework(item.homeworkId);
          else if (item.lessonId) openLesson(item.lessonId);
          else if (item.studentId) openStudent(item.studentId);
        }}
      />
    </>
  );
}
