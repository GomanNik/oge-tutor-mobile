import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser } from '../common/current-user';
import { WorkspaceContextService } from '../workspace/workspace-context.service';
import { workRevision } from '../assignments/work-access.service';
import { CreateAssessmentDto, DeliveryQueryDto, MarkNotificationDto, MyNotificationQueryDto, NotificationPreferenceDto, NotificationQueryDto, ProgramProgressQueryDto, ProgressEventsQueryDto, ReadAllNotificationsDto, RetryDeliveryDto, WorkspaceIdQueryDto } from './learning.dto';
import { LearningProgressService } from './learning-progress.service';
import { LearningNotificationsService } from './learning-notifications.service';

type LearningRequest = Request & { user: AuthUser; requestId?: string };
@ApiTags('v2-progress-notifications')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Active-Role', required: true, enum: ['admin', 'teacher', 'student'] })
@ApiParam({ name: 'workspaceId', type: String })
@Controller('api/v2/workspaces/:workspaceId')
export class LearningController {
  constructor(private readonly progressService: LearningProgressService, private readonly notices: LearningNotificationsService, private readonly contexts: WorkspaceContextService) {}
  private ctx(req: LearningRequest) { return this.contexts.resolve(req.user, String(req.params.workspaceId), req.get('X-Active-Role'), req.requestId || ''); }
  @Get('enrollments/:id/progress')
  async progress(@Req() req: LearningRequest, @Param('id') id: string) { return this.progressService.progress(await this.ctx(req), id); }
  @Get('enrollments/:id/progress/events')
  async events(@Req() req: LearningRequest, @Param('id') id: string, @Query() query: ProgressEventsQueryDto) { return this.progressService.events(await this.ctx(req), id, query); }
  @Post('enrollments/:id/progress/assessments') @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: true })
  async assess(@Req() req: LearningRequest, @Param('id') id: string, @Body() body: CreateAssessmentDto) { return this.progressService.assess(await this.ctx(req), id, body, req.get('Idempotency-Key') || ''); }
  @Get('students/:id/program-progress')
  async program(@Req() req: LearningRequest, @Param('id') id: string, @Query() query: ProgramProgressQueryDto) { return this.progressService.programProgress(await this.ctx(req), id, query.programVersionId); }
  @Get('notifications')
  async list(@Req() req: LearningRequest, @Query() query: NotificationQueryDto) { return this.notices.list(await this.ctx(req), query); }
  @Patch('notifications/:id') @ApiHeader({ name: 'If-Match', required: true })
  async mark(@Req() req: LearningRequest, @Param('id') id: string, @Body() body: MarkNotificationDto) { return this.notices.mark(await this.ctx(req), id, body, workRevision(req.get('If-Match'))); }
  @Post('notifications/read-all') @HttpCode(200)
  async readAll(@Req() req: LearningRequest, @Body() body: ReadAllNotificationsDto) { return this.notices.readAll(await this.ctx(req), body); }
  @Get('notifications/:id/target')
  async target(@Req() req: LearningRequest, @Param('id') id: string) { return this.notices.target(await this.ctx(req), id); }
  @Get('notification-preferences')
  async preferences(@Req() req: LearningRequest) { return this.notices.preferences(await this.ctx(req)); }
  @Patch('notification-preferences')
  async setPreferences(@Req() req: LearningRequest, @Body() body: NotificationPreferenceDto) { return this.notices.setPreferences(await this.ctx(req), body); }
  @Get('notification-deliveries')
  async deliveries(@Req() req: LearningRequest, @Query() query: DeliveryQueryDto) { return this.notices.deliveries(await this.ctx(req), query); }
  @Post('notification-deliveries/:id/retry') @HttpCode(200) @ApiHeader({ name: 'If-Match', required: true })
  async retry(@Req() req: LearningRequest, @Param('id') id: string, @Body() body: RetryDeliveryDto) { return this.notices.retry(await this.ctx(req), id, body, workRevision(req.get('If-Match'))); }
}

@ApiTags('v2-my-notifications')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Active-Role', required: true, enum: ['admin', 'teacher', 'student'] })
@Controller('api/v2/me/notifications')
export class MyLearningNotificationsController {
  constructor(private readonly notices: LearningNotificationsService, private readonly contexts: WorkspaceContextService) {}
  private ctx(req: LearningRequest, workspaceId: string) { return this.contexts.resolve(req.user, workspaceId, req.get('X-Active-Role'), req.requestId || ''); }
  @Get()
  async list(@Req() req: LearningRequest, @Query() query: MyNotificationQueryDto) { return this.notices.list(await this.ctx(req, query.workspaceId), query); }
  @Patch(':id') @ApiHeader({ name: 'If-Match', required: true })
  async mark(@Req() req: LearningRequest, @Param('id') id: string, @Query() query: WorkspaceIdQueryDto, @Body() body: MarkNotificationDto) { return this.notices.mark(await this.ctx(req, query.workspaceId), id, body, workRevision(req.get('If-Match'))); }
  @Post('read-all') @HttpCode(200)
  async readAll(@Req() req: LearningRequest, @Query() query: WorkspaceIdQueryDto, @Body() body: ReadAllNotificationsDto) { return this.notices.readAll(await this.ctx(req, query.workspaceId), body); }
  @Get(':id/target')
  async target(@Req() req: LearningRequest, @Param('id') id: string, @Query() query: WorkspaceIdQueryDto) { return this.notices.target(await this.ctx(req, query.workspaceId), id); }
}
