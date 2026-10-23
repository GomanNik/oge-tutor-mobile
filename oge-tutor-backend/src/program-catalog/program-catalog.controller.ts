import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOkResponse, ApiTags, type ApiResponseNoStatusOptions } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthUser, CurrentUser } from '../common/current-user';
import { AppError } from '../common/app-error';
import { ProgramCatalogService } from './program-catalog.service';
import {
  CatalogQueryDto, CreateProgramDto, CreateProgramVersionDto, CreateSubjectDto,
  CreateTaskMappingDto, RevokeTaskMappingDto, ScoringRuleDto, TaskInputDto, UpdateProgramDto,
  UpdateProgramVersionDto, UpdateSubjectDto,
} from './program-catalog.dto';

type RequestWithId = Request & { requestId?: string };
const actor = (user: AuthUser, role: string | undefined, req: RequestWithId) => ({ user, role, requestId: req.requestId || '' });

function revision(header?: string) {
  const value = String(header || '').replace(/^"|"$/g, '');
  if (!value) throw new AppError(428, 'precondition_required', 'Нужен заголовок If-Match.');
  if (!/^\d+$/.test(value)) throw new AppError(400, 'invalid_revision', 'Некорректная ревизия.');
  return Number(value);
}

const listResponse = { schema: { type: 'object', required: ['items', 'total', 'page', 'pageSize'], properties: {
  items: { type: 'array', items: { type: 'object' } }, total: { type: 'integer' }, page: { type: 'integer' }, pageSize: { type: 'integer' },
} } } satisfies ApiResponseNoStatusOptions;
const itemResponse = { schema: { type: 'object', required: ['item'], properties: { item: { type: 'object' }, changed: { type: 'array', items: { type: 'string' } }, requestId: { type: 'string' }, versionRevision: { type: 'integer' } } } } satisfies ApiResponseNoStatusOptions;

@ApiTags('v2-program-catalog')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Active-Role', required: false, enum: ['admin', 'teacher', 'student'], description: 'Required when accessing a local catalog.' })
@Controller('api/v2')
export class ProgramCatalogController {
  constructor(private readonly catalog: ProgramCatalogService) {}

  @Get('subjects') @ApiOkResponse(listResponse)
  subjects(@CurrentUser() user: AuthUser, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Query() query: CatalogQueryDto) {
    return this.catalog.subjects(actor(user, role, req), query);
  }

  @Get('subjects/:id') @ApiOkResponse(itemResponse)
  subject(@CurrentUser() user: AuthUser, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Param('id') id: string) {
    return this.catalog.subject(actor(user, role, req), id);
  }

  @Post('subjects') @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiOkResponse(itemResponse)
  createSubject(@CurrentUser() user: AuthUser, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Headers('idempotency-key') key: string, @Body() body: CreateSubjectDto) {
    return this.catalog.createSubject(actor(user, role, req), body, key);
  }

  @Patch('subjects/:id') @ApiHeader({ name: 'If-Match', required: true }) @ApiOkResponse(itemResponse)
  updateSubject(@CurrentUser() user: AuthUser, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Param('id') id: string, @Headers('if-match') match: string, @Body() body: UpdateSubjectDto) {
    return this.catalog.updateSubject(actor(user, role, req), id, body.name, revision(match));
  }

  @Post('subjects/:id/archive') @HttpCode(200) @ApiBody({ schema: { type: 'object', additionalProperties: false } }) @ApiHeader({ name: 'If-Match', required: true }) @ApiOkResponse(itemResponse)
  archiveSubject(@CurrentUser() user: AuthUser, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Param('id') id: string, @Headers('if-match') match: string) {
    return this.catalog.updateSubject(actor(user, role, req), id, '', revision(match), true);
  }

  @Get('programs') @ApiOkResponse(listResponse)
  programs(@CurrentUser() user: AuthUser, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Query() query: CatalogQueryDto) {
    return this.catalog.programs(actor(user, role, req), query);
  }

  @Get('programs/:id') @ApiOkResponse(itemResponse)
  program(@CurrentUser() user: AuthUser, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Param('id') id: string) {
    return this.catalog.program(actor(user, role, req), id);
  }

  @Post('programs') @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiOkResponse(itemResponse)
  createProgram(@CurrentUser() user: AuthUser, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Headers('idempotency-key') key: string, @Body() body: CreateProgramDto) {
    return this.catalog.createProgram(actor(user, role, req), body, key);
  }

  @Patch('programs/:id') @ApiHeader({ name: 'If-Match', required: true }) @ApiOkResponse(itemResponse)
  updateProgram(@CurrentUser() user: AuthUser, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Param('id') id: string, @Headers('if-match') match: string, @Body() body: UpdateProgramDto) {
    return this.catalog.updateProgram(actor(user, role, req), id, body.name, revision(match));
  }

  @Post('programs/:id/archive') @HttpCode(200) @ApiBody({ schema: { type: 'object', additionalProperties: false } }) @ApiHeader({ name: 'If-Match', required: true }) @ApiOkResponse(itemResponse)
  archiveProgram(@CurrentUser() user: AuthUser, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Param('id') id: string, @Headers('if-match') match: string) {
    return this.catalog.updateProgram(actor(user, role, req), id, '', revision(match), true);
  }

