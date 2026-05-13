/*
 * OGE Tutor App — frontend/backend contract values.
 * Internal values are stable backend-facing codes; Russian labels are presentation-only.
 */
import { PROGRESS_COVERAGE_STATUS, PROGRESS_LEVEL, PROGRESS_MASTERY_LEVEL, PROGRESS_SOURCE } from '../shared/progressContracts.js';

export { PROGRESS_COVERAGE_STATUS, PROGRESS_LEVEL, PROGRESS_MASTERY_LEVEL, PROGRESS_SOURCE };

export const ROLE = Object.freeze({
  TEACHER: 'teacher',
  STUDENT: 'student',
});

export const ACCESS_STATUS = Object.freeze({
  ACTIVE: 'active',
  INVITE_SENT: 'invite_sent',
  PASSWORD_PENDING: 'password_pending',
  DISABLED: 'disabled',
});

export const STUDENT_ACCESS_ACTION = Object.freeze({
  RESEND_INVITE: 'resend_invite',
  RESET_PASSWORD: 'reset_password',
  DISABLE: 'disable',
  ENABLE: 'enable',
});

export const LESSON_STATUS = Object.freeze({
  PLANNED: 'planned',
  RESCHEDULED: 'rescheduled',
  COMPLETED: 'completed',
  CANCELED: 'canceled',
});

export const LESSON_SOURCE = Object.freeze({
  MANUAL: 'manual',
  TEMPLATE: 'template',
  IMPORT: 'import',
});

export const HOMEWORK_STATUS = Object.freeze({
  ASSIGNED: 'assigned',
  SUBMITTED: 'submitted',
  NEEDS_REVISION: 'needs_revision',
  REVIEWED: 'reviewed',
  OVERDUE: 'overdue',
});

export const HOMEWORK_REVIEW_ACTION = Object.freeze({
  APPROVE: 'approve',
  REQUEST_REVISION: 'request_revision',
});

export const SUBMISSION_STATUS = Object.freeze({
  SUBMITTED: 'submitted',
  REVIEWED: 'reviewed',
  NEEDS_REVISION: 'needs_revision',
});

export const MATERIAL_TYPE = Object.freeze({
  FILE: 'file',
  LINK: 'link',
  LIBRARY: 'library',
});

export const MATERIAL_SOURCE = Object.freeze({
  UPLOAD: 'upload',
  LINK: 'link',
  LIBRARY: 'library',
});

export const FILE_UPLOAD_STATUS = Object.freeze({
  PENDING: 'pending',
  UPLOADED: 'uploaded',
  FAILED: 'failed',
});


export const NOTIFICATION_TYPE = Object.freeze({
  PROGRESS_ASSESSMENT_REQUIRED: 'progress_assessment_required',
});

export const NOTIFICATION_STATUS = Object.freeze({
  UNREAD: 'unread',
  READ: 'read',
  RESOLVED: 'resolved',
});

export const IMPORT_STATUS = Object.freeze({
  DRAFT: 'draft',
  VALIDATING: 'validating',
  VALID: 'valid',
  FAILED: 'failed',
  COMMITTED: 'committed',
});

export const ACCOUNT_SETTING_SCOPE = Object.freeze({
  VISUAL_PROFILE: 'visual_profile',
  ACCOUNT: 'account',
  SECURITY: 'security',
  NOTIFICATIONS: 'notifications',
});

export const TEACHER_ROUTE = Object.freeze({
  HOME: 'teacher.home',
  STUDENTS: 'teacher.students',
  LESSONS: 'teacher.lessons',
  HOMEWORK: 'teacher.homework',
  MATERIALS: 'teacher.materials',
  PROFILE: 'teacher.profile',
});

export const STUDENT_ROUTE = Object.freeze({
  HOME: 'student.home',
  HOMEWORK: 'student.homework',
  LESSONS: 'student.lessons',
  MATERIALS: 'student.materials',
  PROGRESS: 'student.progress',
  PROFILE: 'student.profile',
});

export const TEACHER_ROUTE_LABELS = Object.freeze({
  [TEACHER_ROUTE.HOME]: 'Главная',
  [TEACHER_ROUTE.STUDENTS]: 'Ученики',
  [TEACHER_ROUTE.LESSONS]: 'Уроки',
  [TEACHER_ROUTE.HOMEWORK]: 'ДЗ',
  [TEACHER_ROUTE.MATERIALS]: 'Материалы',
  [TEACHER_ROUTE.PROFILE]: 'Профиль',
});

export const STUDENT_ROUTE_LABELS = Object.freeze({
  [STUDENT_ROUTE.HOME]: 'Главная',
  [STUDENT_ROUTE.HOMEWORK]: 'ДЗ',
  [STUDENT_ROUTE.LESSONS]: 'Уроки',
  [STUDENT_ROUTE.MATERIALS]: 'Материалы',
  [STUDENT_ROUTE.PROGRESS]: 'Прогресс',
  [STUDENT_ROUTE.PROFILE]: 'Профиль',
});

