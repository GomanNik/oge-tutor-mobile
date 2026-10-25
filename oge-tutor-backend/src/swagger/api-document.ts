import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject, OperationObject, ReferenceObject, RequestBodyObject, SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import * as Auth from '../auth/auth.dto';
import * as Attachments from '../common/attachment.dto';
import * as Settings from '../common/settings.dto';
import * as Files from '../files/files.dto';
import * as Homeworks from '../homeworks/homeworks.dto';
import * as Lessons from '../lessons/lessons.dto';
import * as Materials from '../materials/materials.dto';
import * as Progress from '../progress/progress.dto';
import * as Students from '../students/students.dto';
import * as Teacher from '../teacher/teacher.dto';
import * as Workspace from '../workspace/workspace.dto';
import * as ProgramCatalog from '../program-catalog/program-catalog.dto';
import * as Courses from '../courses/courses.dto';
import * as CourseLessons from '../course-lessons/course-lessons.dto';
import { collectionSchemas, object, ref, responseSchemas } from './response-schemas';

const requestModels = [
  ...Object.values(Auth), ...Object.values(Attachments), ...Object.values(Settings),
  ...Object.values(Files), ...Object.values(Homeworks), ...Object.values(Lessons),
  ...Object.values(Materials), ...Object.values(Progress), ...Object.values(Students), ...Object.values(Teacher),
  ...Object.values(Workspace), ...Object.values(ProgramCatalog), ...Object.values(Courses), ...Object.values(CourseLessons),
];
const publicPaths = new Set(['/health', '/health/ready', '/auth/login', '/auth/password-reset', '/auth/access-token/verify', '/auth/access-token/complete', '/api/v2/auth/login', '/api/v2/invitations/accept-new']);
const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;

export interface OperationContract {
  response: string | SchemaObject;
  request?: string;
  multipart?: boolean;
  public?: boolean;
  description?: string;
}
export type OperationContracts = Record<string, OperationContract>;

