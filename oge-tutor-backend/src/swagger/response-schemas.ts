import type { ReferenceObject, SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import * as C from '../common/contracts';
import { AssignmentRecipientStatus, AssignmentReviewDecision, AssignmentReviewStatus, AssignmentStatus, CatalogStatus, CourseFormat, CourseStatus, CourseTeacherRole, CourseTeacherStatus, DeliveryStatus, EnrollmentStatus, ExamType, InvitationStatus, LearningDeliveryStatus, LearningProgressKind, LearningProgressSource, LearningVisibility, LessonAttendance, LessonResponseStatus, LessonStatus, MembershipStatus, ProgramVersionStatus, ProgressCoverageStatus, ProgressMasteryLevel, ScoringRuleKind, TaskKind, WorkspaceRole, WorkspaceStatus } from '@prisma/client';

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
  V2ReleaseStatusDetail: object({ item: object({ workspaceId: string, asOf: date, legacyApiMode: { type: 'string', enum: ['enabled', 'read_only', 'disabled'] },
    cutoverCommittedAt: { ...date, nullable: true }, dataConsistent: boolean, readyForCutover: boolean,
    counts: object({ courses: integer, lessons: integer, assignments: integer, submissions: integer, progressEvents: integer, notifications: integer, files: integer }),
    checks: array(object({ code: string, count: integer, passed: boolean })), requiresFileVerification: boolean, requiresVerifiedRestore: boolean }) }),
  V2Runtime: object({ apiVersion: { type: 'integer', enum: [2] }, legacyApiMode: { type: 'string', enum: ['enabled', 'read_only', 'disabled'] }, legacyDataRetained: { type: 'boolean', enum: [true] } }),
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
  AccessTokenVerified: object({ valid: { ...boolean, enum: [true] }, type: enumeration(C.ACCESS_TOKEN_TYPE), expiresAt: date, account: object({ email: { ...string, description: 'Masked email address.' }, name: string, role: enumeration(C.ROLE) }, ['email', 'name']) }),
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
    status: { type: 'string', enum: [...Object.values(MembershipStatus), ...Object.values(CatalogStatus), ...Object.values(ProgramVersionStatus), ...Object.values(CourseStatus), ...Object.values(EnrollmentStatus), ...Object.values(CourseTeacherStatus), ...Object.values(AssignmentStatus), ...Object.values(AssignmentRecipientStatus)] },
    displayNameOverride: { ...string, nullable: true },
    code: string, name: string, subjectId: string, examType: enumeration(ExamType), variant: string,
    period: string, revisionNumber: integer, taskCount: integer, versionId: string,
    sourceUrl: { ...string, nullable: true }, notes: string, kind: enumeration(ScoringRuleKind),
    fromTaskId: string, toTaskId: string, reason: string,
    programVersionId: string, leadTeacherUserId: string, teacherUserId: string, studentUserId: string,
    courseId: string, capacity: integer, title: string, from: string, to: string, count: integer,
    teacherCount: integer, participantCount: integer, enrollmentId: string,
    attendance: array(strictObject({ enrollmentId: string, attendance: enumeration(LessonAttendance) })),
    enrollmentIds: array(string), recipientId: string, attempt: integer, submissionId: string,
    number: integer, decision: enumeration(AssignmentReviewDecision), mimeType: string, size: integer,
    dueAt: date,
    seriesId: string, seriesRevision: integer, seriesOccurrenceKey: string, seriesException: boolean,
    createdCount: integer, canceledCount: integer, generation: integer, manifestSha256: string,
    visibility: enumeration(LearningVisibility), supersedesId: { ...string, nullable: true },
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

Object.assign(responseSchemas, {
  V2CourseProgram: strictObject({ id: string, name: string, examType: enumeration(ExamType), variant: string, subjectId: string, subjectName: string, period: string, revisionNumber: integer }),
  V2Course: strictObject({
    id: string, workspaceId: string, programVersionId: string, program: ref('V2CourseProgram'),
    title: string, defaultFormat: enumeration(CourseFormat), capacity: integer,
    startsOn: { type: 'string', format: 'date' }, endsOn: { type: 'string', format: 'date', nullable: true },
    timezone: string, status: enumeration(CourseStatus), revision: integer,
    activeEnrollmentCount: { ...integer, nullable: true }, legacy: boolean, legacyReadOnly: boolean, ...timestamps,
  }),
  V2CourseTeacher: strictObject({
    id: string, teacherUserId: string, displayName: string, role: enumeration(CourseTeacherRole),
    status: enumeration(CourseTeacherStatus), startsOn: { type: 'string', format: 'date' },
    endsOn: { type: 'string', format: 'date', nullable: true }, revision: integer,
  }),
  V2Enrollment: strictObject({
    id: string, studentUserId: string, displayName: string, status: enumeration(EnrollmentStatus),
    startsOn: { type: 'string', format: 'date', nullable: true }, endsOn: { type: 'string', format: 'date', nullable: true },
    goal: string, note: string, revision: integer,
  }, ['id', 'studentUserId', 'displayName', 'status', 'startsOn', 'endsOn', 'goal', 'revision']),
  V2CoursePage: pageSchema(ref('V2Course')),
  V2CourseDetail: detailSchema(ref('V2Course')),
  V2CourseMutation: v2Mutation(ref('V2Course')),
  V2CourseTeacherList: strictObject({ items: array(ref('V2CourseTeacher')), total: integer }),
  V2CourseTeacherMutation: v2Mutation(ref('V2CourseTeacher')),
  V2EnrollmentList: strictObject({ items: array(ref('V2Enrollment')), total: integer }),
  V2EnrollmentDetail: detailSchema(ref('V2Enrollment')),
  V2EnrollmentMutation: v2Mutation(ref('V2Enrollment')),
  V2EnrollmentBatchRow: strictObject({ studentUserId: string, displayName: { ...string, nullable: true }, eligible: boolean, reason: { ...string, nullable: true } }),
  V2EnrollmentBatchPreview: strictObject({ courseId: string, status: { type: 'string', enum: ['invited', 'active'] }, availableSeats: integer, canApply: boolean, items: array(ref('V2EnrollmentBatchRow')) }),
  V2EnrollmentBatchResult: strictObject({ courseId: string, items: array(ref('V2Enrollment')), appliedCount: integer, changed: array(string), requestId: string }),
});

Object.assign(responseSchemas, {
  V2LessonTeacher: strictObject({ courseTeacherId: string, userId: string, displayName: string, role: enumeration(CourseTeacherRole) }),
  V2LessonParticipant: strictObject({
    enrollmentId: string, userId: string, displayName: string,
    responseStatus: enumeration(LessonResponseStatus), attendance: enumeration(LessonAttendance),
  }, ['enrollmentId', 'responseStatus', 'attendance']),
  V2Lesson: strictObject({
    id: string, courseId: string, courseTitle: string, topic: string, startAt: date, endAt: date,
    timezone: string, format: enumeration(CourseFormat), status: enumeration(LessonStatus), revision: integer,
    completedAt: { ...date, nullable: true }, legacy: boolean, legacyReadOnly: boolean, note: string, completionComment: string,
    seriesId: { ...string, nullable: true }, seriesRevision: { ...integer, nullable: true }, seriesOccurrenceKey: { ...string, nullable: true }, seriesException: boolean,
    teachers: array(ref('V2LessonTeacher')), participants: array(ref('V2LessonParticipant')),
  }, ['id', 'courseId', 'courseTitle', 'topic', 'startAt', 'endAt', 'timezone', 'format', 'status', 'revision', 'completedAt', 'legacy', 'teachers', 'participants']),
  V2LessonConflict: strictObject({ userId: string, kind: { type: 'string', enum: ['teacher', 'student'] } }),
  V2LessonPreview: strictObject({ canCreate: boolean, conflicts: array(ref('V2LessonConflict')), participantCount: integer, teacherCount: integer }),
  V2LessonPage: pageSchema(ref('V2Lesson')),
  V2LessonDetail: detailSchema(ref('V2Lesson')),
  V2LessonMutation: v2Mutation(ref('V2Lesson')),
});

Object.assign(responseSchemas, {
  V2LessonSeries: strictObject({
    id: string, courseId: string, topic: string, note: string, format: enumeration(CourseFormat),
    startsAtLocal: string, untilLocalDate: string, timezone: string, frequency: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
    interval: integer, weekdays: array(integer), monthDays: array(integer), excludedDates: array(string), durationMinutes: integer, materializeDays: integer,
    dstDisambiguation: { type: 'string', enum: ['reject', 'earlier', 'later'] }, teacherLinkIds: array(string), participantEnrollmentIds: array(string),
    status: { type: 'string', enum: ['active', 'paused', 'canceled', 'completed'] }, revision: integer, generation: integer, materializedThrough: { ...date, nullable: true },
    failures: integer, lastErrorCode: string, nextRunAt: date, ...timestamps,
  }),
  V2SeriesOccurrence: strictObject({ key: string, localStart: string, startAt: date, endAt: date }),
  V2SeriesIssue: strictObject({ occurrenceKey: string, code: string, conflicts: array(ref('V2LessonConflict')) }, ['occurrenceKey', 'code']),
  V2LessonSeriesPreview: strictObject({ operation: string, canApply: boolean, occurrences: array(ref('V2SeriesOccurrence')),
    cancelLessons: array(strictObject({ id: string, revision: integer, startAt: date })), preservedCount: integer, issues: array(ref('V2SeriesIssue')),
    through: date, previewToken: string, expiresAt: date }),
  V2LessonSeriesPage: pageSchema(ref('V2LessonSeries')),
  V2LessonSeriesDetail: detailSchema(ref('V2LessonSeries')),
  V2LessonSeriesMutation: strictObject({ item: ref('V2LessonSeries'), createdCount: integer, canceledCount: integer, changed: array(string), requestId: string }),
});

const nullableDate = { ...date, nullable: true };
const historical = { type: 'object', additionalProperties: true } as SchemaObject;
const historicalArray = array(historical);
const workFile = strictObject({ id: string, originalName: string, mimeType: string, size: integer, checksum: { ...string, nullable: true }, uploadedAt: date });
const assignmentProperties = {
  id: string, courseId: string, courseTitle: string, programVersionId: string,
  title: string, instructions: string, taskDefinitionIds: array(string), tasks: array(ref('V2AssignmentTask')),
  dueAt: date, status: enumeration(AssignmentStatus), revision: integer,
  publishedAt: nullableDate, closedAt: nullableDate, closeReason: string, legacy: boolean, legacyReadOnly: boolean,
  legacyState: historical, legacyMaterials: historicalArray, files: array(ref('V2WorkFile')),
};
const assignmentRequired = Object.keys(assignmentProperties).filter(key => !key.startsWith('legacy'));
Object.assign(responseSchemas, {
  V2WorkFile: workFile,
  V2AssignmentTask: strictObject({ id: string, code: string, title: string, maxScore: { ...integer, nullable: true }, criteria: array(ref('V2TaskCriterion')) }),
  V2Assignment: strictObject(assignmentProperties, assignmentRequired),
  V2AssignmentDetailItem: strictObject({ ...assignmentProperties, canReview: boolean }, [...assignmentRequired, 'canReview']),
  V2AssignmentRecipient: strictObject({ id: string, assignmentId: string, enrollmentId: string, dueAt: date,
    status: enumeration(AssignmentRecipientStatus), reason: string, revision: integer, overdue: boolean, displayName: string },
  ['id', 'assignmentId', 'enrollmentId', 'dueAt', 'status', 'reason', 'revision', 'overdue']),
  V2ReviewScore: strictObject({ taskDefinitionId: string, criterionCode: string, score: integer }, ['taskDefinitionId', 'score']),
  V2AssignmentReview: strictObject({ id: string, submissionId: string, number: integer, revision: integer,
    status: enumeration(AssignmentReviewStatus), decision: enumeration(AssignmentReviewDecision), comment: string,
    scores: array(ref('V2ReviewScore')), reason: string, reviewerUserId: { ...string, nullable: true }, source: string,
    createdAt: date, publishedAt: nullableDate, legacyMaterials: historicalArray, files: array(ref('V2WorkFile')) }),
  V2AssignmentSubmission: strictObject({ id: string, recipientId: string, attempt: integer, text: string,
    contentSnapshot: historical, submittedAt: date, late: boolean, files: array(ref('V2WorkFile')),
    reviews: array(ref('V2AssignmentReview')) }),
  V2LearningMaterial: strictObject({ id: string, programVersionId: string, programName: string, subjectName: string,
    taskDefinitionIds: array(string), title: string, description: string, url: string,
    file: { allOf: [ref('V2WorkFile')], nullable: true }, legacy: boolean, legacyReadOnly: boolean, legacyState: historical,
    revision: integer, archivedAt: nullableDate, createdAt: date },
  ['id', 'programVersionId', 'programName', 'subjectName', 'taskDefinitionIds', 'title', 'description', 'url', 'file', 'legacy', 'revision', 'archivedAt', 'createdAt']),
  V2MaterialPublication: strictObject({ id: string, courseId: string, lessonId: { ...string, nullable: true }, revision: integer,
    publishedAt: date, revokedAt: nullableDate, recipientEnrollmentIds: array(string) }),
  V2MaterialDetailItem: strictObject({ id: string, programVersionId: string, programName: string, subjectName: string,
    taskDefinitionIds: array(string), title: string, description: string, url: string,
    file: { allOf: [ref('V2WorkFile')], nullable: true }, legacy: boolean, legacyReadOnly: boolean, legacyState: historical,
    revision: integer, archivedAt: nullableDate, createdAt: date, canEdit: boolean, canArchive: boolean,
    publications: array(ref('V2MaterialPublication')) },
  ['id', 'programVersionId', 'programName', 'subjectName', 'taskDefinitionIds', 'title', 'description', 'url', 'file', 'legacy', 'revision', 'archivedAt', 'createdAt', 'canEdit', 'canArchive', 'publications']),
  V2AssignmentPage: pageSchema(ref('V2Assignment')),
  V2AssignmentDetail: detailSchema(ref('V2AssignmentDetailItem')),
  V2AssignmentMutation: v2Mutation(ref('V2Assignment')),
  V2AssignmentRecipientPage: pageSchema(ref('V2AssignmentRecipient')),
  V2AssignmentRecipientMutation: v2Mutation(ref('V2AssignmentRecipient')),
  V2AssignmentSubmissionPage: pageSchema(ref('V2AssignmentSubmission')),
  V2AssignmentReviewMutation: v2Mutation(ref('V2AssignmentReview')),
  V2LearningMaterialPage: pageSchema(ref('V2LearningMaterial')),
  V2LearningMaterialDetail: detailSchema(ref('V2MaterialDetailItem')),
  V2LearningMaterialMutation: v2Mutation(ref('V2LearningMaterial')),
  V2WorkFileMutation: v2Mutation(ref('V2WorkFile')),
  V2WorkFileDeletion: v2Mutation(strictObject({ id: string })),
});

Object.assign(responseSchemas, {
  V2ProgressEvidence: strictObject({ lessonId: { ...string, nullable: true }, attendance: enumeration(LessonAttendance), reviewId: string,
    submissionId: string, assignmentId: string, recipientId: string, decision: enumeration(AssignmentReviewDecision), legacySource: enumeration(C.PROGRESS_SOURCE) }, []),
  V2ProgressEvent: strictObject({ id: string, enrollmentId: string, taskDefinitionId: { ...string, nullable: true },
    source: enumeration(LearningProgressSource), kind: enumeration(LearningProgressKind), authorUserId: { ...string, nullable: true }, authorName: { ...string, nullable: true },
    visibility: enumeration(LearningVisibility), score: { ...integer, nullable: true }, maxScore: { ...integer, nullable: true },
    coverageStatus: enumeration(ProgressCoverageStatus, true), masteryLevel: enumeration(ProgressMasteryLevel, true), comment: string, basis: string,
    reason: string, evidence: ref('V2ProgressEvidence'), supersedesId: { ...string, nullable: true }, replacedById: { ...string, nullable: true }, occurredAt: date, recordedAt: date }),
  V2ProgressTask: strictObject({ taskDefinitionId: string, code: string, title: string, maxScore: { ...integer, nullable: true },
    event: nullableRef('V2ProgressEvent'), privateEvents: array(ref('V2ProgressEvent')) }),
  V2EnrollmentProgress: strictObject({ enrollmentId: string, courseId: string, courseTitle: string, programVersionId: string,
    studentUserId: string, studentName: string, algorithmVersion: string, asOf: date, tasks: array(ref('V2ProgressTask')) }),
  V2ProgressDetail: detailSchema(ref('V2EnrollmentProgress')),
  V2ProgressEventPage: v2Page(ref('V2ProgressEvent')),
  V2ProgressEventMutation: v2Mutation(ref('V2ProgressEvent')),
  V2ProgramProgressDetail: detailSchema(strictObject({ studentUserId: string, programVersionId: string, algorithmVersion: string, asOf: date, courses: array(ref('V2EnrollmentProgress')) })),
  V2LearningNotification: strictObject({ id: string, type: string, title: string, message: string, targetType: string, targetId: string,
    readAt: nullableDate, status: { type: 'string', enum: ['unread', 'read'] }, revision: integer, createdAt: date }),
  V2LearningNotificationPage: strictObject({ items: array(ref('V2LearningNotification')), pageInfo: v2PageInfo, unreadCount: integer, asOf: date }),
  V2LearningNotificationMutation: v2Mutation(ref('V2LearningNotification')),
  V2LearningNotificationReadAll: v2Mutation(strictObject({ updatedCount: integer })),
  V2LearningTargetDetail: detailSchema(strictObject({ type: string, id: string, title: string, courseId: { ...string, nullable: true }, enrollmentId: { ...string, nullable: true } })),
  V2NotificationPreferenceDetail: detailSchema(strictObject({ emailEnabled: boolean, updatedAt: nullableDate })),
  V2NotificationPreferenceMutation: v2Mutation(strictObject({ emailEnabled: boolean, updatedAt: date })),
  V2LearningDelivery: strictObject({ id: string, notificationId: string, recipientUserId: string, type: string, status: enumeration(LearningDeliveryStatus),
    attempts: integer, availableAt: date, lockedUntil: nullableDate, lastErrorCode: string, provider: string, deliveredAt: nullableDate, revision: integer, createdAt: date }),
  V2LearningDeliveryPage: v2Page(ref('V2LearningDelivery')),
  V2LearningDeliveryRetry: v2Mutation(strictObject({ id: string, status: enumeration(LearningDeliveryStatus), revision: integer })),
});