export const HOMEWORK_STATUS_LABELS = Object.freeze({
  [HOMEWORK_STATUS.ASSIGNED]: 'Назначено',
  [HOMEWORK_STATUS.SUBMITTED]: 'Сдано',
  [HOMEWORK_STATUS.NEEDS_REVISION]: 'На доработке',
  [HOMEWORK_STATUS.REVIEWED]: 'Проверено',
  [HOMEWORK_STATUS.OVERDUE]: 'Просрочено',
});

export const LESSON_STATUS_LABELS = Object.freeze({
  [LESSON_STATUS.PLANNED]: 'Запланирован',
  [LESSON_STATUS.RESCHEDULED]: 'Перенесён',
  [LESSON_STATUS.COMPLETED]: 'Проведён',
  [LESSON_STATUS.CANCELED]: 'Отменён',
});

export const ACCESS_STATUS_LABELS = Object.freeze({
  [ACCESS_STATUS.ACTIVE]: 'Активен',
  [ACCESS_STATUS.INVITE_SENT]: 'Письмо отправлено',
  [ACCESS_STATUS.PASSWORD_PENDING]: 'Ожидает пароль',
  [ACCESS_STATUS.DISABLED]: 'Отключён',
});

export const MATERIAL_TYPE_LABELS = Object.freeze({
  [MATERIAL_TYPE.FILE]: 'файл',
  [MATERIAL_TYPE.LINK]: 'ссылка',
  [MATERIAL_TYPE.LIBRARY]: 'из библиотеки',
});

function isKnownValue(map, value) {
  return Object.values(map).includes(value);
}

export function normalizeHomeworkStatus(status) {
  return isKnownValue(HOMEWORK_STATUS, status) ? status : '';
}

export function normalizeLessonStatus(status) {
  return isKnownValue(LESSON_STATUS, status) ? status : '';
}

export function normalizeAccessStatus(status) {
  return isKnownValue(ACCESS_STATUS, status) ? status : '';
}

export function normalizeMaterialType(type) {
  return isKnownValue(MATERIAL_TYPE, type) ? type : '';
}

export function statusLabel(status) {
  if (!status) return '—';
  const normalizedHomework = normalizeHomeworkStatus(status);
  if (HOMEWORK_STATUS_LABELS[normalizedHomework]) return HOMEWORK_STATUS_LABELS[normalizedHomework];

  const normalizedLesson = normalizeLessonStatus(status);
  if (LESSON_STATUS_LABELS[normalizedLesson]) return LESSON_STATUS_LABELS[normalizedLesson];

  const normalizedAccess = normalizeAccessStatus(status);
  if (ACCESS_STATUS_LABELS[normalizedAccess]) return ACCESS_STATUS_LABELS[normalizedAccess];

  return status || '—';
}

export function materialTypeLabel(type) {
  return MATERIAL_TYPE_LABELS[normalizeMaterialType(type)] || MATERIAL_TYPE_LABELS[MATERIAL_TYPE.FILE];
}

export function statusTone(status) {
  const normalizedHomework = normalizeHomeworkStatus(status);
  if ([HOMEWORK_STATUS.REVIEWED].includes(normalizedHomework)) return 'green';
  if ([HOMEWORK_STATUS.OVERDUE, HOMEWORK_STATUS.NEEDS_REVISION].includes(normalizedHomework)) return 'red';
  if ([HOMEWORK_STATUS.SUBMITTED, HOMEWORK_STATUS.ASSIGNED].includes(normalizedHomework)) return 'amber';

  const normalizedLesson = normalizeLessonStatus(status);
  if ([LESSON_STATUS.COMPLETED].includes(normalizedLesson)) return 'green';
  if ([LESSON_STATUS.CANCELED].includes(normalizedLesson)) return 'red';
  if ([LESSON_STATUS.RESCHEDULED].includes(normalizedLesson)) return 'amber';
  if ([LESSON_STATUS.PLANNED].includes(normalizedLesson)) return 'violet';

  const normalizedAccess = normalizeAccessStatus(status);
  if (normalizedAccess === ACCESS_STATUS.ACTIVE) return 'green';
  if (normalizedAccess === ACCESS_STATUS.DISABLED) return 'red';
  if ([ACCESS_STATUS.INVITE_SENT, ACCESS_STATUS.PASSWORD_PENDING].includes(normalizedAccess)) return 'amber';

  return 'violet';
}

export function statusIcon(status) {
  const normalizedHomework = normalizeHomeworkStatus(status);
  if (normalizedHomework === HOMEWORK_STATUS.REVIEWED) return '✓';
  if (normalizedHomework === HOMEWORK_STATUS.SUBMITTED) return '📤';
  if (normalizedHomework === HOMEWORK_STATUS.OVERDUE) return '!';
  if (normalizedHomework === HOMEWORK_STATUS.NEEDS_REVISION) return '↻';

  const normalizedLesson = normalizeLessonStatus(status);
  if (normalizedLesson === LESSON_STATUS.COMPLETED) return '✓';
  if (normalizedLesson === LESSON_STATUS.CANCELED) return '×';
  if (normalizedLesson === LESSON_STATUS.RESCHEDULED) return '↻';

  return '📝';
}
