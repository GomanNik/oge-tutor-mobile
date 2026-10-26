import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ReleaseController } from './release.controller';
import { ReleaseVerificationService } from './release-verification.service';

@Module({ imports: [PrismaModule, WorkspaceModule], controllers: [ReleaseController], providers: [ReleaseVerificationService], exports: [ReleaseVerificationService] })
export class ReleaseModule {}
