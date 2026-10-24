import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkspaceAccountController, WorkspaceController, WorkspaceInvitationAcceptanceController } from './workspace.controller';
import { WorkspaceContextService } from './workspace-context.service';
import { WorkspaceMembersService } from './workspace-members.service';
import { WorkspaceInvitationsService } from './workspace-invitations.service';

@Module({
  imports: [AuthModule],
  controllers: [WorkspaceAccountController, WorkspaceController, WorkspaceInvitationAcceptanceController],
  providers: [WorkspaceContextService, WorkspaceMembersService, WorkspaceInvitationsService],
  exports: [WorkspaceContextService],
})
export class WorkspaceModule {}
