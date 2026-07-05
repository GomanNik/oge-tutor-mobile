/*
 * OGE Tutor App — product-level selectors for dashboards, schedule, notifications and material usage.
 * These selectors derive UX state from existing contracts instead of inventing frontend-only data.
 */
import {
  ACCESS_STATUS,
  HOMEWORK_STATUS,
  LESSON_STATUS,
  NOTIFICATION_STATUS,
  NOTIFICATION_TYPE,
  statusLabel,
} from '../api/contracts.js';
import { TASKS, getTaskTitle } from './tasks/index.js';
import { progressCoverageLabel, progressMasteryLabel } from './progress/index.js';
import { formatDateLabel, formatDateTimeLabel, formatTimeLabel } from '../shared/dateTime.js';
import { materialDisplayTitle, materialKey } from '../shared/formatters.js';

const ACTIVE_LESSONS = new Set([LESSON_STATUS.PLANNED, LESSON_STATUS.RESCHEDULED]);
const DONE_LESSONS = new Set([LESSON_STATUS.COMPLETED, LESSON_STATUS.CANCELED]);

function asTime(value) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function startOfDay(date = new Date()) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date = new Date()) {
  const next = startOfDay(date);
  next.setDate(next.getDate() + 1);
  return next;
}

function addDays(date, count) {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
}

export function isSameDayIso(iso, date = new Date()) {
  const timestamp = asTime(iso);
  if (!timestamp) return false;
  const start = startOfDay(date).getTime();
  const end = endOfDay(date).getTime();
  return timestamp >= start && timestamp < end;
}

export function isWithinNextDaysIso(iso, days = 7, date = new Date()) {
  const timestamp = asTime(iso);
  if (!timestamp) return false;
  const start = startOfDay(date).getTime();
  const end = startOfDay(addDays(date, days + 1)).getTime();
  return timestamp >= start && timestamp < end;
}

export function sortByStartAt(items = []) {
  return [...items].sort((a, b) => asTime(a.startAt) - asTime(b.startAt));
}

export function sortByCreatedAtDesc(items = []) {
  return [...items].sort((a, b) => asTime(b.createdAt || b.updatedAt) - asTime(a.createdAt || a.updatedAt));
}

export function getStudentById(data, studentId) {
  return (data.students || []).find((student) => student.id === studentId) || null;
}

export function selectTeacherOverview(data, now = new Date()) {
  const activeLessons = sortByStartAt((data.lessons || []).filter((lesson) => ACTIVE_LESSONS.has(lesson.status)));
  const todayLessons = activeLessons.filter((lesson) => isSameDayIso(lesson.startAt, now));
  const upcomingLessons = activeLessons.filter((lesson) => asTime(lesson.startAt) >= startOfDay(now).getTime());
  const nearestLesson = upcomingLessons[0] || null;
  const toReview = (data.homeworks || []).filter((item) => item.status === HOMEWORK_STATUS.SUBMITTED);
  const overdue = (data.homeworks || []).filter((item) => item.status === HOMEWORK_STATUS.OVERDUE);
  const accessRisks = (data.students || []).filter((item) => item.access !== ACCESS_STATUS.ACTIVE);
  const newEvents = deriveTeacherNotifications(data, now).slice(0, 5);

  return {
    todayLessons,
    nearestLesson,
    upcomingLessons,
    toReview,
    overdue,
    accessRisks,
    newEvents,
  };
}

function notice(id, type, title, message, extra = {}) {
  return {
    id,
    type,
    title,
    message,
    status: extra.status || NOTIFICATION_STATUS.UNREAD,
    createdAt: extra.createdAt || extra.startAt || '',
    tone: extra.tone || 'blue',
    studentId: extra.studentId || '',
    lessonId: extra.lessonId || '',
    homeworkId: extra.homeworkId || '',
    taskNumber: extra.taskNumber ?? null,
    actionLabel: extra.actionLabel || 'Открыть',
  };
}

