import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AppError } from '../common/app-error';
import { AuthUser, CurrentUser } from '../common/current-user';
import { WorkspaceContextService } from '../workspace/workspace-context.service';
import { CoursesService } from './courses.service';
import { AddCourseTeacherDto, CourseQueryDto, CreateCourseDto, CreateEnrollmentDto, EnrollmentBatchDto, UpdateCourseDto, UpdateCourseTeacherDto, UpdateEnrollmentDto } from './courses.dto';

type RequestWithId = Request & { requestId?: string };
function revision(value?: string) {
  const normalized = String(value || '').replace(/^"|"$/g, '');
  if (!normalized) throw new AppError(428, 'precondition_required', 'Нужен заголовок If-Match.');
  if (!/^\d+$/.test(normalized)) throw new AppError(400, 'invalid_revision', 'Некорректная ревизия.');
  return Number(normalized);
}

@ApiTags('v2-courses')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Active-Role', required: true, enum: ['admin', 'teacher', 'student'] })
@Controller('api/v2/workspaces/:workspaceId/courses')
export class CoursesController {
  constructor(private readonly courses: CoursesService, private readonly contexts: WorkspaceContextService) {}

  private ctx(user: AuthUser, workspaceId: string, role: string, req: RequestWithId) {
    return this.contexts.resolve(user, workspaceId, role, req.requestId || '');
  }

  @Get() @ApiOkResponse({ description: 'Accessible courses, paged.' })
  async list(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Query() query: CourseQueryDto) {
    return this.courses.list(await this.ctx(user, w, role, req), query);
  }

  @Post() @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: true })
  async create(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Headers('idempotency-key') key: string, @Body() body: CreateCourseDto) {
    return this.courses.create(await this.ctx(user, w, role, req), body, key);
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('id') id: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId) {
    return this.courses.get(await this.ctx(user, w, role, req), id);
  }

  @Patch(':id') @ApiHeader({ name: 'If-Match', required: true })
  async update(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('id') id: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Headers('if-match') match: string, @Body() body: UpdateCourseDto) {
    return this.courses.update(await this.ctx(user, w, role, req), id, body, revision(match));
  }

  @Post(':id/activate') @HttpCode(200) @ApiHeader({ name: 'If-Match', required: true }) @ApiBody({ schema: { type: 'object', additionalProperties: false } })
  async activate(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('id') id: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Headers('if-match') match: string) {
    return this.courses.transition(await this.ctx(user, w, role, req), id, 'activate', revision(match));
  }

  @Post(':id/pause') @HttpCode(200) @ApiHeader({ name: 'If-Match', required: true }) @ApiBody({ schema: { type: 'object', additionalProperties: false } })
  async pause(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('id') id: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Headers('if-match') match: string) {
    return this.courses.transition(await this.ctx(user, w, role, req), id, 'pause', revision(match));
  }

  @Post(':id/complete') @HttpCode(200) @ApiHeader({ name: 'If-Match', required: true }) @ApiBody({ schema: { type: 'object', additionalProperties: false } })
  async complete(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('id') id: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Headers('if-match') match: string) {
    return this.courses.transition(await this.ctx(user, w, role, req), id, 'complete', revision(match));
  }

  @Post(':id/archive') @HttpCode(200) @ApiHeader({ name: 'If-Match', required: true }) @ApiBody({ schema: { type: 'object', additionalProperties: false } })
  async archive(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('id') id: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Headers('if-match') match: string) {
    return this.courses.transition(await this.ctx(user, w, role, req), id, 'archive', revision(match));
  }

  @Get(':id/teachers')
  async teachers(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('id') id: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId) {
    return this.courses.teachers(await this.ctx(user, w, role, req), id);
  }

  @Post(':id/teachers') @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: true })
  async addTeacher(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('id') id: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Headers('idempotency-key') key: string, @Body() body: AddCourseTeacherDto) {
    return this.courses.addTeacher(await this.ctx(user, w, role, req), id, body, key);
  }

  @Patch(':id/teachers/:linkId') @ApiHeader({ name: 'If-Match', required: true })
  async updateTeacher(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('id') id: string, @Param('linkId') linkId: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Headers('if-match') match: string, @Body() body: UpdateCourseTeacherDto) {
    return this.courses.updateTeacher(await this.ctx(user, w, role, req), id, linkId, body, revision(match));
  }

  @Get(':id/enrollments')
  async enrollments(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('id') id: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId) {
    return this.courses.enrollments(await this.ctx(user, w, role, req), id);
  }

  @Post(':id/enrollments') @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: true })
  async addEnrollment(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('id') id: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Headers('idempotency-key') key: string, @Body() body: CreateEnrollmentDto) {
    return this.courses.addEnrollment(await this.ctx(user, w, role, req), id, body, key);
  }

  @Get(':id/enrollments/:enrollmentId')
  async enrollment(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('id') id: string, @Param('enrollmentId') enrollmentId: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId) {
    return this.courses.enrollment(await this.ctx(user, w, role, req), id, enrollmentId);
  }

  @Patch(':id/enrollments/:enrollmentId') @ApiHeader({ name: 'If-Match', required: true })
  async updateEnrollment(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('id') id: string, @Param('enrollmentId') enrollmentId: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Headers('if-match') match: string, @Body() body: UpdateEnrollmentDto) {
    return this.courses.updateEnrollment(await this.ctx(user, w, role, req), id, enrollmentId, body, revision(match));
  }
}

@ApiTags('v2-enrollment-batches')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Active-Role', required: true, enum: ['admin'] })
@Controller('api/v2/workspaces/:workspaceId/enrollment-batches')
export class EnrollmentBatchesController {
  constructor(private readonly courses: CoursesService, private readonly contexts: WorkspaceContextService) {}

  @Post('preview') @HttpCode(200)
  async preview(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Body() body: EnrollmentBatchDto) {
    return this.courses.previewBatch(await this.contexts.resolve(user, w, role, req.requestId || ''), body);
  }

  @Post() @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: true })
  async apply(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Headers('idempotency-key') key: string, @Body() body: EnrollmentBatchDto) {
    return this.courses.applyBatch(await this.contexts.resolve(user, w, role, req.requestId || ''), body, key);
  }
}
