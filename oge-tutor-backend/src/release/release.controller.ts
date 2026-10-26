import { Controller, Get, Param, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser } from '../common/current-user';
import { WorkspaceContextService } from '../workspace/workspace-context.service';
import { ReleaseVerificationService } from './release-verification.service';

@ApiTags('v2-release')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Active-Role', required: true, enum: ['admin'] })
@Controller('api/v2/workspaces/:workspaceId/release-status')
export class ReleaseController {
  constructor(private readonly verification: ReleaseVerificationService, private readonly contexts: WorkspaceContextService) {}
  @Get()
  async status(@Param('workspaceId') workspaceId: string, @Req() req: Request & { user: AuthUser; requestId?: string }) {
    const ctx = await this.contexts.resolve(req.user, workspaceId, req.get('X-Active-Role'), req.requestId || '');
    return { item: await this.verification.report(workspaceId, ctx) };
  }
}
