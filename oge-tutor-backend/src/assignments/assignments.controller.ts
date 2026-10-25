import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiHeader, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthUser } from '../common/current-user';
import { WorkspaceContextService } from '../workspace/workspace-context.service';
import { StreamingUploadInterceptor } from '../files/streaming-upload.interceptor';
import { AssignmentQueryDto, AssignmentRecipientsDto, CreateAssignmentDto, CreateLearningMaterialDto, CreateReviewDto, EmptyWorkDto, MaterialQueryDto, PublishMaterialDto, SubmitAssignmentDto, UpdateAssignmentDto, UpdateLearningMaterialDto, UpdateRecipientDto, WorkPageDto, WorkReasonDto } from './assignments.dto';
import { AssignmentsService } from './assignments.service';
import { LearningMaterialsService } from './learning-materials.service';
import { WorkFilesService } from './work-files.service';
import { workRevision } from './work-access.service';

type WorkRequest = Request & { user: AuthUser; requestId?: string };
const match = (req: Request) => workRevision(req.get('If-Match'));
const key = (req: Request) => req.get('Idempotency-Key') || '';

@ApiTags('v2-assignments-materials')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Active-Role', required: true, enum: ['admin', 'teacher', 'student'] })
@ApiParam({ name: 'workspaceId', type: String })
@Controller('api/v2/workspaces/:workspaceId')
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService, private readonly materials: LearningMaterialsService, private readonly files: WorkFilesService, private readonly contexts: WorkspaceContextService) {}
  private ctx(req: WorkRequest) { return this.contexts.resolve(req.user, String(req.params.workspaceId), req.get('X-Active-Role') || '', req.requestId || ''); }

  @Get('assignments')
  async list(@Req() req: WorkRequest, @Query() query: AssignmentQueryDto) { return this.assignments.list(await this.ctx(req), query); }

  @Get('assignments/:id')
  async get(@Req() req: WorkRequest, @Param('id') id: string) { return this.assignments.get(await this.ctx(req), id); }

  @Post('assignments') @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: true })
  async create(@Req() req: WorkRequest, @Body() body: CreateAssignmentDto) { return this.assignments.create(await this.ctx(req), body, key(req)); }

  @Patch('assignments/:id') @ApiHeader({ name: 'If-Match', required: true })
  async update(@Req() req: WorkRequest, @Param('id') id: string, @Body() body: UpdateAssignmentDto) { return this.assignments.update(await this.ctx(req), id, body, match(req)); }

  @Post('assignments/:id/publish') @HttpCode(200) @ApiHeader({ name: 'If-Match', required: true }) @ApiHeader({ name: 'Idempotency-Key', required: true })
  async publish(@Req() req: WorkRequest, @Param('id') id: string, @Body() body: AssignmentRecipientsDto) { return this.assignments.publish(await this.ctx(req), id, body, match(req), key(req)); }

  @Post('assignments/:id/recipients') @HttpCode(200) @ApiHeader({ name: 'If-Match', required: true }) @ApiHeader({ name: 'Idempotency-Key', required: true })
  async addRecipients(@Req() req: WorkRequest, @Param('id') id: string, @Body() body: AssignmentRecipientsDto) { return this.assignments.publish(await this.ctx(req), id, body, match(req), key(req), true); }

  @Post('assignments/:id/close') @HttpCode(200) @ApiHeader({ name: 'If-Match', required: true })
  async close(@Req() req: WorkRequest, @Param('id') id: string, @Body() body: WorkReasonDto) { return this.assignments.close(await this.ctx(req), id, body, match(req)); }

  @Post('assignments/:id/archive') @HttpCode(200) @ApiHeader({ name: 'If-Match', required: true })
  async archive(@Req() req: WorkRequest, @Param('id') id: string, @Body() body: WorkReasonDto) { return this.assignments.close(await this.ctx(req), id, body, match(req), true); }

  @Get('assignments/:id/recipients')
  async recipients(@Req() req: WorkRequest, @Param('id') id: string, @Query() query: WorkPageDto) { return this.assignments.recipients(await this.ctx(req), id, query); }

  @Patch('assignments/:id/recipients/:recipientId') @ApiHeader({ name: 'If-Match', required: true })
  async updateRecipient(@Req() req: WorkRequest, @Param('id') id: string, @Param('recipientId') recipientId: string, @Body() body: UpdateRecipientDto) { return this.assignments.updateRecipient(await this.ctx(req), id, recipientId, body, match(req)); }

  @Get('assignment-recipients/:id/submissions')
  async submissions(@Req() req: WorkRequest, @Param('id') id: string, @Query() query: WorkPageDto) { return this.assignments.submissions(await this.ctx(req), id, query); }

  @Post('assignment-recipients/:id/submissions') @HttpCode(200) @ApiHeader({ name: 'If-Match', required: true }) @ApiHeader({ name: 'Idempotency-Key', required: true })
  async submit(@Req() req: WorkRequest, @Param('id') id: string, @Body() body: SubmitAssignmentDto) { return this.assignments.submit(await this.ctx(req), id, body, match(req), key(req)); }

  @Post('submissions/:id/reviews') @HttpCode(200) @ApiHeader({ name: 'If-Match', required: true }) @ApiHeader({ name: 'Idempotency-Key', required: true })
  async createReview(@Req() req: WorkRequest, @Param('id') id: string, @Body() body: CreateReviewDto) { return this.assignments.createReview(await this.ctx(req), id, body, match(req), key(req)); }

  @Patch('reviews/:id') @ApiHeader({ name: 'If-Match', required: true })
  async updateReview(@Req() req: WorkRequest, @Param('id') id: string, @Body() body: CreateReviewDto) { return this.assignments.updateReview(await this.ctx(req), id, body, match(req)); }

  @Post('reviews/:id/publish') @HttpCode(200) @ApiHeader({ name: 'If-Match', required: true }) @ApiHeader({ name: 'Idempotency-Key', required: true })
  async publishReview(@Req() req: WorkRequest, @Param('id') id: string, @Body() _body: EmptyWorkDto) { return this.assignments.publishReview(await this.ctx(req), id, match(req), key(req)); }

  @Get('materials')
  async listMaterials(@Req() req: WorkRequest, @Query() query: MaterialQueryDto) { return this.materials.list(await this.ctx(req), query); }

  @Get('materials/:id')
  async getMaterial(@Req() req: WorkRequest, @Param('id') id: string) { return this.materials.get(await this.ctx(req), id); }

  @Post('materials') @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: true })
  async createMaterial(@Req() req: WorkRequest, @Body() body: CreateLearningMaterialDto) { return this.materials.create(await this.ctx(req), body, key(req)); }

  @Patch('materials/:id') @ApiHeader({ name: 'If-Match', required: true })
  async updateMaterial(@Req() req: WorkRequest, @Param('id') id: string, @Body() body: UpdateLearningMaterialDto) { return this.materials.update(await this.ctx(req), id, body, match(req)); }

  @Post('materials/:id/publish') @HttpCode(200) @ApiHeader({ name: 'If-Match', required: true }) @ApiHeader({ name: 'Idempotency-Key', required: true })
  async publishMaterial(@Req() req: WorkRequest, @Param('id') id: string, @Body() body: PublishMaterialDto) { return this.materials.publish(await this.ctx(req), id, body, match(req), key(req)); }

  @Post('materials/:id/publications/:publicationId/revoke') @HttpCode(200) @ApiHeader({ name: 'If-Match', required: true })
  async revokeMaterial(@Req() req: WorkRequest, @Param('id') id: string, @Param('publicationId') publicationId: string, @Body() body: WorkReasonDto) { return this.materials.revoke(await this.ctx(req), id, publicationId, body, match(req)); }

  @Post('materials/:id/archive') @HttpCode(200) @ApiHeader({ name: 'If-Match', required: true })
  async archiveMaterial(@Req() req: WorkRequest, @Param('id') id: string, @Body() body: WorkReasonDto) { return this.materials.archive(await this.ctx(req), id, body, match(req)); }

  @Post('files') @HttpCode(200) @UseInterceptors(StreamingUploadInterceptor) @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } }, additionalProperties: false } })
  async upload(@Req() req: WorkRequest, @UploadedFile() file: Express.Multer.File) { return this.files.upload(await this.ctx(req), req.user, file); }

  @Get('files/:id/download')
  async download(@Req() req: WorkRequest, @Param('id') id: string, @Res() res: Response) {
    const file = await this.files.download(await this.ctx(req), id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return res.download(file.storagePath, file.originalName);
  }

  @Delete('files/:id')
  async deleteFile(@Req() req: WorkRequest, @Param('id') id: string) { return this.files.remove(await this.ctx(req), id); }
}