export function deriveTeacherNotifications(data, now = new Date()) {
  const backend = (data.notifications || [])
    .filter((item) => item.status !== NOTIFICATION_STATUS.RESOLVED)
    .map((item) => {
      const student = getStudentById(data, item.studentId);
      return notice(
        item.id || `backend-${item.type}-${item.studentId}-${item.taskNumber}`,
        item.type,
        item.title || 'Уведомление',
        student ? `${student.name} · ${item.message || ''}` : item.message,
        { ...item, tone: 'amber', actionLabel: item.type === NOTIFICATION_TYPE.PROGRESS_ASSESSMENT_REQUIRED ? 'Оценить' : 'Открыть' },
      );
    });

  const submitted = (data.homeworks || [])
    .filter((hw) => hw.status === HOMEWORK_STATUS.SUBMITTED)
    .map((hw) => {
      const student = getStudentById(data, hw.studentId);
      return notice(
        `hw-submitted-${hw.id}`,
        NOTIFICATION_TYPE.HOMEWORK_SUBMITTED,
        'Работа ждёт проверки',
        `${student?.name || 'Ученик'} · ${hw.title}`,
        { homeworkId: hw.id, studentId: hw.studentId, createdAt: hw.submittedAt || hw.updatedAt, tone: 'amber', actionLabel: 'Проверить' },
      );
    });

  const overdue = (data.homeworks || [])
    .filter((hw) => hw.status === HOMEWORK_STATUS.OVERDUE)
    .map((hw) => {
      const student = getStudentById(data, hw.studentId);
      return notice(
        `hw-overdue-${hw.id}`,
        NOTIFICATION_TYPE.HOMEWORK_OVERDUE,
        'Просроченное ДЗ',
        `${student?.name || 'Ученик'} · дедлайн ${formatDateLabel(hw.dueAt)}`,
        { homeworkId: hw.id, studentId: hw.studentId, createdAt: hw.dueAt, tone: 'red' },
      );
    });

  const upcoming = sortByStartAt(data.lessons || [])
    .filter((lesson) => ACTIVE_LESSONS.has(lesson.status) && isWithinNextDaysIso(lesson.startAt, 1, now))
    .map((lesson) => {
      const student = getStudentById(data, lesson.studentId);
      return notice(
        `lesson-upcoming-${lesson.id}`,
        NOTIFICATION_TYPE.UPCOMING_LESSON,
        'Ближайший урок',
        `${formatTimeLabel(lesson.startAt)} · ${student?.name || 'Ученик'} · ${lesson.topic}`,
        { lessonId: lesson.id, studentId: lesson.studentId, startAt: lesson.startAt, tone: 'blue' },
      );
    });

  const access = (data.students || [])
    .filter((student) => student.access !== ACCESS_STATUS.ACTIVE)
    .map((student) => notice(
      `access-${student.id}-${student.access}`,
      NOTIFICATION_TYPE.STUDENT_ACCESS,
      student.access === ACCESS_STATUS.DISABLED ? 'Доступ отключён' : 'Доступ не активирован',
      `${student.name} · ${statusLabel(student.access)}`,
      { studentId: student.id, createdAt: student.updatedAt || student.createdAt, tone: student.access === ACCESS_STATUS.DISABLED ? 'red' : 'amber', actionLabel: 'Открыть ученика' },
    ));

  return sortByCreatedAtDesc([...backend, ...submitted, ...overdue, ...upcoming, ...access]);
}

export function deriveStudentNotifications({ student, lessons = [], homeworks = [], materials = [], notifications = [] }, now = new Date()) {
  const incoming = (notifications || [])
    .filter((item) => item.status !== NOTIFICATION_STATUS.RESOLVED)
    .map((item) => notice(item.id, item.type, item.title, item.message, { ...item, tone: 'amber' }));

  const assigned = homeworks
    .filter((hw) => hw.status === HOMEWORK_STATUS.ASSIGNED || hw.status === HOMEWORK_STATUS.NEEDS_REVISION || hw.status === HOMEWORK_STATUS.OVERDUE)
    .slice(0, 4)
    .map((hw) => notice(
      `student-hw-${hw.id}`,
      NOTIFICATION_TYPE.HOMEWORK_ASSIGNED,
      hw.status === HOMEWORK_STATUS.NEEDS_REVISION ? 'ДЗ вернули на доработку' : hw.status === HOMEWORK_STATUS.OVERDUE ? 'ДЗ просрочено' : 'Новое ДЗ',
      `${hw.title} · дедлайн ${formatDateLabel(hw.dueAt)}`,
      { homeworkId: hw.id, createdAt: hw.assignedAt || hw.updatedAt, tone: hw.status === HOMEWORK_STATUS.OVERDUE ? 'red' : 'amber' },
    ));

  const reviewed = homeworks
    .filter((hw) => hw.status === HOMEWORK_STATUS.REVIEWED)
    .slice(0, 3)
    .map((hw) => notice(
      `student-reviewed-${hw.id}`,
      NOTIFICATION_TYPE.HOMEWORK_REVIEWED,
      'Работа проверена',
      `${hw.title}${hw.teacherComment ? ` · ${hw.teacherComment}` : ''}`,
      { homeworkId: hw.id, createdAt: hw.reviewedAt || hw.updatedAt, tone: 'green' },
    ));

  const upcoming = sortByStartAt(lessons)
    .filter((lesson) => ACTIVE_LESSONS.has(lesson.status) && isWithinNextDaysIso(lesson.startAt, 1, now))
    .map((lesson) => notice(
      `student-lesson-${lesson.id}`,
      NOTIFICATION_TYPE.UPCOMING_LESSON,
      'Ближайший урок',
      `${formatDateLabel(lesson.startAt)}, ${formatTimeLabel(lesson.startAt)} · ${lesson.topic}`,
      { lessonId: lesson.id, startAt: lesson.startAt, tone: 'blue' },
    ));

  const materialNotices = (materials || [])
    .flatMap((topic) => (topic.files || []).slice(0, 1).map((file) => notice(
      `student-material-${topic.id}-${file.id || materialKey(file)}`,
      NOTIFICATION_TYPE.NEW_MATERIAL,
      'Материал доступен',
      `Задание ${topic.taskNumber} · ${materialDisplayTitle(file)}`,
      { topicId: topic.id, createdAt: file.uploadedAt || '', tone: 'blue' },
    )))
    .slice(0, 3);

  return sortByCreatedAtDesc([...incoming, ...assigned, ...reviewed, ...upcoming, ...materialNotices]).map((item) => ({
    ...item,
    studentId: item.studentId || student?.id || '',
  }));
}

