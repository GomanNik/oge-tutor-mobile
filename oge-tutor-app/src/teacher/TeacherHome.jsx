/*
 * OGE Tutor App — teacher home screen.
 * Dashboard uses backend contract status codes.
 */
import React from 'react';
import { TEACHER_ROUTE } from '../api/contracts.js';
import { ACCESS_STATUS, HOMEWORK_STATUS, LESSON_STATUS, NOTIFICATION_STATUS, NOTIFICATION_TYPE } from '../api/contracts.js';
import { Avatar, Card, EmptyState, RowCard, Section, toneByStatus } from '../shared/ui.jsx';
import { selectStudent } from '../app/selectors.js';
import { formatDateLabel, formatTimeLabel } from '../shared/dateTime.js';
import { formatMaterialCount } from '../shared/formatters.js';

const getStudent = selectStudent;

export default function TeacherHome({ data, openStudent, openLesson, openHomework, openMode, navigate }) {
  const plannedLessons = data.lessons.filter((item) => [LESSON_STATUS.PLANNED, LESSON_STATUS.RESCHEDULED].includes(item.status));
  const toReview = data.homeworks.filter((item) => item.status === HOMEWORK_STATUS.SUBMITTED);
  const overdue = data.homeworks.filter((item) => item.status === HOMEWORK_STATUS.OVERDUE);
  const access = data.students.filter((item) => item.access !== ACCESS_STATUS.ACTIVE);
  const progressAssessments = (data.notifications || []).filter((item) => item.type === NOTIFICATION_TYPE.PROGRESS_ASSESSMENT_REQUIRED && item.status !== NOTIFICATION_STATUS.RESOLVED);

  return (
    <>
      <div className="header-row header">
        <div>
          <h1 className="title">Главная</h1>
          <p className="subtitle">Что требует внимания сегодня</p>
        </div>
        <Avatar avatarId={data.teacher.avatar} bg={data.teacher.bg} size="md" />
      </div>

      <div className="metric-grid">
        <Card className="card-blue">
          <p className="metric-title">Уроки сегодня</p>
          <p className="metric-value">{plannedLessons.length}</p>
          <p className="metric-subtitle">занятия по расписанию</p>
        </Card>
        <Card>
          <p className="metric-title">ДЗ на проверке</p>
          <p className="metric-value">{toReview.length}</p>
          <p className="metric-subtitle">сданы учениками</p>
        </Card>
        <Card>
          <p className="metric-title">Просроченные ДЗ</p>
          <p className="metric-value" style={{ color: 'var(--red)' }}>{overdue.length}</p>
          <p className="metric-subtitle">требуют внимания</p>
        </Card>
        <Card>
          <p className="metric-title">Активные ученики</p>
          <p className="metric-value">{data.students.length}</p>
          <p className="metric-subtitle">в работе</p>
        </Card>
      </div>

      <Section title="Быстрые действия" />
      <div className="quick-grid">
        <button className="quick-btn" onClick={() => openMode('create-student', TEACHER_ROUTE.STUDENTS)}><span className="quick-icon">👥</span>Добавить ученика</button>
        <button className="quick-btn" onClick={() => openMode('create-lesson', TEACHER_ROUTE.LESSONS)}><span className="quick-icon">📅</span>Создать урок</button>
        <button className="quick-btn" onClick={() => openMode('create-homework', TEACHER_ROUTE.HOMEWORK)}><span className="quick-icon">📝</span>Выдать ДЗ</button>
        <button className="quick-btn" onClick={() => openMode('upload-material', TEACHER_ROUTE.MATERIALS)}><span className="quick-icon">📚</span>Загрузить материал</button>
      </div>

      <Section title="Домашки на проверке" action="Все" onAction={() => navigate(TEACHER_ROUTE.HOMEWORK)} />
      {toReview.length ? toReview.map((hw) => {
        const student = getStudent(data, hw.studentId);
        return (
          <RowCard
            key={hw.id}
            icon="📤"
            iconTone="amber"
            title={student?.name || 'Ученик не найден'}
            subtitle={hw.title}
            badge="Открыть проверку"
            badgeTone="amber"
            onClick={() => openHomework(hw.id)}
          />
        );
      }) : <EmptyState title="Проверять нечего" text="Новых сданных работ пока нет." />}

      <Section title="Ближайшие уроки" action="Все" onAction={() => navigate(TEACHER_ROUTE.LESSONS)} />
      {plannedLessons.slice(0, 2).map((lesson) => {
        const student = getStudent(data, lesson.studentId);
        return (
          <RowCard
            key={lesson.id}
            icon="📅"
            iconTone="violet"
            title={`${formatDateLabel(lesson.startAt)}, ${formatTimeLabel(lesson.startAt)}`}
            subtitle={`${student?.name || 'Ученик не найден'} · ${lesson.topic} · ${formatMaterialCount(lesson.materials?.length || 0)}`}
            badge={lesson.status}
            badgeTone={toneByStatus(lesson.status)}
            onClick={() => openLesson(lesson.id)}
          />
        );
      })}

      <Section title="Требуется оценка прогресса" />
      {progressAssessments.length ? progressAssessments.map((notification) => {
        const student = getStudent(data, notification.studentId);
        return (
          <RowCard
            key={notification.id}
            icon={notification.taskNumber}
            iconTone="amber"
            title={notification.title}
            subtitle={student ? `${student.name} · после завершённого урока` : notification.message}
            badge="Оценить"
            badgeTone="amber"
            onClick={() => openStudent(notification.studentId)}
          />
        );
      }) : <EmptyState title="Нет заданий на оценку" text="После завершения урока с номерами ОГЭ здесь появится напоминание оценить освоение." />}

      <Section title="Риски" />
      {overdue.map((hw) => {
        const student = getStudent(data, hw.studentId);
        return (
          <RowCard
            key={hw.id}
            icon="!"
            iconTone="red"
            title="Просроченное ДЗ"
            subtitle={`${student?.name || 'Ученик не найден'} · ${hw.title}`}
            badge={hw.status}
            badgeTone="red"
            onClick={() => openStudent(hw.studentId)}
          />
        );
      })}
      {access.map((student) => (
        <RowCard
          key={student.id}
          icon="✉️"
          iconTone="amber"
          title="Нужно действие с доступом"
          subtitle={`${student.name} · проверьте статус приглашения`}
          badge={student.access}
          badgeTone="amber"
          onClick={() => openStudent(student.id)}
        />
      ))}
    </>
  );
}