const contracts: OperationContracts = {
  'get /health': { response: 'HealthResponse' },
  'get /health/ready': { response: 'ReadyResponse' },
  'get /bootstrap': { response: 'BootstrapResponse' },
  'post /auth/login': { request: 'LoginDto', response: 'BootstrapResponse' },
  'post /auth/logout': { response: 'LogoutResponse' },
  'post /auth/password-reset': { request: 'PasswordResetDto', response: 'PasswordResetResponse' },
  'post /auth/access-token/verify': { request: 'AccessTokenVerifyDto', response: 'AccessTokenVerified' },
  'post /auth/access-token/complete': { request: 'AccessTokenCompleteDto', response: 'OkResponse' },
  'post /files': { request: 'UploadFileMetaDto', response: 'FileUploadResponse', multipart: true },
  'post /notifications/read-all': { response: 'MutationResponse' },
};
const mutationRequests: Record<string, string> = {
  'post /students': 'CreateStudentDto',
  'patch /students/{}/profile': 'UpdateStudentProfileDto',
  'patch /students/{}/account': 'UpdateStudentAccountDto',
  'patch /students/{}/notifications': 'UpdateStudentNotificationsDto',
  'post /students/{}/access': 'UpdateAccessDto',
  'post /students/{}/security/password': 'ChangeStudentPasswordDto',
  'patch /teacher/profile': 'UpdateTeacherProfileDto',
  'patch /teacher/account': 'UpdateTeacherAccountDto',
  'patch /teacher/notifications': 'UpdateTeacherNotificationsDto',
  'post /teacher/security/password': 'ChangeTeacherPasswordDto',
  'post /lessons': 'CreateLessonDto',
  'patch /lessons/{}': 'UpdateLessonDto',
  'post /lessons/{}/complete': 'CompleteLessonDto',
  'post /homeworks': 'CreateHomeworkDto',
  'patch /homeworks/{}': 'UpdateHomeworkDto',
  'post /homeworks/{}/submissions': 'SubmitHomeworkDto',
  'post /homeworks/{}/review': 'ReviewHomeworkDto',
  'post /materials': 'AddMaterialDto',
  'patch /materials/{}/files/{}': 'UpdateMaterialFileDto',
  'patch /students/{}/progress': 'ReplaceProgressDto',
  'patch /students/{}/progress/tasks/{}': 'UpdateTaskProgressDto',
  'post /students/{}/progress/tasks/{}/assessment': 'ResolveAssessmentDto',
};
const workspaceContracts: OperationContracts = {
  'post /api/v2/auth/login': { request: 'V2LoginDto', response: 'V2LoginResponse' },
  'get /api/v2/me': { response: 'V2UserDetail' },
  'patch /api/v2/me': { request: 'UpdateMeDto', response: 'V2UserMutation' },
  'get /api/v2/me/workspaces': { response: 'V2ContextsPage' },
  'get /api/v2/workspaces/{}': { response: 'V2WorkspaceDetail' },
  'get /api/v2/workspaces/{}/members': { response: 'V2MemberPage' },
  'get /api/v2/workspaces/{}/members/{}': { response: 'V2MemberDetail' },
  'patch /api/v2/workspaces/{}/members/{}': { request: 'UpdateLocalNameDto', response: 'V2MemberMutation' },
  'post /api/v2/workspaces/{}/members/{}/roles': { request: 'GrantRoleDto', response: 'V2MemberMutation' },
  'post /api/v2/workspaces/{}/members/{}/roles/{}/revoke': { request: 'ReasonDto', response: 'V2MemberMutation' },
  'post /api/v2/workspaces/{}/members/{}/suspend': { request: 'ReasonDto', response: 'V2MemberMutation' },
  'post /api/v2/workspaces/{}/members/{}/resume': { request: 'ReasonDto', response: 'V2MemberMutation' },
  'get /api/v2/workspaces/{}/invitations': { response: 'V2InvitationPage' },
  'post /api/v2/workspaces/{}/invitations': { request: 'CreateInvitationDto', response: 'V2InvitationMutation' },
  'post /api/v2/workspaces/{}/invitations/{}/resend': { request: 'OptionalReasonDto', response: 'V2InvitationMutation' },
  'post /api/v2/workspaces/{}/invitations/{}/revoke': { request: 'OptionalReasonDto', response: 'V2InvitationMutation' },
  'get /api/v2/workspaces/{}/audit-events': { response: 'V2AuditPage' },
  'post /api/v2/invitations/accept-new': { request: 'AcceptNewInvitationDto', response: 'V2LoginResponse' },
  'post /api/v2/invitations/accept-existing': { request: 'AcceptExistingInvitationDto', response: 'V2MemberDetail' },
};
Object.assign(contracts, workspaceContracts);
Object.assign(contracts, {
  'get /api/v2/subjects': { response: 'V2SubjectPage' },
  'get /api/v2/subjects/{}': { response: 'V2SubjectDetail' },
  'post /api/v2/subjects': { request: 'CreateSubjectDto', response: 'V2SubjectMutation' },
  'patch /api/v2/subjects/{}': { request: 'UpdateSubjectDto', response: 'V2SubjectMutation' },
  'post /api/v2/subjects/{}/archive': { response: 'V2SubjectMutation' },
  'get /api/v2/programs': { response: 'V2ProgramPage' },
  'get /api/v2/programs/{}': { response: 'V2ProgramDetail' },
  'post /api/v2/programs': { request: 'CreateProgramDto', response: 'V2ProgramMutation' },
  'patch /api/v2/programs/{}': { request: 'UpdateProgramDto', response: 'V2ProgramMutation' },
  'post /api/v2/programs/{}/archive': { response: 'V2ProgramMutation' },
  'get /api/v2/programs/{}/versions': { response: 'V2ProgramVersionPage' },
  'post /api/v2/programs/{}/versions': { request: 'CreateProgramVersionDto', response: 'V2ProgramVersionMutation' },
  'get /api/v2/program-versions/{}': { response: 'V2ProgramVersionDetail' },
  'patch /api/v2/program-versions/{}': { request: 'UpdateProgramVersionDto', response: 'V2ProgramVersionMutation' },
  'post /api/v2/program-versions/{}/publish': { response: 'V2ProgramVersionMutation' },
  'post /api/v2/program-versions/{}/archive': { response: 'V2ProgramVersionMutation' },
  'get /api/v2/program-versions/{}/tasks': { response: 'V2TaskDefinitionPage' },
  'post /api/v2/program-versions/{}/tasks': { request: 'TaskInputDto', response: 'V2TaskDefinitionMutation' },
  'patch /api/v2/program-versions/{}/tasks/{}': { request: 'TaskInputDto', response: 'V2TaskDefinitionMutation' },
  'delete /api/v2/program-versions/{}/tasks/{}': { response: 'V2TaskDeletion' },
  'post /api/v2/program-versions/{}/scoring-rule': { request: 'ScoringRuleDto', response: 'V2ScoringRuleMutation' },
  'get /api/v2/task-mappings': { response: 'V2TaskMappingPage' },
  'post /api/v2/task-mappings': { request: 'CreateTaskMappingDto', response: 'V2TaskMappingMutation' },
  'post /api/v2/task-mappings/{}/revoke': { request: 'RevokeTaskMappingDto', response: 'V2TaskMappingMutation' },
} satisfies OperationContracts);
Object.assign(contracts, {
  'get /api/v2/workspaces/{}/courses': { response: 'V2CoursePage' },
  'post /api/v2/workspaces/{}/courses': { request: 'CreateCourseDto', response: 'V2CourseMutation' },
  'get /api/v2/workspaces/{}/courses/{}': { response: 'V2CourseDetail' },
  'patch /api/v2/workspaces/{}/courses/{}': { request: 'UpdateCourseDto', response: 'V2CourseMutation' },
  'post /api/v2/workspaces/{}/courses/{}/activate': { response: 'V2CourseMutation' },
  'post /api/v2/workspaces/{}/courses/{}/pause': { response: 'V2CourseMutation' },
  'post /api/v2/workspaces/{}/courses/{}/complete': { response: 'V2CourseMutation' },
  'post /api/v2/workspaces/{}/courses/{}/archive': { response: 'V2CourseMutation' },
  'get /api/v2/workspaces/{}/courses/{}/teachers': { response: 'V2CourseTeacherList' },
  'post /api/v2/workspaces/{}/courses/{}/teachers': { request: 'AddCourseTeacherDto', response: 'V2CourseTeacherMutation' },
  'patch /api/v2/workspaces/{}/courses/{}/teachers/{}': { request: 'UpdateCourseTeacherDto', response: 'V2CourseTeacherMutation' },
  'get /api/v2/workspaces/{}/courses/{}/enrollments': { response: 'V2EnrollmentList' },
  'post /api/v2/workspaces/{}/courses/{}/enrollments': { request: 'CreateEnrollmentDto', response: 'V2EnrollmentMutation' },
  'get /api/v2/workspaces/{}/courses/{}/enrollments/{}': { response: 'V2EnrollmentDetail' },
  'patch /api/v2/workspaces/{}/courses/{}/enrollments/{}': { request: 'UpdateEnrollmentDto', response: 'V2EnrollmentMutation' },
  'post /api/v2/workspaces/{}/enrollment-batches/preview': { request: 'EnrollmentBatchDto', response: 'V2EnrollmentBatchPreview' },
  'post /api/v2/workspaces/{}/enrollment-batches': { request: 'EnrollmentBatchDto', response: 'V2EnrollmentBatchResult' },
} satisfies OperationContracts);
Object.assign(contracts, {
  'get /api/v2/workspaces/{}/lessons': { response: 'V2LessonPage' },
  'post /api/v2/workspaces/{}/lessons/preview': { request: 'CreateCourseLessonDto', response: 'V2LessonPreview' },
  'post /api/v2/workspaces/{}/lessons': { request: 'CreateCourseLessonDto', response: 'V2LessonMutation' },
  'get /api/v2/workspaces/{}/lessons/{}': { response: 'V2LessonDetail' },
  'patch /api/v2/workspaces/{}/lessons/{}': { request: 'UpdateCourseLessonDto', response: 'V2LessonMutation' },
  'post /api/v2/workspaces/{}/lessons/{}/cancel': { request: 'CancelCourseLessonDto', response: 'V2LessonMutation' },
  'post /api/v2/workspaces/{}/lessons/{}/complete': { request: 'CompleteCourseLessonDto', response: 'V2LessonMutation' },
  'post /api/v2/workspaces/{}/lessons/{}/attendance-corrections': { request: 'CorrectLessonAttendanceDto', response: 'V2LessonMutation' },
} satisfies OperationContracts);
for (const [key, request] of Object.entries(mutationRequests)) {
  contracts[key] = { request, response: key.endsWith('/security/password') ? 'OkResponse' : 'MutationResponse', multipart: key.endsWith('/submissions') };
}
contracts['delete /materials/{}/files/{}'] = { response: 'MutationResponse' };