function matchMaterial(candidate, item) {
  if (!candidate || !item) return false;
  const candidateIds = [candidate.id, candidate.fileId, candidate.libraryFileId, candidate.url].filter(Boolean).map(String);
  const itemIds = [item.id, item.fileId, item.libraryFileId, item.url].filter(Boolean).map(String);
  if (candidateIds.some((id) => itemIds.includes(id))) return true;
  return materialKey(candidate) === materialKey(item);
}

function pushUsage(usages, item, source, candidate) {
  if (!matchMaterial(candidate, item)) return;
  usages.push(source);
}

export function getMaterialUsage(data, topic, file) {
  const candidate = { ...file, taskNumber: topic?.taskNumber, topicId: topic?.id, topicTitle: topic?.title };
  const usages = [];

  (data.lessons || []).forEach((lesson) => {
    (lesson.materials || []).forEach((item) => pushUsage(usages, item, {
      kind: 'lesson',
      id: lesson.id,
      studentId: lesson.studentId,
      title: lesson.topic || 'Урок',
      label: `Урок · ${formatDateLabel(lesson.startAt)} ${formatTimeLabel(lesson.startAt)}`,
    }, candidate));
  });

  (data.homeworks || []).forEach((homework) => {
    (homework.materials || []).forEach((item) => pushUsage(usages, item, {
      kind: 'homework',
      id: homework.id,
      studentId: homework.studentId,
      title: homework.title,
      label: `ДЗ · ${statusLabel(homework.status)}`,
    }, candidate));
    (homework.reviewMaterials || []).forEach((item) => pushUsage(usages, item, {
      kind: 'homework',
      id: homework.id,
      studentId: homework.studentId,
      title: homework.title,
      label: 'Материал после проверки',
    }, candidate));
  });

  return usages;
}

export function getStudentHistory(data, studentId) {
  const lessons = (data.lessons || [])
    .filter((lesson) => lesson.studentId === studentId && DONE_LESSONS.has(lesson.status))
    .map((lesson) => ({
      id: `lesson-${lesson.id}`,
      title: lesson.status === LESSON_STATUS.CANCELED ? 'Урок отменён' : 'Урок проведён',
      subtitle: `${lesson.topic} · ${formatDateTimeLabel(lesson.completedAt || lesson.updatedAt || lesson.startAt)}`,
      tone: lesson.status === LESSON_STATUS.CANCELED ? 'red' : 'green',
      createdAt: lesson.completedAt || lesson.updatedAt || lesson.startAt,
    }));

  const homeworks = (data.homeworks || [])
    .filter((homework) => homework.studentId === studentId)
    .flatMap((homework) => [
      {
        id: `homework-${homework.id}`,
        title: `ДЗ: ${statusLabel(homework.status)}`,
        subtitle: `${homework.title} · дедлайн ${formatDateLabel(homework.dueAt)}`,
        tone: homework.status === HOMEWORK_STATUS.OVERDUE ? 'red' : homework.status === HOMEWORK_STATUS.REVIEWED ? 'green' : 'amber',
        createdAt: homework.reviewedAt || homework.submittedAt || homework.assignedAt || homework.updatedAt,
      },
      ...(homework.attempts || []).map((attempt) => ({
        id: `attempt-${attempt.id}`,
        title: 'Ученик отправил работу',
        subtitle: `${homework.title} · ${formatDateTimeLabel(attempt.submittedAt)}`,
        tone: 'amber',
        createdAt: attempt.submittedAt,
      })),
    ]);

  const progress = (getStudentById(data, studentId)?.progressByTask || [])
    .flatMap((task) => (task.history || []).map((event) => ({
      id: `progress-${task.taskNumber}-${event.id || event.createdAt}`,
      title: `Прогресс: задание ${task.taskNumber}`,
      subtitle: `${getTaskTitle(task.taskNumber)} · ${progressCoverageLabel(event.coverageStatus)}${event.masteryLevel ? ` · ${progressMasteryLabel(event.masteryLevel)}` : ''}`,
      tone: event.masteryLevel === 'weak' ? 'red' : event.coverageStatus === 'assessment_needed' ? 'amber' : 'blue',
      createdAt: event.createdAt,
    })));

  return sortByCreatedAtDesc([...lessons, ...homeworks, ...progress]).slice(0, 30);
}

export function taskTitleList(taskNumbers = []) {
  return taskNumbers.map((taskNumber) => {
    const task = TASKS.find((item) => item.n === Number(taskNumber));
    return task ? `${task.n}. ${task.title}` : `Задание ${taskNumber}`;
  });
}
