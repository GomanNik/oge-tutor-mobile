/*
 * OGE Tutor App — API DTO mappers and runtime guards.
 * This file is the boundary between backend payloads and frontend view models.
 */
import {
  ACCESS_STATUS,
  HOMEWORK_STATUS,
  LESSON_SOURCE,
  LESSON_STATUS,
  MATERIAL_SOURCE,
  MATERIAL_TYPE,
  NOTIFICATION_STATUS,
  ROLE,
  SUBMISSION_STATUS,
} from './contracts.js';
import {
  PROGRESS_COVERAGE_STATUS,
  PROGRESS_MASTERY_LEVEL,
  PROGRESS_SOURCE,
} from '../shared/progressContracts.js';

export const API_ERROR_STATUS = Object.freeze({
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION: 422,
  SERVER: 500,
});

const EMPTY_DATA = Object.freeze({
  teacher: null,
  students: [],
  lessons: [],
  homeworks: [],
  materials: [],
  notifications: [],
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function dtoError(message, field = '') {
  const error = new Error(message);
  error.code = 'invalid_dto';
  error.details = { status: 502, code: 'invalid_dto', fieldErrors: field ? { [field]: message } : {} };
  return error;
}

function requireStringField(dto, field, entityName) {
  const value = asOptionalString(dto?.[field]);
  if (!value) throw dtoError(`${entityName}: backend не вернул обязательное поле ${field}.`, field);
  return value;
}

function requireIsoField(dto, field, entityName) {
  const value = asIsoString(dto?.[field]);
  if (!value) throw dtoError(`${entityName}: backend вернул некорректную дату ${field}.`, field);
  return value;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function asOptionalString(value) {
  const text = asString(value).trim();
  return text || '';
}

function asNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}


function asTaskNumbers(value) {
  return [...new Set(asArray(value)
    .map(Number)
    .filter((taskNumber) => Number.isInteger(taskNumber) && taskNumber >= 1 && taskNumber <= 25))];
}

function isIsoLike(value) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp);
}

function asIsoString(value) {
  return isIsoLike(value) ? new Date(value).toISOString() : '';
}

function requireKnownValue(map, value, field, entityName) {
  if (Object.values(map).includes(value)) return value;
  throw dtoError(`${entityName}: backend вернул неизвестное значение ${field}.`, field);
}

function optionalArray(dto, field, entityName) {
  if (dto?.[field] === undefined || dto?.[field] === null) return [];
  if (!Array.isArray(dto[field])) throw dtoError(`${entityName}: поле ${field} должно быть массивом.`, field);
  return dto[field];
}

function normalizeHomeworkStatusDto(status) {
  return requireKnownValue(HOMEWORK_STATUS, status, 'status', 'HomeworkDto');
}

function normalizeLessonStatusDto(status) {
  return requireKnownValue(LESSON_STATUS, status, 'status', 'LessonDto');
}

function normalizeAccessStatusDto(status) {
  return requireKnownValue(ACCESS_STATUS, status, 'access', 'StudentDto');
}

function normalizeMaterialTypeDto(type) {
  return requireKnownValue(MATERIAL_TYPE, type, 'type', 'MaterialAttachmentDto');
}


function mapSettingsDto(settings) {
  return isRecord(settings) ? { ...settings } : {};
}

export function mapSessionDto(dto) {
  if (!isRecord(dto)) return null;
  const role = dto.role === ROLE.TEACHER || dto.role === ROLE.STUDENT ? dto.role : '';
  const id = asOptionalString(dto.id);
  if (!id || !role) throw dtoError('SessionDto: backend вернул некорректную сессию.', 'session');
  return {
    id,
    role,
    email: asOptionalString(dto.email),
    token: asOptionalString(dto.token),
  };
}

export function mapTeacherDto(dto) {
  if (!isRecord(dto)) return null;
  return {
    ...dto,
    id: requireStringField(dto, 'id', 'TeacherDto'),
    role: ROLE.TEACHER,
    name: requireStringField(dto, 'name', 'TeacherDto'),
    email: requireStringField(dto, 'email', 'TeacherDto'),
    avatar: asOptionalString(dto.avatar),
    bg: asOptionalString(dto.bg),
    settings: mapSettingsDto(dto.settings),
    createdAt: asIsoString(dto.createdAt),
    updatedAt: asIsoString(dto.updatedAt),
  };
}

export function mapFileResourceDto(dto) {
  if (!isRecord(dto)) return null;
  const id = asOptionalString(dto.id || dto.fileId);
  const originalName = asOptionalString(dto.originalName || dto.fileName || dto.name);
  if (!id || !originalName) throw dtoError('FileResourceDto: backend вернул файл без id или originalName.', 'file');
  return {
    ...dto,
    id,
    originalName,
    mimeType: requireStringField({ mimeType: dto.mimeType || dto.contentType || dto.type || 'application/octet-stream' }, 'mimeType', 'FileResourceDto'),
    size: asNumber(dto.size, 0),
    url: asOptionalString(dto.url),
    uploadedAt: asIsoString(dto.uploadedAt),
  };
}