function routeContract(method: string, path: string): OperationContract | undefined {
  const key = `${method} ${path.replace(/\{[^}]+\}/g, '{}')}`;
  if (contracts[key]) return contracts[key];
  if (method === 'get') {
    if (/^\/students\/\{[^}]+\}\/progress\/history$/.test(path)) return { response: 'ProgressHistoryPage' };
    const parts = path.split('/').filter(Boolean);
    const resource = collectionSchemas[parts[0]];
    if (resource && parts.length <= 2) return { response: `${resource}${parts.length === 1 ? 'Page' : 'Detail'}` };
  }
  if (method === 'patch' && /^\/notifications\/\{[^}]+\}$/.test(path)) return { response: 'MutationResponse' };
  return undefined;
}

function jsonResponse(schema: SchemaObject | ReferenceObject, description: string) {
  return { description, content: { 'application/json': { schema } } };
}

/** Augment discovered routes; overrides let new endpoints reuse envelopes without controller churn. */
export function augmentApiDocument(document: OpenAPIObject, overrides: OperationContracts = {}): OpenAPIObject {
  document.components ??= {};
  document.components.schemas = { ...document.components.schemas, ...responseSchemas };
  for (const model of requestModels) {
    const schema = document.components.schemas[model.name];
    if (schema && !('$ref' in schema)) schema.additionalProperties = false;
  }
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const method of methods) {
      const operation = pathItem[method] as OperationObject | undefined;
      if (!operation) continue;
      const contract = overrides[`${method} ${path}`] || routeContract(method, path);
      const isPublic = contract?.public ?? publicPaths.has(path);
      operation.security = isPublic ? [] : [{ bearer: [] }];
      operation.tags ??= [path.split('/')[1]];
      if (contract?.description) operation.description = contract.description;
      operation.parameters ??= [];
      if (!operation.parameters.some(p => !('$ref' in p) && p.in === 'header' && p.name === 'x-request-id')) {
        operation.parameters.push({ name: 'x-request-id', in: 'header', required: false, schema: { type: 'string' }, description: 'Optional correlation identifier, echoed in error responses.' });
      }
      if (path.startsWith('/api/v2/') && method !== 'get') {
        const isRevisionMutation = method === 'patch' || /\/(revoke|suspend|resume|resend|archive|publish|activate|pause|complete)$/.test(path)
          || /\/program-versions\/[^/]+\/tasks(?:\/[^/]+)?$/.test(path) || /\/program-versions\/[^/]+\/scoring-rule$/.test(path);
        const isIdempotentMutation = /\/invitations$|\/roles$/.test(path) || /\/api\/v2\/(subjects|programs|task-mappings)$/.test(path)
          || /\/api\/v2\/programs\/[^/]+\/versions$/.test(path)
          || /\/api\/v2\/workspaces\/[^/]+\/courses(?:\/[^/]+\/(?:teachers|enrollments))?$/.test(path)
          || /\/api\/v2\/workspaces\/[^/]+\/enrollment-batches$/.test(path);
        if (isRevisionMutation) operation.parameters.push({ name: 'If-Match', in: 'header', required: true, schema: { type: 'integer', minimum: 0 }, description: 'Expected resource revision.' });
        if (isIdempotentMutation) operation.parameters.push({ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 1, maxLength: 128 } });
      }
      for (const parameter of operation.parameters) {
        if ('$ref' in parameter || parameter.in !== 'path') continue;
        parameter.required = true;
        parameter.schema = parameter.name === 'taskNumber'
          ? { type: 'integer', minimum: 1, maximum: 25 }
          : { type: 'string', minLength: 1 };
      }
      if (contract?.request) {
        let schema: SchemaObject | ReferenceObject = ref(contract.request);
        let contentType = 'application/json';
        if (contract.multipart) {
          const metadata = document.components.schemas[contract.request];
          schema = object({
            ...(metadata && !('$ref' in metadata) ? metadata.properties : {}),
            file: { type: 'string', format: 'binary' },
          }, ['file']);
          schema.additionalProperties = false;
          contentType = 'multipart/form-data';
        }
        operation.requestBody = { required: true, content: { [contentType]: { schema } } } satisfies RequestBodyObject;
      }
      const successCodes = Object.keys(operation.responses).filter(code => /^2\d\d$/.test(code));
      if (contract) {
        for (const code of successCodes.length ? successCodes : [method === 'post' ? '201' : '200']) {
          operation.responses[code] = jsonResponse(typeof contract.response === 'string' ? ref(contract.response) : contract.response, 'Successful response.');
        }
      }
      if (method === 'get' && /^\/files\/\{[^}]+\}\/download$/.test(path)) {
        operation.responses['200'] = { description: 'Authorized file download; Content-Type is the stored MIME type.', headers: { 'Content-Disposition': { schema: { type: 'string' } } }, content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } };
      }
      const errors: Record<string, string> = { '400': 'DTO or request validation failed.', '422': 'Domain validation failed.', '429': 'Rate limit exceeded.', '500': 'Unexpected server error.' };
      if (!isPublic) Object.assign(errors, { '401': 'Missing, expired, or revoked session.', '403': 'Insufficient access.', '404': 'Resource not found.' });
      if (path === '/auth/login' || path === '/api/v2/auth/login') errors['401'] = 'Invalid credentials or unavailable account.';
      if (method !== 'get') errors['409'] = 'State, uniqueness, or concurrency conflict.';
      if (path.startsWith('/api/v2/') && (method === 'patch' || method === 'delete' || /\/(revoke|suspend|resume|resend|archive|publish|activate|pause|complete|cancel|attendance-corrections|tasks|scoring-rule)$/.test(path))) {
        errors['412'] = 'Revision mismatch.';
        errors['428'] = 'If-Match header is required.';
      }
      if (path.startsWith('/auth/access-token/')) errors['403'] = 'Account access disabled.';
      if (contract?.multipart) errors['413'] = 'Upload exceeds configured size limit.';
      if (path === '/health/ready') errors['503'] = 'Service not ready.';
      for (const [status, description] of Object.entries(errors)) {
        operation.responses[status] = jsonResponse(ref('ApiError'), description);
      }
    }
  }
  return document;
}

export function createApiDocument(app: INestApplication, overrides: OperationContracts = {}): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('OGE Tutor Backend API')
    .setDescription('Authenticated tutoring API. Lists are paginated; mutations return changed resources. DTO validation errors use HTTP 400; domain validation uses HTTP 422.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  return augmentApiDocument(SwaggerModule.createDocument(app, config, { extraModels: requestModels }), overrides);
}
