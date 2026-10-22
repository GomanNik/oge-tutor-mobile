import type { ReferenceObject, SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import * as C from '../common/contracts';

type Schema = SchemaObject | ReferenceObject;
export const ref = (name: string): ReferenceObject => ({ $ref: `#/components/schemas/${name}` });
const string: SchemaObject = { type: 'string' };
const integer: SchemaObject = { type: 'integer' };
const boolean: SchemaObject = { type: 'boolean' };
const date: SchemaObject = { type: 'string', format: 'date-time' };
const optionalDate: SchemaObject = { type: 'string', description: 'ISO 8601 timestamp, or empty string when unavailable.' };
const enumeration = (values: object, nullable = false): SchemaObject => ({ type: 'string', enum: Object.values(values), ...(nullable ? { nullable: true } : {}) });
const nullableRef = (name: string): SchemaObject => ({ allOf: [ref(name)], nullable: true });
const array = (items: Schema): SchemaObject => ({ type: 'array', items });
export const object = (properties: Record<string, Schema>, required = Object.keys(properties)): SchemaObject => ({ type: 'object', properties, required });
const timestamps = { createdAt: date, updatedAt: date };
const taskNumber: SchemaObject = { type: 'integer', minimum: 1, maximum: 25 };
const taskNumbers = array(taskNumber);
const profile = { id: string, name: string, email: { ...string, format: 'email' }, avatar: string, bg: string, settings: ref('SettingsDto'), ...timestamps };

export function pageSchema(item: Schema): SchemaObject {
  return object({ items: array(item), total: { ...integer, minimum: 0 }, page: { ...integer, minimum: 1 }, pageSize: { ...integer, minimum: 1, maximum: 100 } });
}
export function detailSchema(item: Schema): SchemaObject {
  return object({ item });
}

// Schemas reflect BootstrapService's public mappers, including empty-string dates.
export const responseSchemas: Record<string, SchemaObject> = {
  ApiError: object({
    code: { type: 'string', example: 'validation_error' },
    message: string,
    fieldErrors: { type: 'object', additionalProperties: string },
    requestId: string,
    status: { ...integer, description: 'Included by mapped database errors.' },
  }, ['code', 'message', 'fieldErrors', 'requestId']),
  OkResponse: object({ ok: { ...boolean, enum: [true] } }),
  Session: object({ id: string, userId: string, role: enumeration(C.ROLE), email: { ...string, format: 'email' }, token: { ...string, description: 'JWT on login; empty string on bootstrap.' } }),
  AccessTokenPreview: object({ token: string, link: string, expiresAt: date }),
  AccessTokenVerified: object({ valid: { ...boolean, enum: [true] }, type: enumeration(C.ACCESS_TOKEN_TYPE), expiresAt: date, account: object({ email: { ...string, description: 'Masked email address.' }, name: string, role: enumeration(C.ROLE) }) }),
  PasswordResetResponse: object({ ok: { ...boolean, enum: [true] }, reset: ref('AccessTokenPreview') }, ['ok']),
  LogoutResponse: object({ session: { type: 'object', nullable: true, enum: [null] } }),
  FileResource: object({ id: string, originalName: string, mimeType: string, size: { ...integer, minimum: 0 }, url: string, uploadedAt: date }),
  FileUploadResponse: object({ fileResource: ref('FileResource') }),
  Attachment: object({
    id: string, type: enumeration(C.MATERIAL_TYPE), source: enumeration(C.MATERIAL_SOURCE),
    title: string, url: string, fileId: string, originalName: string, fileName: string,
    mimeType: string, size: { ...integer, minimum: 0 }, uploadedAt: optionalDate, fileResource: ref('FileResource'),
  }, ['id', 'type', 'source', 'title', 'url']),
  ProgressHistory: object({
    id: string, type: string, source: enumeration(C.PROGRESS_SOURCE), taskNumber,
    lessonId: string, coverageStatus: enumeration(C.PROGRESS_COVERAGE_STATUS, true),
    masteryLevel: enumeration(C.PROGRESS_MASTERY_LEVEL, true), comment: string, createdAt: date,
  }),
  TaskProgress: object({
    taskNumber, coverageStatus: enumeration(C.PROGRESS_COVERAGE_STATUS),
    masteryLevel: enumeration(C.PROGRESS_MASTERY_LEVEL, true),
    lastAssessedMasteryLevel: enumeration(C.PROGRESS_MASTERY_LEVEL, true),
    lessonCount: { ...integer, minimum: 0 }, lastLessonId: string, lastActivityAt: optionalDate,
    lastAssessedAt: optionalDate, source: enumeration(C.PROGRESS_SOURCE), teacherComment: string,
    recommendedAction: string, history: array(ref('ProgressHistory')),
  }),
  Teacher: object({ ...profile, role: { ...string, enum: [C.ROLE.TEACHER] } }),
  Student: object({
    ...profile, teacherId: string, role: { ...string, enum: [C.ROLE.STUDENT] },
    grade: string, goal: string, note: string, access: enumeration(C.ACCESS_STATUS),
    progressByTask: array(ref('TaskProgress')), weak: taskNumbers,
    coveragePercent: { ...integer, minimum: 0, maximum: 100 }, masteryPercent: { ...integer, minimum: 0, maximum: 100 },
    progress: { ...integer, minimum: 0, maximum: 100 }, primaryScore: { ...integer, minimum: 0, maximum: 31 },
    predictedMark: { ...integer, minimum: 2, maximum: 5 }, scoreFormulaVersion: { ...string, enum: [C.SCORE_FORMULA_VERSION] },
  }),
  Lesson: object({
    id: string, teacherId: string, studentId: string, topic: string, focusTaskNumbers: taskNumbers,
    startAt: date, endAt: date, timezone: string, durationMinutes: integer,
    status: enumeration(C.LESSON_STATUS), source: enumeration(C.LESSON_SOURCE),
    completedAt: optionalDate, completionComment: string, note: string, materials: array(ref('Attachment')), ...timestamps,
  }),
  HomeworkSubmission: object({
    id: string, homeworkId: string, studentId: string, file: string, fileResource: nullableRef('FileResource'),
    reviewStatus: enumeration(C.SUBMISSION_STATUS), submittedAt: date, reviewedAt: optionalDate, teacherComment: string,
  }),
  Homework: object({
    id: string, teacherId: string, studentId: string, title: string, topic: string, taskNumbers,
    dueAt: date, assignedAt: date, submittedAt: optionalDate, reviewedAt: optionalDate, closedAt: optionalDate,
    status: enumeration(C.HOMEWORK_STATUS), description: string, materials: array(ref('Attachment')),
    reviewMaterials: array(ref('Attachment')), attempts: array(ref('HomeworkSubmission')),
    solutionFile: string, teacherComment: string, ...timestamps,
  }),
  MaterialTopic: object({ id: string, taskNumber, title: string, files: array(ref('Attachment')) }),
  Notification: object({
    id: string, type: enumeration(C.NOTIFICATION_TYPE), status: enumeration(C.NOTIFICATION_STATUS),
    teacherId: string, studentId: string, taskNumber: { ...taskNumber, nullable: true }, lessonId: string,
    title: string, message: string, createdAt: date, resolvedAt: optionalDate,
  }),
  PaginationMeta: object({ total: { ...integer, minimum: 0 }, page: { ...integer, minimum: 1 }, pageSize: { ...integer, minimum: 1, maximum: 100 } }),
  HealthResponse: object({ ok: { ...boolean, enum: [true] }, status: { ...string, enum: ['ok'] } }),
  ReadyResponse: object({ ok: { ...boolean, enum: [true] }, status: { ...string, enum: ['ready'] }, checks: object({ database: { ...string, enum: ['ok'] } }) }),
};

export const collectionSchemas: Record<string, string> = {
  students: 'Student', lessons: 'Lesson', homeworks: 'Homework', materials: 'MaterialTopic', notifications: 'Notification',
};
const collections = Object.fromEntries(Object.entries(collectionSchemas).map(([key, name]) => [key, array(ref(name))]));
responseSchemas.BootstrapData = object({ teacher: nullableRef('Teacher'), ...collections });
responseSchemas.Changes = object({ teacher: ref('Teacher'), ...collections }, []);
responseSchemas.BootstrapPagination = object(Object.fromEntries(Object.keys(collectionSchemas).map(key => [key, ref('PaginationMeta')])));
responseSchemas.BootstrapResponse = object({ session: ref('Session'), data: ref('BootstrapData'), pagination: ref('BootstrapPagination') });
responseSchemas.MutationResponse = object({
  changes: ref('Changes'),
  invalidated: { type: 'array', items: { type: 'string', enum: Object.keys(collectionSchemas) }, uniqueItems: true },
  invite: ref('AccessTokenPreview'), reset: ref('AccessTokenPreview'),
}, ['changes']);
for (const name of [...Object.values(collectionSchemas), 'ProgressHistory']) {
  responseSchemas[`${name}Page`] = pageSchema(ref(name));
  responseSchemas[`${name}Detail`] = detailSchema(ref(name));
}
