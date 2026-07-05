/*
 * OGE Tutor App — mock backend adapter.
 * It is the only place that uses browser storage in dev mode. UI code talks to the same async API that a real backend will expose.
 */
import { DEMO_PASSWORD, INITIAL_DATA } from '../../mock/seed.js';
import { buildFileMaterial, buildLinkMaterial, isSameMaterial, normalizeText, topicTitleFromTasks } from '../../shared/formatters.js';
import { appTimezone, buildLessonSchedule, endOfLocalDayIso, minutesBetween, nowIso, normalizeIsoDateTime } from '../../shared/dateTime.js';
import { markTasksAssessmentNeeded, normalizeStudentProgressPayload, updateTaskProgressEntry } from '../../domain/progress/index.js';
import {
  ACCESS_STATUS,
  HOMEWORK_STATUS,
  LESSON_SOURCE,
  LESSON_STATUS,
  NOTIFICATION_STATUS,
  NOTIFICATION_TYPE,
  MATERIAL_SOURCE,
  MATERIAL_TYPE,
  ROLE,
  STUDENT_ACCESS_ACTION,
  SUBMISSION_STATUS,
  normalizeAccessStatus,
  normalizeHomeworkStatus,
  normalizeLessonStatus,
  normalizeMaterialType,
} from '../contracts.js';
import { ApiError } from '../apiError.js';
import { mapDataDto } from '../dto.js';
import { TASKS } from '../../domain/tasks/index.js';

