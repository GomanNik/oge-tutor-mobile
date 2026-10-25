import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AppError } from '../common/app-error';
import { AuthUser, CurrentUser } from '../common/current-user';
import { WorkspaceContextService } from '../workspace/workspace-context.service';
import { CancelCourseLessonDto, CompleteCourseLessonDto, CorrectLessonAttendanceDto, CreateCourseLessonDto, LessonCalendarQueryDto, UpdateCourseLessonDto } from './course-lessons.dto';
import { CourseLessonsService } from './course-lessons.service';

type RequestWithId = Request & { requestId?: string };
function revision(value?: string) {
  const normalized = String(value || '').replace(/^"|"$/g, '');
  if (!normalized) throw new AppError(428, 'precondition_required', 'Нужен заголовок If-Match.');
  if (!/^\d+$/.test(normalized)) throw new AppError(400, 'invalid_revision', 'Некорректная ревизия.');
  return Number(normalized);
}

@ApiTags('v2-lessons')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Active-Role', required: true, enum: ['admin', 'teacher', 'student'] })
@Controller('api/v2/workspaces/:workspaceId/lessons')
export class CourseLessonsController {
  constructor(private readonly lessons: CourseLessonsService, private readonly contexts: WorkspaceContextService) {}

  private ctx(user: AuthUser, workspaceId: string, role: string, req: RequestWithId) {
    return this.contexts.resolve(user, workspaceId, role, req.requestId || '');
  }

  @Get()
  async list(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Query() query: LessonCalendarQueryDto) {
    return this.lessons.list(await this.ctx(user, w, role, req), query);
  }

  @Post('preview') @HttpCode(200)
  async preview(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Body() body: CreateCourseLessonDto) {
    return this.lessons.preview(await this.ctx(user, w, role, req), body);
  }

  @Post() @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: true })
  async create(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Headers('idempotency-key') key: string, @Body() body: CreateCourseLessonDto) {
    return this.lessons.create(await this.ctx(user, w, role, req), body, key);
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('id') id: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId) {
    return this.lessons.get(await this.ctx(user, w, role, req), id);
  }

  @Patch(':id') @ApiHeader({ name: 'If-Match', required: true })
  async update(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('id') id: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Headers('if-match') match: string, @Body() body: UpdateCourseLessonDto) {
    return this.lessons.update(await this.ctx(user, w, role, req), id, body, revision(match));
  }

  @Post(':id/cancel') @HttpCode(200) @ApiHeader({ name: 'If-Match', required: true })
  async cancel(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('id') id: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Headers('if-match') match: string, @Body() body: CancelCourseLessonDto) {
    return this.lessons.cancel(await this.ctx(user, w, role, req), id, body, revision(match));
  }

  @Post(':id/complete') @HttpCode(200) @ApiHeader({ name: 'If-Match', required: true })
  async complete(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('id') id: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Headers('if-match') match: string, @Body() body: CompleteCourseLessonDto) {
    return this.lessons.complete(await this.ctx(user, w, role, req), id, body, revision(match));
  }

  @Post(':id/attendance-corrections') @HttpCode(200) @ApiHeader({ name: 'If-Match', required: true })
  async correct(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('id') id: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Headers('if-match') match: string, @Body() body: CorrectLessonAttendanceDto) {
    return this.lessons.correctAttendance(await this.ctx(user, w, role, req), id, body, revision(match));
  }
}
