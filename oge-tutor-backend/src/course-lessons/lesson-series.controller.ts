import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser } from '../common/current-user';
import { WorkspaceContextService } from '../workspace/workspace-context.service';
import { workRevision } from '../assignments/work-access.service';
import { SaveSeriesDto, SeriesActionDto, SeriesActionPreviewDto, SeriesPreviewDto, SeriesQueryDto } from './lesson-series.dto';
import { LessonSeriesService } from './lesson-series.service';

type SeriesRequest = Request & { user: AuthUser; requestId?: string };
@ApiTags('v2-lesson-series')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Active-Role', required: true, enum: ['admin', 'teacher'] })
@Controller('api/v2/workspaces/:workspaceId/lesson-series')
export class LessonSeriesController {
  constructor(private readonly series: LessonSeriesService, private readonly contexts: WorkspaceContextService) {}
  private ctx(req: SeriesRequest) { return this.contexts.resolve(req.user, String(req.params.workspaceId), req.get('X-Active-Role'), req.requestId || ''); }
  @Get()
  async list(@Req() req: SeriesRequest, @Query() query: SeriesQueryDto) { return this.series.list(await this.ctx(req), query); }
  @Get(':id')
  async get(@Req() req: SeriesRequest, @Param('id') id: string) { return this.series.get(await this.ctx(req), id); }
  @Post('preview') @HttpCode(200)
  async preview(@Req() req: SeriesRequest, @Body() body: SeriesPreviewDto) { return this.series.preview(await this.ctx(req), body); }
  @Post() @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: true })
  async create(@Req() req: SeriesRequest, @Body() body: SaveSeriesDto) { return this.series.save(await this.ctx(req), body, req.get('Idempotency-Key') || ''); }
  @Post(':id/preview') @HttpCode(200) @ApiHeader({ name: 'If-Match', required: true })
  async previewUpdate(@Req() req: SeriesRequest, @Param('id') id: string, @Body() body: SeriesPreviewDto) { return this.series.preview(await this.ctx(req), body, id, workRevision(req.get('If-Match'))); }
  @Patch(':id') @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'If-Match', required: true })
  async update(@Req() req: SeriesRequest, @Param('id') id: string, @Body() body: SaveSeriesDto) { return this.series.save(await this.ctx(req), body, req.get('Idempotency-Key') || '', id, workRevision(req.get('If-Match'))); }
  @Post(':id/actions/preview') @HttpCode(200) @ApiHeader({ name: 'If-Match', required: true })
  async previewAction(@Req() req: SeriesRequest, @Param('id') id: string, @Body() body: SeriesActionPreviewDto) { return this.series.previewAction(await this.ctx(req), id, body, workRevision(req.get('If-Match'))); }
  @Post(':id/actions') @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiHeader({ name: 'If-Match', required: true })
  async action(@Req() req: SeriesRequest, @Param('id') id: string, @Body() body: SeriesActionDto) { return this.series.save(await this.ctx(req), body, req.get('Idempotency-Key') || '', id, workRevision(req.get('If-Match'))); }
}