  @Get('programs/:id/versions') @ApiOkResponse(listResponse)
  versions(@CurrentUser() user: AuthUser, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Param('id') id: string, @Query() query: CatalogQueryDto) {
    return this.catalog.versions(actor(user, role, req), id, query);
  }

  @Post('programs/:id/versions') @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiOkResponse(itemResponse)
  createVersion(@CurrentUser() user: AuthUser, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Param('id') id: string, @Headers('idempotency-key') key: string, @Body() body: CreateProgramVersionDto) {
    return this.catalog.createVersion(actor(user, role, req), id, body, key);
  }

  @Get('program-versions/:id') @ApiOkResponse(itemResponse)
  version(@CurrentUser() user: AuthUser, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Param('id') id: string) {
    return this.catalog.version(actor(user, role, req), id);
  }

  @Patch('program-versions/:id') @ApiHeader({ name: 'If-Match', required: true }) @ApiOkResponse(itemResponse)
  updateVersion(@CurrentUser() user: AuthUser, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Param('id') id: string, @Headers('if-match') match: string, @Body() body: UpdateProgramVersionDto) {
    return this.catalog.updateVersion(actor(user, role, req), id, body, revision(match));
  }

  @Post('program-versions/:id/publish') @HttpCode(200) @ApiBody({ schema: { type: 'object', additionalProperties: false } }) @ApiHeader({ name: 'If-Match', required: true }) @ApiOkResponse(itemResponse)
  publish(@CurrentUser() user: AuthUser, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Param('id') id: string, @Headers('if-match') match: string) {
    return this.catalog.publish(actor(user, role, req), id, revision(match));
  }

  @Post('program-versions/:id/archive') @HttpCode(200) @ApiBody({ schema: { type: 'object', additionalProperties: false } }) @ApiHeader({ name: 'If-Match', required: true }) @ApiOkResponse(itemResponse)
  archiveVersion(@CurrentUser() user: AuthUser, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Param('id') id: string, @Headers('if-match') match: string) {
    return this.catalog.archiveVersion(actor(user, role, req), id, revision(match));
  }

  @Get('program-versions/:id/tasks') @ApiOkResponse(listResponse)
  tasks(@CurrentUser() user: AuthUser, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Param('id') id: string, @Query() query: CatalogQueryDto) {
    return this.catalog.tasks(actor(user, role, req), id, query);
  }

  @Post('program-versions/:id/tasks') @HttpCode(200) @ApiHeader({ name: 'If-Match', required: true }) @ApiOkResponse(itemResponse)
  createTask(@CurrentUser() user: AuthUser, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Param('id') id: string, @Headers('if-match') match: string, @Body() body: TaskInputDto) {
    return this.catalog.createTask(actor(user, role, req), id, body, revision(match));
  }

  @Patch('program-versions/:id/tasks/:taskId') @ApiHeader({ name: 'If-Match', required: true }) @ApiOkResponse(itemResponse)
  updateTask(@CurrentUser() user: AuthUser, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Param('id') id: string, @Param('taskId') taskId: string, @Headers('if-match') match: string, @Body() body: TaskInputDto) {
    return this.catalog.updateTask(actor(user, role, req), id, taskId, body, revision(match));
  }

  @Delete('program-versions/:id/tasks/:taskId') @ApiHeader({ name: 'If-Match', required: true }) @ApiOkResponse(itemResponse)
  deleteTask(@CurrentUser() user: AuthUser, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Param('id') id: string, @Param('taskId') taskId: string, @Headers('if-match') match: string) {
    return this.catalog.deleteTask(actor(user, role, req), id, taskId, revision(match));
  }

  @Post('program-versions/:id/scoring-rule') @HttpCode(200) @ApiHeader({ name: 'If-Match', required: true }) @ApiOkResponse(itemResponse)
  scoringRule(@CurrentUser() user: AuthUser, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Param('id') id: string, @Headers('if-match') match: string, @Body() body: ScoringRuleDto) {
    return this.catalog.setScoringRule(actor(user, role, req), id, body, revision(match));
  }

  @Get('task-mappings') @ApiOkResponse(listResponse)
  mappings(@CurrentUser() user: AuthUser, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Query('fromVersionId') from: string, @Query('toVersionId') to: string, @Query() query: CatalogQueryDto) {
    if (!from || !to) throw new AppError(400, 'invalid_request', 'Укажите версии для сопоставления.');
    return this.catalog.mappings(actor(user, role, req), from, to, query);
  }

  @Post('task-mappings') @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiOkResponse(itemResponse)
  createMapping(@CurrentUser() user: AuthUser, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Headers('idempotency-key') key: string, @Body() body: CreateTaskMappingDto) {
    return this.catalog.createMapping(actor(user, role, req), body, key);
  }

  @Post('task-mappings/:id/revoke') @HttpCode(200) @ApiHeader({ name: 'If-Match', required: true }) @ApiOkResponse(itemResponse)
  revokeMapping(@CurrentUser() user: AuthUser, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Param('id') id: string, @Headers('if-match') match: string, @Body() body: RevokeTaskMappingDto) {
    return this.catalog.revokeMapping(actor(user, role, req), id, body.reason, revision(match));
  }
}