export function mapMaterialAttachmentDto(dto) {
  if (!isRecord(dto)) return null;
  const type = normalizeMaterialTypeDto(dto.type);
  if (!type) throw dtoError('MaterialAttachmentDto: неизвестный тип материала.', 'type');
  const fileResource = type === MATERIAL_TYPE.FILE ? mapFileResourceDto(dto.fileResource || dto.file || dto) : null;
  const source = requireKnownValue(MATERIAL_SOURCE, dto.source || (type === MATERIAL_TYPE.LINK ? MATERIAL_SOURCE.LINK : type === MATERIAL_TYPE.LIBRARY ? MATERIAL_SOURCE.LIBRARY : MATERIAL_SOURCE.UPLOAD), 'source', 'MaterialAttachmentDto');
  if (type === MATERIAL_TYPE.LINK && !asOptionalString(dto.url)) throw dtoError('MaterialAttachmentDto: ссылка без url.', 'url');

  return {
    ...dto,
    id: asOptionalString(dto.id),
    type,
    source,
    title: asOptionalString(dto.title || dto.fileName || dto.originalName || fileResource?.originalName || dto.url),
    url: asOptionalString(dto.url || fileResource?.url),
    fileId: asOptionalString(dto.fileId || fileResource?.id),
    originalName: asOptionalString(dto.originalName || fileResource?.originalName),
    fileName: asOptionalString(dto.fileName || dto.originalName || fileResource?.originalName),
    mimeType: asOptionalString(dto.mimeType || fileResource?.mimeType),
    size: asNumber(dto.size ?? fileResource?.size, 0),
    uploadedAt: asIsoString(dto.uploadedAt || fileResource?.uploadedAt),
  };
}

export function mapMaterialTopicDto(dto) {
  if (!isRecord(dto)) return null;
  return {
    ...dto,
    id: requireStringField(dto, 'id', 'MaterialTopicDto'),
    taskNumber: asNumber(dto.taskNumber, 0),
    title: requireStringField(dto, 'title', 'MaterialTopicDto'),
    files: optionalArray(dto, 'files', 'MaterialTopicDto').map(mapMaterialAttachmentDto).filter(Boolean),
  };
}

function mapProgressHistoryEventDto(dto) {
  if (!isRecord(dto)) return null;
  return {
    ...dto,
    id: asOptionalString(dto.id),
    type: asOptionalString(dto.type),
    source: requireKnownValue(PROGRESS_SOURCE, dto.source || PROGRESS_SOURCE.MANUAL, 'source', 'ProgressHistoryEventDto'),
    taskNumber: asNumber(dto.taskNumber, 0),
    lessonId: asOptionalString(dto.lessonId),
    coverageStatus: requireKnownValue(PROGRESS_COVERAGE_STATUS, dto.coverageStatus || PROGRESS_COVERAGE_STATUS.NOT_STARTED, 'coverageStatus', 'ProgressHistoryEventDto'),
    masteryLevel: dto.masteryLevel === null || dto.masteryLevel === undefined ? null : requireKnownValue(PROGRESS_MASTERY_LEVEL, dto.masteryLevel, 'masteryLevel', 'ProgressHistoryEventDto'),
    comment: asOptionalString(dto.comment),
    createdAt: asIsoString(dto.createdAt),
  };
}

export function mapStudentTaskProgressDto(dto) {
  if (!isRecord(dto)) return null;
  const taskNumber = asNumber(dto.taskNumber, 0);
  if (!Number.isInteger(taskNumber) || taskNumber < 1 || taskNumber > 25) {
    throw dtoError('StudentTaskProgressDto: некорректный номер задания.', 'taskNumber');
  }
  const coverageStatus = requireKnownValue(PROGRESS_COVERAGE_STATUS, dto.coverageStatus || PROGRESS_COVERAGE_STATUS.NOT_STARTED, 'coverageStatus', 'StudentTaskProgressDto');
  const masteryLevel = coverageStatus === PROGRESS_COVERAGE_STATUS.NOT_STARTED
    ? null
    : (dto.masteryLevel === null || dto.masteryLevel === undefined ? null : requireKnownValue(PROGRESS_MASTERY_LEVEL, dto.masteryLevel, 'masteryLevel', 'StudentTaskProgressDto'));

  return {
    ...dto,
    taskNumber,
    coverageStatus,
    masteryLevel,
    lessonCount: asNumber(dto.lessonCount, 0),
    lastLessonId: asOptionalString(dto.lastLessonId),
    lastActivityAt: asIsoString(dto.lastActivityAt),
    lastAssessedAt: asIsoString(dto.lastAssessedAt),
    lastAssessedMasteryLevel: dto.lastAssessedMasteryLevel === null || dto.lastAssessedMasteryLevel === undefined ? null : requireKnownValue(PROGRESS_MASTERY_LEVEL, dto.lastAssessedMasteryLevel, 'lastAssessedMasteryLevel', 'StudentTaskProgressDto'),
    source: requireKnownValue(PROGRESS_SOURCE, dto.source || PROGRESS_SOURCE.MANUAL, 'source', 'StudentTaskProgressDto'),
    teacherComment: asOptionalString(dto.teacherComment),
    recommendedAction: asOptionalString(dto.recommendedAction),
    history: optionalArray(dto, 'history', 'StudentTaskProgressDto').map(mapProgressHistoryEventDto).filter(Boolean),
  };
}

