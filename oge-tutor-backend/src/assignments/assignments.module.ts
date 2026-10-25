import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { WorkAccessService } from './work-access.service';
import { WorkFilesService } from './work-files.service';
import { LearningMaterialsService } from './learning-materials.service';

@Module({ imports: [FilesModule, WorkspaceModule], controllers: [AssignmentsController], providers: [AssignmentsService, WorkAccessService, WorkFilesService, LearningMaterialsService] })
export class AssignmentsModule {}
