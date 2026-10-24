import type { ReferenceObject, SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import * as C from '../common/contracts';
import { CatalogStatus, DeliveryStatus, ExamType, InvitationStatus, MembershipStatus, ProgramVersionStatus, ScoringRuleKind, TaskKind, WorkspaceRole, WorkspaceStatus } from '@prisma/client';

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

const strictObject = (properties: Record<string, Schema>, required = Object.keys(properties)): SchemaObject => ({
  ...object(properties, required), additionalProperties: false,
});
const v2Role = enumeration(WorkspaceRole);
const v2Roles = array(v2Role);
const v2PageInfo = strictObject({ nextCursor: { ...string, nullable: true }, hasMore: boolean });
const v2Page = (item: Schema) => strictObject({ items: array(item), pageInfo: v2PageInfo });
const v2Mutation = (item: Schema) => strictObject({ item, changed: array(string), requestId: string });

Object.assign(responseSchemas, {
  V2Session: strictObject({ token: string, userId: string, expiresAt: date }),
  V2User: strictObject({ id: string, email: { ...string, format: 'email' }, displayName: string, revision: integer, catalogManage: boolean }),
  V2Context: strictObject({ workspaceId: string, name: string, status: enumeration(WorkspaceStatus), legacyRole: { type: 'string', enum: ['teacher', 'student'], nullable: true }, roles: v2Roles }),
  V2Member: strictObject({ id: string, userId: string, email: { ...string, format: 'email' }, displayName: string, roles: v2Roles, status: enumeration(MembershipStatus), revision: integer }),
  V2Invitation: strictObject({ id: string, email: { ...string, format: 'email' }, roles: v2Roles, expiresAt: date, status: enumeration(InvitationStatus), deliveryStatus: enumeration(DeliveryStatus), revision: integer }),
  V2Workspace: strictObject({ id: string, name: string, timezone: string, status: enumeration(WorkspaceStatus), revision: integer }),
  V2AuditChanges: strictObject({
    role: v2Role, roles: v2Roles,
    status: { type: 'string', enum: [...Object.values(MembershipStatus), ...Object.values(CatalogStatus), ...Object.values(ProgramVersionStatus)] },
    displayNameOverride: { ...string, nullable: true },
    code: string, name: string, subjectId: string, examType: enumeration(ExamType), variant: string,
    period: string, revisionNumber: integer, taskCount: integer, versionId: string,
    sourceUrl: { ...string, nullable: true }, notes: string, kind: enumeration(ScoringRuleKind),
    fromTaskId: string, toTaskId: string, reason: string,
  }, []),
  V2AuditEvent: strictObject({ id: string, actorUserId: { ...string, nullable: true }, action: string, targetType: string, targetId: string, reason: { ...string, nullable: true }, changes: ref('V2AuditChanges'), requestId: string, occurredAt: date }),
  V2LoginResponse: strictObject({ session: ref('V2Session'), user: ref('V2User'), contexts: array(ref('V2Context')) }),
  V2UserDetail: detailSchema(ref('V2User')),
  V2UserMutation: v2Mutation(ref('V2User')),
  V2ContextsPage: v2Page(ref('V2Context')),
  V2WorkspaceDetail: detailSchema(ref('V2Workspace')),
  V2MemberPage: v2Page(ref('V2Member')),
  V2MemberDetail: detailSchema(ref('V2Member')),
  V2MemberMutation: v2Mutation(ref('V2Member')),
  V2InvitationPage: v2Page(ref('V2Invitation')),
  V2InvitationMutation: v2Mutation(ref('V2Invitation')),
  V2AuditPage: v2Page(ref('V2AuditEvent')),
});

const catalogMutation = (item: Schema) => strictObject({ item, changed: array(string), requestId: string });
const catalogTaskMutation = (item: Schema) => strictObject({ item, versionRevision: integer, changed: array(string), requestId: string });
Object.assign(responseSchemas, {
  V2Subject: strictObject({ id: string, scopeKey: string, workspaceId: { ...string, nullable: true }, code: string, name: string, status: enumeration(CatalogStatus), revision: integer, ...timestamps }),
  V2Program: strictObject({ id: string, scopeKey: string, workspaceId: { ...string, nullable: true }, subjectId: string, code: string, examType: enumeration(ExamType), variant: string, name: string, status: enumeration(CatalogStatus), revision: integer, ...timestamps, subject: strictObject({ code: string, name: string }) }, ['id', 'scopeKey', 'workspaceId', 'subjectId', 'code', 'examType', 'variant', 'name', 'status', 'revision', 'createdAt', 'updatedAt']),
  V2ScoringRule: strictObject({ id: string, programVersionId: string, kind: enumeration(ScoringRuleKind), code: string, description: string, sourceUrl: { ...string, nullable: true }, createdAt: date }),
  V2ProgramVersion: strictObject({ id: string, programId: string, period: string, revisionNumber: integer, status: enumeration(ProgramVersionStatus), sourceUrl: { ...string, nullable: true }, notes: string, revision: integer, publishedAt: { ...date, nullable: true }, ...timestamps, program: ref('V2Program'), scoringRule: nullableRef('V2ScoringRule') }, ['id', 'programId', 'period', 'revisionNumber', 'status', 'sourceUrl', 'notes', 'revision', 'publishedAt', 'createdAt', 'updatedAt']),
  V2TaskCriterion: strictObject({ code: string, title: string, maxScore: integer }),
  V2TaskDefinition: strictObject({ id: string, programVersionId: string, code: string, title: string, topics: array(string), position: integer, kind: enumeration(TaskKind), maxScore: { ...integer, nullable: true }, criteria: array(ref('V2TaskCriterion')), ...timestamps }),
  V2TaskMapping: strictObject({ id: string, fromTaskId: string, toTaskId: string, reason: string, createdById: string, createdAt: date, revision: integer, revokedAt: { ...date, nullable: true }, revokedById: { ...string, nullable: true }, revocationReason: { ...string, nullable: true }, fromTask: strictObject({ code: string, title: string }), toTask: strictObject({ code: string, title: string }) }, ['id', 'fromTaskId', 'toTaskId', 'reason', 'createdById', 'createdAt', 'revision', 'revokedAt', 'revokedById', 'revocationReason']),
  V2SubjectPage: pageSchema(ref('V2Subject')),
  V2SubjectDetail: detailSchema(ref('V2Subject')),
  V2SubjectMutation: catalogMutation(ref('V2Subject')),
  V2ProgramPage: pageSchema(ref('V2Program')),
  V2ProgramDetail: detailSchema(ref('V2Program')),
  V2ProgramMutation: catalogMutation(ref('V2Program')),
  V2ProgramVersionPage: pageSchema(ref('V2ProgramVersion')),
  V2ProgramVersionDetail: detailSchema(ref('V2ProgramVersion')),
  V2ProgramVersionMutation: catalogMutation(ref('V2ProgramVersion')),
  V2TaskDefinitionPage: pageSchema(ref('V2TaskDefinition')),
  V2TaskDefinitionMutation: catalogTaskMutation(ref('V2TaskDefinition')),
  V2TaskDeletion: catalogTaskMutation(strictObject({ id: string })),
  V2ScoringRuleMutation: catalogTaskMutation(ref('V2ScoringRule')),
  V2TaskMappingPage: pageSchema(ref('V2TaskMapping')),
  V2TaskMappingMutation: catalogMutation(ref('V2TaskMapping')),
});