export function mapStudentDto(dto) {
  if (!isRecord(dto)) return null;
  return {
    ...dto,
    id: requireStringField(dto, 'id', 'StudentDto'),
    teacherId: asOptionalString(dto.teacherId),
    role: ROLE.STUDENT,
    name: requireStringField(dto, 'name', 'StudentDto'),
    email: requireStringField(dto, 'email', 'StudentDto'),
    grade: asOptionalString(dto.grade),
    goal: asOptionalString(dto.goal),
    note: asOptionalString(dto.note),
    avatar: asOptionalString(dto.avatar),
    bg: asOptionalString(dto.bg),
    access: normalizeAccessStatusDto(dto.access),
    settings: mapSettingsDto(dto.settings),
    progressByTask: optionalArray(dto, 'progressByTask', 'StudentDto').map(mapStudentTaskProgressDto).filter(Boolean),
    weak: asTaskNumbers(dto.weak),
    coveragePercent: asNumber(dto.coveragePercent, 0),
    masteryPercent: asNumber(dto.masteryPercent, 0),
    progress: asNumber(dto.progress, 0),
    primaryScore: asNumber(dto.primaryScore, 0),
    predictedMark: asNumber(dto.predictedMark, 2),
    scoreFormulaVersion: asOptionalString(dto.scoreFormulaVersion),
    createdAt: asIsoString(dto.createdAt),
    updatedAt: asIsoString(dto.updatedAt),
  };
}

export function mapLessonDto(dto) {
  if (!isRecord(dto)) return null;
  return {
    ...dto,
    id: requireStringField(dto, 'id', 'LessonDto'),
    teacherId: asOptionalString(dto.teacherId),
    studentId: asOptionalString(dto.studentId),
    topic: asOptionalString(dto.topic),
    focusTaskNumbers: asTaskNumbers(dto.focusTaskNumbers),
    startAt: requireIsoField(dto, 'startAt', 'LessonDto'),
    endAt: requireIsoField(dto, 'endAt', 'LessonDto'),
    timezone: asOptionalString(dto.timezone),
    durationMinutes: asNumber(dto.durationMinutes, 0),
    status: normalizeLessonStatusDto(dto.status) || (() => { throw dtoError('LessonDto: неизвестный статус урока.', 'status'); })(),
    source: requireKnownValue(LESSON_SOURCE, dto.source || LESSON_SOURCE.MANUAL, 'source', 'LessonDto'),
    completedAt: asIsoString(dto.completedAt),
    completionComment: asOptionalString(dto.completionComment),
    note: asOptionalString(dto.note),
    materials: optionalArray(dto, 'materials', 'LessonDto').map(mapMaterialAttachmentDto).filter(Boolean),
    createdAt: asIsoString(dto.createdAt),
    updatedAt: asIsoString(dto.updatedAt),
  };
}

export function mapHomeworkSubmissionDto(dto) {
  if (!isRecord(dto)) return null;
  const fileResource = mapFileResourceDto(dto.fileResource || dto.file);
  if (!fileResource) throw dtoError('HomeworkSubmissionDto: отправка должна содержать fileResource.', 'fileResource');
  return {
    ...dto,
    id: asOptionalString(dto.id),
    homeworkId: asOptionalString(dto.homeworkId),
    studentId: asOptionalString(dto.studentId),
    file: asOptionalString(dto.file || fileResource?.originalName),
    fileResource,
    reviewStatus: requireKnownValue(SUBMISSION_STATUS, dto.reviewStatus || SUBMISSION_STATUS.SUBMITTED, 'reviewStatus', 'HomeworkSubmissionDto'),
    submittedAt: asIsoString(dto.submittedAt),
    reviewedAt: asIsoString(dto.reviewedAt),
    teacherComment: asOptionalString(dto.teacherComment),
  };
}