const DB_KEY = 'oge-tutor-mock-backend-v7';
const SESSION_KEY = 'oge-tutor-session-v6';
const DB_VERSION = 7;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const KNOWN_TASK_NUMBERS = new Set(TASKS.map((task) => task.n));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function storage() {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

function sessionStorageSafe() {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage;
}

function normalizeEmail(email) {
  return normalizeText(email).toLowerCase();
}

function apiError(message, code = 'api_error', status = 400, extra = {}) {
  return new ApiError(message, code, {
    status,
    code,
    message,
    fieldErrors: extra.fieldErrors || {},
    requestId: extra.requestId || '',
    ...extra,
  });
}

function createId(prefix) {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${id}`;
}

function isBrowserFile(value) {
  return typeof File !== 'undefined' && value instanceof File;
}

function safeFileName(value) {
  return normalizeText(value) || 'file.bin';
}

function makeFileResource(fileLike, fallbackName = 'file.bin') {
  const id = fileLike?.id || fileLike?.fileId || createId('file');
  const originalName = safeFileName(fileLike?.originalName || fileLike?.name || fileLike?.fileName || fileLike?.title || fallbackName);
  return {
    id,
    originalName,
    fileName: originalName,
    mimeType: fileLike?.mimeType || fileLike?.type || 'application/octet-stream',
    size: Number(fileLike?.size || 0),
    url: fileLike?.url || `/mock-files/${id}/${encodeURIComponent(originalName)}`,
    uploadedAt: normalizeIsoDateTime(fileLike?.uploadedAt) || nowIso(),
  };
}

function normalizeFileAttachment(item) {
  const fileResource = makeFileResource(item?.fileResource || item?.file || item, item?.title || item?.fileName);
  return {
    id: item.id || createId('attm'),
    type: MATERIAL_TYPE.FILE,
    source: item.source || MATERIAL_SOURCE.UPLOAD,
    title: safeFileName(item.title || item.fileName || item.originalName || fileResource.originalName),
    fileName: safeFileName(item.fileName || item.title || fileResource.originalName),
    originalName: fileResource.originalName,
    fileId: fileResource.id,
    mimeType: fileResource.mimeType,
    size: fileResource.size,
    url: fileResource.url,
    uploadedAt: fileResource.uploadedAt,
  };
}

function normalizeAttachment(item) {
  if (!item) return null;
  const type = normalizeMaterialType(item.type);

  if (type === MATERIAL_TYPE.LINK) {
    const built = item.url ? buildLinkMaterial(item.url) : item;
    return {
      ...built,
      ...item,
      id: item.id || createId('attm'),
      type: MATERIAL_TYPE.LINK,
      source: MATERIAL_SOURCE.LINK,
      title: normalizeText(item.title || built.title || item.url) || 'Ссылка',
    };
  }

  if (type === MATERIAL_TYPE.LIBRARY) {
    return {
      ...item,
      id: item.id || createId('attm'),
      type: MATERIAL_TYPE.LIBRARY,
      source: MATERIAL_SOURCE.LIBRARY,
      title: normalizeText(item.title || item.fileName) || 'Материал из библиотеки',
      taskNumber: Number(item.taskNumber) || undefined,
    };
  }

  if (!isBrowserFile(item.file) && !item.fileId && !item.url && !item.fileResource?.id) {
    throw apiError('Файловое вложение должно содержать реальный файл или fileId.', 'validation_error', 422, { fieldErrors: { attachments: 'file_required' } });
  }

  return normalizeFileAttachment(item);
}

function normalizeMaterialFile(file) {
  return normalizeAttachment({ ...file, type: normalizeMaterialType(file?.type || MATERIAL_TYPE.FILE) });
}

function fallbackIsoFromLegacy(date, time = '00:00') {
  if (!date) return '';
  const months = {
    января: '01', февраль: '02', февраля: '02', марта: '03', апрель: '04', апреля: '04', мая: '05', июнь: '06', июня: '06', июля: '07', август: '08', августа: '08', сентября: '09', октября: '10', ноября: '11', декабря: '12',
  };
  const cleanDate = normalizeText(date).replace(/^сдано\s+/i, '');
  const match = cleanDate.match(/^(\d{1,2})\s+([А-Яа-яёЁ]+)$/);
  if (!match) return normalizeIsoDateTime(date);
  const day = match[1].padStart(2, '0');
  const month = months[match[2].toLowerCase()];
  if (!month) return '';
  const [hour = '00', minute = '00'] = String(time || '00:00').split(':');
  return new Date(`2026-${month}-${day}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00`).toISOString();
}

function normalizeLesson(lesson) {
  const startAt = normalizeIsoDateTime(lesson.startAt) || fallbackIsoFromLegacy(lesson.date, lesson.time);
  const endAt = normalizeIsoDateTime(lesson.endAt) || (startAt ? new Date(Date.parse(startAt) + Number(lesson.durationMinutes || 60) * 60000).toISOString() : '');
  return {
    ...lesson,
    status: normalizeLessonStatus(lesson.status) || LESSON_STATUS.PLANNED,
    source: lesson.source || LESSON_SOURCE.MANUAL,
    timezone: lesson.timezone || appTimezone(),
    startAt,
    endAt,
    durationMinutes: minutesBetween(startAt, endAt, Number(lesson.durationMinutes || 60)),
    focusTaskNumbers: normalizeTaskNumbers(lesson.focusTaskNumbers),
    completedAt: normalizeIsoDateTime(lesson.completedAt) || '',
    completionComment: normalizeText(lesson.completionComment),
    note: lesson.note || '',
    materials: (lesson.materials || []).map(normalizeAttachment).filter(Boolean),
    createdAt: normalizeIsoDateTime(lesson.createdAt) || nowIso(),
    updatedAt: normalizeIsoDateTime(lesson.updatedAt) || nowIso(),
  };
}

function normalizeHomework(homework) {
  const dueAt = normalizeIsoDateTime(homework.dueAt) || fallbackIsoFromLegacy(homework.deadline, '23:59');
  const submittedAt = normalizeIsoDateTime(homework.submittedAt) || fallbackIsoFromLegacy(homework.submittedAt);
  const reviewedAt = normalizeIsoDateTime(homework.reviewedAt) || fallbackIsoFromLegacy(homework.reviewedAt);
  const closedAt = normalizeIsoDateTime(homework.closedAt) || fallbackIsoFromLegacy(homework.closedAt);

  return {
    ...homework,
    dueAt,
    assignedAt: normalizeIsoDateTime(homework.assignedAt) || nowIso(),
    submittedAt,
    reviewedAt,
    closedAt,
    status: normalizeHomeworkStatus(homework.status) || HOMEWORK_STATUS.ASSIGNED,
    materials: (homework.materials || []).map(normalizeAttachment).filter(Boolean),
    reviewMaterials: (homework.reviewMaterials || []).map(normalizeAttachment).filter(Boolean),
    attempts: (homework.attempts || []).map((attempt) => {
      const fileResource = attempt.fileResource || normalizeFileAttachment({ title: attempt.file, fileName: attempt.file });
      return {
        ...attempt,
        id: attempt.id || createId('attempt'),
        file: safeFileName(attempt.file || fileResource.originalName || fileResource.title),
        fileResource,
        submittedAt: normalizeIsoDateTime(attempt.submittedAt) || fallbackIsoFromLegacy(attempt.submittedAt) || nowIso(),
        reviewedAt: normalizeIsoDateTime(attempt.reviewedAt) || fallbackIsoFromLegacy(attempt.reviewedAt),
        reviewStatus: normalizeHomeworkStatus(attempt.reviewStatus) === HOMEWORK_STATUS.ASSIGNED ? SUBMISSION_STATUS.SUBMITTED : normalizeHomeworkStatus(attempt.reviewStatus) || SUBMISSION_STATUS.SUBMITTED,
      };
    }),
    createdAt: normalizeIsoDateTime(homework.createdAt) || nowIso(),
    updatedAt: normalizeIsoDateTime(homework.updatedAt) || nowIso(),
  };
}


function normalizeStudent(student) {
  const normalizedProgress = normalizeStudentProgressPayload({
    progressByTask: student.progressByTask,
    weak: student.weak,
  });

  return {
    ...student,
    role: ROLE.STUDENT,
    access: normalizeAccessStatus(student.access) || ACCESS_STATUS.INVITE_SENT,
    ...normalizedProgress,
    createdAt: normalizeIsoDateTime(student.createdAt) || nowIso(),
    updatedAt: normalizeIsoDateTime(student.updatedAt) || nowIso(),
  };
}

function normalizeSeedData() {
  const data = clone(INITIAL_DATA);

  return {
    teacher: {
      ...data.teacher,
      role: ROLE.TEACHER,
      createdAt: normalizeIsoDateTime(data.teacher.createdAt) || nowIso(),
      updatedAt: normalizeIsoDateTime(data.teacher.updatedAt) || nowIso(),
    },
    students: data.students.map(normalizeStudent),
    lessons: data.lessons.map(normalizeLesson),
    materials: data.materials.map((topic) => ({
      ...topic,
      files: (topic.files || []).map(normalizeMaterialFile),
    })),
    homeworks: data.homeworks.map(normalizeHomework),
    notifications: (data.notifications || []).map(normalizeNotification),
  };
}

function seedDb() {
  const data = normalizeSeedData();
  const credentials = {
    [normalizeEmail(data.teacher.email)]: DEMO_PASSWORD,
  };

  data.students.forEach((student) => {
    credentials[normalizeEmail(student.email)] = DEMO_PASSWORD;
  });

  return {
    version: DB_VERSION,
    data,
    credentials,
  };
}

function readDb() {
  const store = storage();
  if (!store) return seedDb();

  try {
    const raw = store.getItem(DB_KEY);
    if (!raw) {
      const db = seedDb();
      writeDb(db);
      return db;
    }
    const parsed = JSON.parse(raw);
    if (parsed?.version === DB_VERSION && parsed?.data) return parsed;
  } catch {
    // Fall through to reseed corrupted mock storage.
  }

  const db = seedDb();
  writeDb(db);
  return db;
}

function writeDb(db) {
  const store = storage();
  if (store) store.setItem(DB_KEY, JSON.stringify(db));
}

function readSession() {
  const store = sessionStorageSafe();
  if (!store) return null;
  try {
    return JSON.parse(store.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeSession(session) {
  const store = sessionStorageSafe();
  if (!store) return;
  if (session) store.setItem(SESSION_KEY, JSON.stringify(session));
  else store.removeItem(SESSION_KEY);
}

function publicTeacherProfile(teacher) {
  return {
    id: teacher.id,
    role: ROLE.TEACHER,
    name: teacher.name,
    avatar: teacher.avatar,
    bg: teacher.bg,
    settings: {},
    createdAt: teacher.createdAt,
    updatedAt: teacher.updatedAt,
  };
}

function taskNumbersForStudent(student, lessons, homeworks) {
  const fromProgress = (student.progressByTask || [])
    .filter((item) => item.coverageStatus && item.coverageStatus !== 'not_started')
    .map((item) => item.taskNumber);
  const fromLessons = lessons.flatMap((lesson) => lesson.focusTaskNumbers || []);
  const fromHomeworks = homeworks.flatMap((homework) => homework.taskNumbers || []);
  return new Set([...fromProgress, ...fromLessons, ...fromHomeworks].map(Number).filter((item) => Number.isInteger(item)));
}

function scopedData(db, session) {
  if (!session?.id || !session?.role || !userExists(db, session)) return null;

  if (session.role === ROLE.TEACHER) return mapDataDto(clone(db.data));

  const student = db.data.students.find((item) => item.id === session.id && item.access !== ACCESS_STATUS.DISABLED);
  if (!student) return null;

  const lessons = db.data.lessons.filter((lesson) => lesson.studentId === student.id);
  const homeworks = db.data.homeworks.filter((homework) => homework.studentId === student.id);
  const allowedTasks = taskNumbersForStudent(student, lessons, homeworks);
  const materials = db.data.materials.filter((topic) => allowedTasks.has(Number(topic.taskNumber)));

  return mapDataDto({
    teacher: publicTeacherProfile(db.data.teacher),
    students: [student],
    lessons,
    homeworks,
    materials,
    notifications: [],
  });
}

function findUser(db, email) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail) return null;
  if (normalizeEmail(db.data.teacher.email) === cleanEmail) return { ...db.data.teacher, role: ROLE.TEACHER };
  const student = db.data.students.find((item) => normalizeEmail(item.email) === cleanEmail);
  return student ? { ...student, role: ROLE.STUDENT } : null;
}

function userExists(db, session) {
  if (!session?.id || !session?.role) return false;
  if (session.role === ROLE.TEACHER) return db.data.teacher.id === session.id;
  return db.data.students.some((student) => student.id === session.id && student.access !== ACCESS_STATUS.DISABLED);
}

function mutate(mutator) {
  const db = readDb();
  const session = readSession();
  if (!userExists(db, session)) {
    writeSession(null);
    throw apiError('Сессия истекла. Войдите заново.', 'unauthorized', 401);
  }

  const result = mutator(db, session) || {};
  writeDb(db);
  return Promise.resolve({ data: scopedData(db, session), ...result });
}

function requireTeacherSession(session) {
  if (session?.role !== ROLE.TEACHER) throw apiError('Недостаточно прав для этого действия.', 'forbidden', 403);
}

function requireStudentOwnerOrTeacher(session, studentId) {
  if (session?.role === ROLE.TEACHER) return;
  if (session?.role === ROLE.STUDENT && session.id === studentId) return;
  throw apiError('Недостаточно прав для данных ученика.', 'forbidden', 403);
}

function requireHomeworkAccess(session, homework, { submit = false } = {}) {
  if (session?.role === ROLE.TEACHER && !submit) return;
  if (session?.role === ROLE.STUDENT && session.id === homework.studentId) return;
  throw apiError('Недостаточно прав для домашней работы.', 'forbidden', 403);
}

function requireLessonTeacher(session) {
  requireTeacherSession(session);
}

function requireHomework(db, id) {
  const homework = db.data.homeworks.find((item) => item.id === id);
  if (!homework) throw apiError('Домашняя работа не найдена.', 'not_found', 404);
  return homework;
}

function requireLesson(db, id) {
  const lesson = db.data.lessons.find((item) => item.id === id);
  if (!lesson) throw apiError('Урок не найден.', 'not_found', 404);
  return lesson;
}

function requireStudent(db, id) {
  const student = db.data.students.find((item) => item.id === id);
  if (!student) throw apiError('Ученик не найден.', 'not_found', 404);
  return student;
}

function validateEmailIsFree(db, email, currentId = null) {
  const cleanEmail = normalizeEmail(email);
  const sameTeacher = normalizeEmail(db.data.teacher.email) === cleanEmail && db.data.teacher.id !== currentId;
  const sameStudent = db.data.students.some((student) => normalizeEmail(student.email) === cleanEmail && student.id !== currentId);
  if (sameTeacher || sameStudent) throw apiError('Такой email уже используется.', 'email_exists', 409);
}

function updateCredentialsEmail(db, entity, nextEmail) {
  const currentEmail = normalizeEmail(entity.email);
  const cleanNextEmail = normalizeEmail(nextEmail);
  if (!cleanNextEmail || currentEmail === cleanNextEmail) return;
  validateEmailIsFree(db, cleanNextEmail, entity.id);
  if (db.credentials[currentEmail]) db.credentials[cleanNextEmail] = db.credentials[currentEmail];
  delete db.credentials[currentEmail];
  entity.email = cleanNextEmail;
}

function changePasswordForEntity(db, entity, currentPassword, newPassword) {
  const cleanEmail = normalizeEmail(entity.email);
  if (db.credentials[cleanEmail] !== currentPassword) {
    throw apiError('Текущий пароль указан неверно.', 'invalid_password', 422);
  }
  if (!newPassword || String(newPassword).length < 6) {
    throw apiError('Новый пароль должен быть не короче 6 символов.', 'validation_error', 422);
  }
  db.credentials[cleanEmail] = String(newPassword);
}

function applyProfilePatch(entity, patch) {
  const allowed = ['name', 'avatar', 'bg', 'note', 'grade', 'goal'];
  allowed.forEach((key) => {
    if (patch[key] !== undefined) entity[key] = typeof patch[key] === 'string' ? normalizeText(patch[key]) : patch[key];
  });
  entity.updatedAt = nowIso();
}

function applyNotificationsPatch(entity, notifications) {
  entity.settings = {
    ...(entity.settings || {}),
    notifications: notifications || {},
  };
  entity.updatedAt = nowIso();
}

function buildMaterialFromPayload(payload) {
  if (payload.type === MATERIAL_TYPE.LINK) return normalizeMaterialFile(buildLinkMaterial(payload.url || payload.link));

  const file = payload.file || payload.item?.file;
  if (isBrowserFile(file)) return normalizeMaterialFile({ ...(payload.item || buildFileMaterial(file.name, file)), file });
  if (payload.fileId || payload.item?.fileId || payload.item?.url) {
    return normalizeMaterialFile({ ...(payload.item || {}), fileId: payload.fileId || payload.item?.fileId, type: MATERIAL_TYPE.FILE, source: MATERIAL_SOURCE.UPLOAD });
  }

  throw apiError('Выберите реальный файл материала.', 'validation_error', 422, { fieldErrors: { file: 'required' } });
}

function normalizeLessonPayload(payload) {
  const startAt = normalizeIsoDateTime(payload.startAt) || buildLessonSchedule(payload).startAt;
  const durationMinutes = Number(payload.durationMinutes || minutesBetween(startAt, payload.endAt, 60)) || 60;
  const endAt = normalizeIsoDateTime(payload.endAt) || (startAt ? new Date(Date.parse(startAt) + durationMinutes * 60000).toISOString() : '');
  return {
    startAt,
    endAt,
    durationMinutes,
    timezone: payload.timezone || appTimezone(),
  };
}

function normalizeHomeworkDueAt(payload) {
  return normalizeIsoDateTime(payload.dueAt) || endOfLocalDayIso(payload.deadline) || normalizeIsoDateTime(payload.deadline);
}

function normalizeTaskNumbers(value) {
  const items = Array.isArray(value) ? value : String(value || '').split(/[,;\s]+/);
  return [...new Set(items.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 25 && KNOWN_TASK_NUMBERS.has(n)))];
}

function validateTaskNumbers(value, { required = true } = {}) {
  const rawItems = Array.isArray(value) ? value : String(value || '').split(/[,;\s]+/).filter(Boolean);
  const invalid = [];
  const outOfRange = [];
  const unknown = [];
  const duplicates = [];
  const taskNumbers = [];

  rawItems.forEach((item) => {
    if (!/^\d+$/.test(String(item).trim())) {
      invalid.push(item);
      return;
    }
    const taskNumber = Number(item);
    if (taskNumber < 1 || taskNumber > 25) {
      outOfRange.push(taskNumber);
      return;
    }
    if (!KNOWN_TASK_NUMBERS.has(taskNumber)) {
      unknown.push(taskNumber);
      return;
    }
    if (taskNumbers.includes(taskNumber)) duplicates.push(taskNumber);
    else taskNumbers.push(taskNumber);
  });

  if (invalid.length) throw apiError(`Некорректные номера заданий: ${invalid.join(', ')}.`, 'validation_error', 422);
  if (outOfRange.length) throw apiError(`Номера заданий должны быть от 1 до 25: ${outOfRange.join(', ')}.`, 'validation_error', 422);
  if (unknown.length) throw apiError(`Неизвестные номера заданий: ${unknown.join(', ')}.`, 'validation_error', 422);
  if (duplicates.length) throw apiError(`Повторяются номера заданий: ${duplicates.join(', ')}.`, 'validation_error', 422);
  if (required && !taskNumbers.length) throw apiError('Укажите хотя бы один номер задания.', 'validation_error', 422);
  return taskNumbers;
}

function validateEmailFormat(email) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail || !EMAIL_PATTERN.test(cleanEmail)) throw apiError('Введите корректный email.', 'validation_error', 422);
  return cleanEmail;
}

function validateFutureIso(value, message) {
  const iso = normalizeIsoDateTime(value);
  if (!iso) throw apiError('Укажите корректную дату.', 'validation_error', 422);
  if (Date.parse(iso) < Date.now()) throw apiError(message || 'Дата не может быть в прошлом.', 'validation_error', 422);
  return iso;
}

function hasLessonConflict(db, candidate, excludeLessonId = '') {
  const candidateStart = Date.parse(candidate.startAt);
  const candidateEnd = Date.parse(candidate.endAt);
  if (!Number.isFinite(candidateStart) || !Number.isFinite(candidateEnd) || candidateEnd <= candidateStart) return false;
  return db.data.lessons.some((lesson) => {
    if (lesson.id === excludeLessonId || lesson.studentId !== candidate.studentId) return false;
    if ([LESSON_STATUS.CANCELED].includes(lesson.status)) return false;
    const start = Date.parse(lesson.startAt);
    const end = Date.parse(lesson.endAt);
    return Number.isFinite(start) && Number.isFinite(end) && start < candidateEnd && end > candidateStart;
  });
}

function validateLessonSchedule(db, schedule, studentId, excludeLessonId = '', { allowPast = false } = {}) {
  if (!schedule.startAt || !schedule.endAt || Date.parse(schedule.endAt) <= Date.parse(schedule.startAt)) {
    throw apiError('Проверьте дату, время и длительность урока.', 'validation_error', 422);
  }
  if (!allowPast) validateFutureIso(schedule.startAt, 'Нельзя запланировать урок в прошлом.');
  if (hasLessonConflict(db, { ...schedule, studentId }, excludeLessonId)) {
    throw apiError('У этого ученика уже есть урок на пересекающееся время.', 'lesson_conflict', 409);
  }
}

function normalizeNotification(notification) {
  return {
    id: notification.id || createId('ntf'),
    type: notification.type || NOTIFICATION_TYPE.PROGRESS_ASSESSMENT_REQUIRED,
    status: notification.status || NOTIFICATION_STATUS.UNREAD,
    teacherId: notification.teacherId || '',
    studentId: notification.studentId || '',
    taskNumber: Number(notification.taskNumber) || null,
    lessonId: notification.lessonId || '',
    title: normalizeText(notification.title),
    message: normalizeText(notification.message),
    createdAt: normalizeIsoDateTime(notification.createdAt) || nowIso(),
    resolvedAt: normalizeIsoDateTime(notification.resolvedAt) || '',
  };
}

function createProgressAssessmentNotification(db, { student, lesson, taskNumber, createdAt }) {
  const title = `Оцените освоение задания ${taskNumber}`;
  const message = `После занятия по заданию ${taskNumber} нужно выставить уровень освоения для ${student.name}.`;
  const exists = (db.data.notifications || []).some((item) => (
    item.type === NOTIFICATION_TYPE.PROGRESS_ASSESSMENT_REQUIRED
    && item.status !== NOTIFICATION_STATUS.RESOLVED
    && item.studentId === student.id
    && item.taskNumber === taskNumber
    && item.lessonId === lesson.id
  ));
  if (exists) return;
  db.data.notifications = [{
    id: createId('ntf'),
    type: NOTIFICATION_TYPE.PROGRESS_ASSESSMENT_REQUIRED,
    status: NOTIFICATION_STATUS.UNREAD,
    teacherId: db.data.teacher.id,
    studentId: student.id,
    taskNumber,
    lessonId: lesson.id,
    title,
    message,
    createdAt,
    resolvedAt: '',
  }, ...(db.data.notifications || [])];
}

function resolveProgressAssessmentNotifications(db, studentId, taskNumber) {
  const resolvedAt = nowIso();
  db.data.notifications = (db.data.notifications || []).map((item) => (
    item.type === NOTIFICATION_TYPE.PROGRESS_ASSESSMENT_REQUIRED
    && item.studentId === studentId
    && Number(item.taskNumber) === Number(taskNumber)
    && item.status !== NOTIFICATION_STATUS.RESOLVED
  ) ? { ...item, status: NOTIFICATION_STATUS.RESOLVED, resolvedAt } : item);
}

function completeLessonDomain(db, lessonId, payload = {}) {
  const lesson = requireLesson(db, lessonId);
  const student = requireStudent(db, lesson.studentId);
  if (lesson.status === LESSON_STATUS.COMPLETED) throw apiError('Урок уже отмечен как проведённый.', 'invalid_status', 409);
  if (lesson.status === LESSON_STATUS.CANCELED) throw apiError('Отменённый урок нельзя провести.', 'invalid_status', 409);

  const completedAt = nowIso();
  const focusTaskNumbers = validateTaskNumbers(payload.focusTaskNumbers || lesson.focusTaskNumbers, { required: true });
  const completionComment = normalizeText(payload.completionComment ?? lesson.completionComment ?? '');
  Object.assign(lesson, {
    status: LESSON_STATUS.COMPLETED,
    completedAt,
    completionComment,
    focusTaskNumbers,
    updatedAt: completedAt,
  });

  if (focusTaskNumbers.length) {
    student.progressByTask = markTasksAssessmentNeeded(student.progressByTask, focusTaskNumbers, lesson, completionComment);
    Object.assign(student, normalizeStudentProgressPayload({ progressByTask: student.progressByTask }), { updatedAt: completedAt });
    focusTaskNumbers.forEach((taskNumber) => createProgressAssessmentNotification(db, { student, lesson, taskNumber, createdAt: completedAt }));
  }
}

export function createMockBackend() {
  return {
    async bootstrap() {
      const db = readDb();
      const session = readSession();
      const validSession = userExists(db, session) ? session : null;
      if (!validSession) writeSession(null);
      return { data: scopedData(db, validSession), session: validSession };
    },

    async login({ email, password }) {
      const db = readDb();
      const user = findUser(db, email);
      const cleanEmail = normalizeEmail(email);

      if (!user || user.access === ACCESS_STATUS.DISABLED || !password || db.credentials[cleanEmail] !== password) {
        throw apiError('Неверный email или пароль.', 'auth_failed', 401);
      }

      const session = { id: user.id, role: user.role, email: user.email, token: `mock-token-${user.id}` };
      writeSession(session);
      return { data: scopedData(db, session), session };
    },

    async logout() {
      writeSession(null);
      return { session: null };
    },

    async requestPasswordReset({ email }) {
      const db = readDb();
      const user = findUser(db, email);
      if (!user) throw apiError('Аккаунт с таким email не найден.', 'not_found', 404);
      return { ok: true };
    },

    async verifyAccessToken({ token }) {
      if (!normalizeText(token)) throw apiError('Ссылка недействительна.', 'validation_error', 422, { fieldErrors: { token: 'invalid' } });
      return { valid: true, type: 'password_reset', account: { email: 'd***o@example.test', name: 'Demo' } };
    },

    async completeAccessToken({ token, password }) {
      if (!normalizeText(token)) throw apiError('Ссылка недействительна.', 'validation_error', 422, { fieldErrors: { token: 'invalid' } });
      if (!password || String(password).length < 6) throw apiError('Пароль должен быть не короче 6 символов.', 'validation_error', 422, { fieldErrors: { password: 'min_length_6' } });
      return { ok: true };
    },

    updateTeacherProfile(patch) {
      return mutate((db, session) => {
        requireTeacherSession(session);
        applyProfilePatch(db.data.teacher, patch);
      });
    },

    updateTeacherAccount({ email }) {
      return mutate((db, session) => {
        requireTeacherSession(session);
        const cleanEmail = validateEmailFormat(email);
        updateCredentialsEmail(db, db.data.teacher, cleanEmail);
        db.data.teacher.updatedAt = nowIso();
      });
    },

    changeTeacherPassword(payload) {
      return mutate((db, session) => {
        requireTeacherSession(session);
        changePasswordForEntity(db, db.data.teacher, payload.currentPassword, payload.newPassword);
        db.data.teacher.updatedAt = nowIso();
      });
    },

    updateTeacherNotifications({ notifications }) {
      return mutate((db, session) => {
        requireTeacherSession(session);
        applyNotificationsPatch(db.data.teacher, notifications);
      });
    },

    updateStudentProfile(studentId, patch) {
      return mutate((db, session) => {
        requireStudentOwnerOrTeacher(session, studentId);
        const student = requireStudent(db, studentId);
        applyProfilePatch(student, patch);
      });
    },

    updateStudentAccount(studentId, { email }) {
      return mutate((db, session) => {
        requireStudentOwnerOrTeacher(session, studentId);
        const student = requireStudent(db, studentId);
        const cleanEmail = validateEmailFormat(email);
        updateCredentialsEmail(db, student, cleanEmail);
        student.updatedAt = nowIso();
      });
    },

    changeStudentPassword(studentId, payload) {
      return mutate((db, session) => {
        requireStudentOwnerOrTeacher(session, studentId);
        const student = requireStudent(db, studentId);
        changePasswordForEntity(db, student, payload.currentPassword, payload.newPassword);
        student.updatedAt = nowIso();
      });
    },

    updateStudentNotifications(studentId, { notifications }) {
      return mutate((db, session) => {
        requireStudentOwnerOrTeacher(session, studentId);
        const student = requireStudent(db, studentId);
        applyNotificationsPatch(student, notifications);
      });
    },

    createStudent(payload) {
      return mutate((db, session) => {
        requireTeacherSession(session);
        const name = normalizeText(payload.name);
        const email = validateEmailFormat(payload.email);
        if (!name) throw apiError('Укажите имя ученика.', 'validation_error', 422);
        validateEmailIsFree(db, email);

        const now = nowIso();
        const normalizedProgress = normalizeStudentProgressPayload({});
        const student = {
          id: createId('s'),
          teacherId: db.data.teacher.id,
          role: ROLE.STUDENT,
          avatar: 'bear',
          bg: 'blue',
          access: ACCESS_STATUS.INVITE_SENT,
          ...normalizedProgress,
          name,
          email: normalizeEmail(email),
          grade: normalizeText(payload.grade),
          goal: normalizeText(payload.goal),
          note: normalizeText(payload.note),
          settings: payload.settings || {},
          createdAt: now,
          updatedAt: now,
        };
        db.data.students = [student, ...db.data.students];
        db.credentials[normalizeEmail(email)] = DEMO_PASSWORD;
      });
    },

    updateStudentProgress(studentId, payload) {
      return mutate((db, session) => {
        requireTeacherSession(session);
        const student = requireStudent(db, studentId);
        Object.assign(student, normalizeStudentProgressPayload(payload), { updatedAt: nowIso() });
      });
    },

    updateTaskProgress(studentId, taskNumber, payload) {
      return mutate((db, session) => {
        requireTeacherSession(session);
        const student = requireStudent(db, studentId);
        student.progressByTask = updateTaskProgressEntry(student.progressByTask, taskNumber, payload);
        Object.assign(student, normalizeStudentProgressPayload({ progressByTask: student.progressByTask }), { updatedAt: nowIso() });
        resolveProgressAssessmentNotifications(db, studentId, taskNumber);
      });
    },

    resolveProgressAssessment(studentId, taskNumber, payload) {
      return mutate((db, session) => {
        requireTeacherSession(session);
        const student = requireStudent(db, studentId);
        student.progressByTask = updateTaskProgressEntry(student.progressByTask, taskNumber, payload);
        Object.assign(student, normalizeStudentProgressPayload({ progressByTask: student.progressByTask }), { updatedAt: nowIso() });
        resolveProgressAssessmentNotifications(db, studentId, taskNumber);
      });
    },

    updateStudentAccess(studentId, action) {
      return mutate((db, session) => {
        requireTeacherSession(session);
        const student = requireStudent(db, studentId);
        if (action === STUDENT_ACCESS_ACTION.DISABLE) student.access = ACCESS_STATUS.DISABLED;
        if (action === STUDENT_ACCESS_ACTION.ENABLE) student.access = ACCESS_STATUS.ACTIVE;
        if (action === STUDENT_ACCESS_ACTION.RESEND_INVITE) student.access = ACCESS_STATUS.INVITE_SENT;
        if (action === STUDENT_ACCESS_ACTION.RESET_PASSWORD) {
          student.access = ACCESS_STATUS.PASSWORD_PENDING;
          db.credentials[normalizeEmail(student.email)] = DEMO_PASSWORD;
        }
        student.updatedAt = nowIso();
      });
    },

    createLesson(payload) {
      return mutate((db, session) => {
        requireLessonTeacher(session);
        if (!payload.studentId) throw apiError('Выберите ученика.', 'validation_error', 422);
        requireStudent(db, payload.studentId);
        const topic = normalizeText(payload.topic);
        const schedule = normalizeLessonPayload(payload);
        if (!topic) throw apiError('Укажите тему урока.', 'validation_error', 422);
        validateLessonSchedule(db, schedule, payload.studentId);
        const now = nowIso();

        db.data.lessons = [{
          id: createId('l'),
          teacherId: db.data.teacher.id,
          status: LESSON_STATUS.PLANNED,
          source: payload.source || LESSON_SOURCE.MANUAL,
          studentId: payload.studentId,
          ...schedule,
          topic,
          focusTaskNumbers: validateTaskNumbers(payload.focusTaskNumbers, { required: false }),
          note: normalizeText(payload.note),
          materials: (payload.materials || []).map(normalizeAttachment).filter(Boolean),
          createdAt: now,
          updatedAt: now,
        }, ...db.data.lessons];
      });
    },

    updateLesson(lessonId, patch) {
      return mutate((db, session) => {
        requireLessonTeacher(session);
        const lesson = requireLesson(db, lessonId);
        if (patch.studentId) requireStudent(db, patch.studentId);
        const schedulePatch = (patch.startAt || patch.endAt || patch.date || patch.time || patch.durationMinutes)
          ? normalizeLessonPayload({
            startAt: patch.startAt || lesson.startAt,
            endAt: patch.endAt,
            date: patch.date,
            time: patch.time,
            durationMinutes: patch.durationMinutes || lesson.durationMinutes,
            timezone: patch.timezone || lesson.timezone,
          })
          : {};

        if (Object.keys(schedulePatch).length) {
          validateLessonSchedule(db, schedulePatch, patch.studentId || lesson.studentId, lesson.id);
        }

        Object.assign(lesson, {
          ...patch,
          ...schedulePatch,
          status: patch.status ? normalizeLessonStatus(patch.status) : lesson.status,
          source: patch.source || lesson.source || LESSON_SOURCE.MANUAL,
          topic: patch.topic === undefined ? lesson.topic : normalizeText(patch.topic),
          focusTaskNumbers: patch.focusTaskNumbers === undefined ? lesson.focusTaskNumbers || [] : validateTaskNumbers(patch.focusTaskNumbers, { required: false }),
          completedAt: patch.completedAt === undefined ? lesson.completedAt || '' : normalizeIsoDateTime(patch.completedAt),
          completionComment: patch.completionComment === undefined ? lesson.completionComment || '' : normalizeText(patch.completionComment),
          note: patch.note === undefined ? lesson.note : normalizeText(patch.note),
          materials: patch.materials ? patch.materials.map(normalizeAttachment).filter(Boolean) : lesson.materials,
          updatedAt: nowIso(),
        });
      });
    },

    completeLesson(lessonId, payload) {
      return mutate((db, session) => {
        requireLessonTeacher(session);
        completeLessonDomain(db, lessonId, payload);
      });
    },

    createHomework(payload) {
      return mutate((db, session) => {
        requireTeacherSession(session);
        if (!payload.studentId) throw apiError('Выберите ученика.', 'validation_error', 422);
        requireStudent(db, payload.studentId);
        const title = normalizeText(payload.title);
        const taskNumbers = validateTaskNumbers(payload.taskNumbers, { required: true });
        const dueAt = validateFutureIso(normalizeHomeworkDueAt(payload), 'Дедлайн не может быть в прошлом.');
        if (!title) throw apiError('Укажите название домашней работы.', 'validation_error', 422);
        const now = nowIso();

        db.data.homeworks = [{
          id: createId('hw'),
          teacherId: db.data.teacher.id,
          studentId: payload.studentId,
          title,
          taskNumbers,
          topic: topicTitleFromTasks(taskNumbers),
          assignedAt: now,
          dueAt,
          status: HOMEWORK_STATUS.ASSIGNED,
          description: normalizeText(payload.description),
          solutionFile: '',
          submittedAt: '',
          reviewedAt: '',
          closedAt: '',
          attempts: [],
          teacherComment: '',
          reviewMaterials: [],
          materials: (payload.materials || []).map(normalizeAttachment).filter(Boolean),
          createdAt: now,
          updatedAt: now,
        }, ...db.data.homeworks];
      });
    },

    updateHomework(homeworkId, patch) {
      return mutate((db, session) => {
        requireTeacherSession(session);
        const homework = requireHomework(db, homeworkId);
        if ([HOMEWORK_STATUS.SUBMITTED, HOMEWORK_STATUS.REVIEWED].includes(homework.status)) {
          throw apiError('Эту домашнюю работу уже нельзя редактировать.', 'locked_homework', 409);
        }
        if (patch.studentId) requireStudent(db, patch.studentId);
        const taskNumbers = patch.taskNumbers ? validateTaskNumbers(patch.taskNumbers, { required: true }) : homework.taskNumbers;
        const dueAt = patch.dueAt || patch.deadline ? validateFutureIso(normalizeHomeworkDueAt(patch), 'Дедлайн не может быть в прошлом.') : homework.dueAt;
        Object.assign(homework, {
          ...patch,
          taskNumbers,
          topic: topicTitleFromTasks(taskNumbers),
          title: patch.title === undefined ? homework.title : normalizeText(patch.title),
          dueAt,
          description: patch.description === undefined ? homework.description : normalizeText(patch.description),
          materials: patch.materials ? patch.materials.map(normalizeAttachment).filter(Boolean) : homework.materials,
          updatedAt: nowIso(),
        });
      });
    },

    submitHomeworkSolution(homeworkId, payload = {}) {
      return mutate((db, session) => {
        const homework = requireHomework(db, homeworkId);
        requireHomeworkAccess(session, homework, { submit: true });
        if (![HOMEWORK_STATUS.ASSIGNED, HOMEWORK_STATUS.NEEDS_REVISION, HOMEWORK_STATUS.OVERDUE].includes(homework.status)) {
          throw apiError('Сейчас это ДЗ нельзя отправить.', 'locked_homework', 409);
        }
        if (!isBrowserFile(payload.file)) {
          throw apiError('Выберите реальный файл решения.', 'validation_error', 422, { fieldErrors: { file: 'required' } });
        }
        const fileResource = makeFileResource(payload.file, payload.fileTitle || payload.file.name);
        const cleanTitle = safeFileName(payload.fileTitle || fileResource.originalName);
        const submittedAt = nowIso();
        const attempt = {
          id: createId('attempt'),
          homeworkId,
          studentId: homework.studentId,
          file: cleanTitle,
          fileResource,
          submittedAt,
          reviewedAt: '',
          reviewStatus: SUBMISSION_STATUS.SUBMITTED,
        };
        Object.assign(homework, {
          status: HOMEWORK_STATUS.SUBMITTED,
          solutionFile: cleanTitle,
          submittedAt,
          reviewedAt: '',
          closedAt: '',
          attempts: [...(homework.attempts || []), attempt],
          updatedAt: submittedAt,
        });
      });
    },

    reviewHomework(homeworkId, payload) {
      return mutate((db, session) => {
        requireTeacherSession(session);
        const homework = requireHomework(db, homeworkId);
        if (homework.status !== HOMEWORK_STATUS.SUBMITTED || !homework.solutionFile) {
          throw apiError('Проверять можно только сданную работу.', 'invalid_status', 409);
        }
        const status = normalizeHomeworkStatus(payload.status);
        if (![HOMEWORK_STATUS.REVIEWED, HOMEWORK_STATUS.NEEDS_REVISION].includes(status)) {
          throw apiError('Некорректный статус проверки.', 'validation_error', 422);
        }
        const reviewedAt = nowIso();
        const attempts = homework.attempts || [];
        const lastIndex = attempts.length - 1;

        Object.assign(homework, {
          status,
          teacherComment: normalizeText(payload.comment),
          reviewMaterials: (payload.reviewMaterials || []).map(normalizeAttachment).filter(Boolean),
          reviewedAt,
          closedAt: status === HOMEWORK_STATUS.REVIEWED ? reviewedAt : '',
          attempts: attempts.map((attempt, index) => index === lastIndex ? {
            ...attempt,
            reviewedAt,
            reviewStatus: status === HOMEWORK_STATUS.REVIEWED ? SUBMISSION_STATUS.REVIEWED : SUBMISSION_STATUS.NEEDS_REVISION,
            teacherComment: normalizeText(payload.comment),
          } : attempt),
          updatedAt: reviewedAt,
        });
      });
    },

    addMaterial(payload) {
      return mutate((db, session) => {
        requireTeacherSession(session);
        const [taskNumber] = validateTaskNumbers([payload.taskNumber], { required: true });
        const item = buildMaterialFromPayload(payload);
        const existing = db.data.materials.find((topic) => Number(topic.taskNumber) === taskNumber);
        if (existing?.files?.some((file) => isSameMaterial(file, item))) {
          throw apiError('Такой материал уже есть в этой теме.', 'duplicate_material', 409);
        }

        if (existing) {
          existing.title = normalizeText(payload.topicTitle) || existing.title;
          existing.files = [item, ...existing.files];
          return;
        }

        db.data.materials = [{
          id: createId('m'),
          taskNumber,
          title: normalizeText(payload.topicTitle) || `Задание ${taskNumber}`,
          files: [item],
        }, ...db.data.materials];
      });
    },

    updateMaterialFile(topicId, fileId, payload = {}) {
      return mutate((db, session) => {
        requireTeacherSession(session);
        const topic = db.data.materials.find((item) => item.id === topicId);
        if (!topic) throw apiError('Тема материалов не найдена.', 'not_found', 404);
        const current = topic.files.find((item) => item.id === fileId);
        if (!current) throw apiError('Материал не найден.', 'not_found', 404);

        const [taskNumber] = payload.taskNumber ? validateTaskNumbers([payload.taskNumber], { required: true }) : [topic.taskNumber];
        let targetTopic = topic;
        if (Number(taskNumber) !== Number(topic.taskNumber)) {
          targetTopic = db.data.materials.find((item) => Number(item.taskNumber) === Number(taskNumber));
          if (!targetTopic) {
            targetTopic = { id: createId('m'), taskNumber, title: normalizeText(payload.topicTitle) || `Задание ${taskNumber}`, files: [] };
            db.data.materials = [targetTopic, ...db.data.materials];
          }
          topic.files = topic.files.filter((item) => item.id !== fileId);
        }

        if (payload.topicTitle) targetTopic.title = normalizeText(payload.topicTitle);

        const title = normalizeText(payload.title);
        let next = { ...current };
        if (payload.file || payload.fileId || payload.item?.fileId) {
          next = { ...buildMaterialFromPayload({ ...payload, type: MATERIAL_TYPE.FILE, item: { ...(payload.item || {}), id: fileId, title: title || payload.fileName || current.title } }), id: fileId };
        } else if (payload.type === MATERIAL_TYPE.LINK || payload.url) {
          next = normalizeMaterialFile({ ...current, ...buildLinkMaterial(payload.url || current.url), id: fileId, title: title || current.title });
        } else {
          next = normalizeMaterialFile({ ...current, id: fileId, title: title || current.title });
        }

        const nextFiles = targetTopic.files.filter((item) => item.id !== fileId);
        targetTopic.files = [next, ...nextFiles];
      });
    },

    removeMaterialFile(topicId, fileId) {
      return mutate((db, session) => {
        requireTeacherSession(session);
        const topic = db.data.materials.find((item) => item.id === topicId);
        if (!topic) throw apiError('Тема материалов не найдена.', 'not_found', 404);
        topic.files = topic.files.filter((file) => file.id !== fileId);
      });
    },
  };
}
