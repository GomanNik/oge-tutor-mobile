import { Module } from '@nestjs/common';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ProgramCatalogController } from './program-catalog.controller';
import { ProgramCatalogService } from './program-catalog.service';

@Module({ imports: [WorkspaceModule], controllers: [ProgramCatalogController], providers: [ProgramCatalogService] })
export class ProgramCatalogModule {}