export function mapHomeworkDto(dto) {
  if (!isRecord(dto)) return null;
  return {
    ...dto,
    id: requireStringField(dto, 'id', 'HomeworkDto'),
    teacherId: asOptionalString(dto.teacherId),
    studentId: asOptionalString(dto.studentId),
    title: asOptionalString(dto.title),
    topic: asOptionalString(dto.topic),
    taskNumbers: asTaskNumbers(dto.taskNumbers),
    dueAt: requireIsoField(dto, 'dueAt', 'HomeworkDto'),
    assignedAt: asIsoString(dto.assignedAt),
    submittedAt: asIsoString(dto.submittedAt),
    reviewedAt: asIsoString(dto.reviewedAt),
    closedAt: asIsoString(dto.closedAt),
    status: normalizeHomeworkStatusDto(dto.status) || (() => { throw dtoError('HomeworkDto: неизвестный статус ДЗ.', 'status'); })(),
    materials: optionalArray(dto, 'materials', 'HomeworkDto').map(mapMaterialAttachmentDto).filter(Boolean),
    reviewMaterials: optionalArray(dto, 'reviewMaterials', 'HomeworkDto').map(mapMaterialAttachmentDto).filter(Boolean),
    attempts: optionalArray(dto, 'attempts', 'HomeworkDto').map(mapHomeworkSubmissionDto).filter(Boolean),
    solutionFile: asOptionalString(dto.solutionFile),
    teacherComment: asOptionalString(dto.teacherComment),
    createdAt: asIsoString(dto.createdAt),
    updatedAt: asIsoString(dto.updatedAt),
  };
}

export function mapNotificationDto(dto) {
  if (!isRecord(dto)) return null;
  return {
    ...dto,
    id: asOptionalString(dto.id),
    type: asOptionalString(dto.type),
    status: requireKnownValue(NOTIFICATION_STATUS, dto.status || NOTIFICATION_STATUS.UNREAD, 'status', 'NotificationDto'),
    teacherId: asOptionalString(dto.teacherId),
    studentId: asOptionalString(dto.studentId),
    taskNumber: dto.taskNumber === null || dto.taskNumber === undefined ? null : asNumber(dto.taskNumber, null),
    lessonId: asOptionalString(dto.lessonId),
    title: asOptionalString(dto.title),
    message: asOptionalString(dto.message),
    createdAt: asIsoString(dto.createdAt),
    resolvedAt: asIsoString(dto.resolvedAt),
  };
}

export function mapDataDto(dto) {
  if (dto === null || dto === undefined) return { ...EMPTY_DATA };
  if (!isRecord(dto)) throw dtoError('DataDto: backend вернул некорректный контейнер данных.', 'data');
  return {
    ...dto,
    teacher: dto.teacher === null || dto.teacher === undefined ? null : mapTeacherDto(dto.teacher),
    students: optionalArray(dto, 'students', 'DataDto').map(mapStudentDto),
    lessons: optionalArray(dto, 'lessons', 'DataDto').map(mapLessonDto),
    homeworks: optionalArray(dto, 'homeworks', 'DataDto').map(mapHomeworkDto),
    materials: optionalArray(dto, 'materials', 'DataDto').map(mapMaterialTopicDto),
    notifications: optionalArray(dto, 'notifications', 'DataDto').map(mapNotificationDto),
  };
}

export function mapBackendResultDto(dto) {
  if (!isRecord(dto)) return {};
  return {
    ...dto,
    data: dto.data === undefined ? undefined : mapDataDto(dto.data),
    session: dto.session === undefined ? undefined : mapSessionDto(dto.session),
  };
}

export function mapApiErrorPayload(payload, status = 0, fallbackMessage = 'Backend вернул ошибку.') {
  const body = isRecord(payload) ? payload : {};
  const code = asOptionalString(body.code || body.error || body.type) || statusToCode(status);
  const message = asOptionalString(body.message || body.error_description || body.title) || statusToMessage(status, fallbackMessage);
  return {
    status: asNumber(status, 0),
    code,
    message,
    fieldErrors: isRecord(body.fieldErrors) ? body.fieldErrors : {},
    requestId: asOptionalString(body.requestId || body.traceId || body.correlationId),
    payload,
  };
}

export function statusToCode(status) {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 422) return 'validation_error';
  if (status >= 500) return 'server_error';
  return 'http_error';
}

export function statusToMessage(status, fallbackMessage = 'Backend вернул ошибку.') {
  if (status === 401) return 'Сессия истекла. Войдите заново.';
  if (status === 403) return 'Недостаточно прав для этого действия.';
  if (status === 404) return 'Данные не найдены.';
  if (status === 409) return 'Конфликт данных. Обновите страницу и повторите действие.';
  if (status === 422) return 'Проверьте заполненные поля.';
  if (status >= 500) return 'Сервер временно недоступен.';
  return fallbackMessage;
}

export function isUnauthorizedApiError(error) {
  return error?.details?.status === 401 || error?.code === 'unauthorized';
}
