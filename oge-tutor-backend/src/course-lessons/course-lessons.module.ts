import { Module } from '@nestjs/common';
import { WorkspaceModule } from '../workspace/workspace.module';
import { CourseLessonsController } from './course-lessons.controller';
import { CourseLessonsService } from './course-lessons.service';
import { LearningModule } from '../learning/learning.module';

@Module({ imports: [WorkspaceModule, LearningModule], controllers: [CourseLessonsController], providers: [CourseLessonsService] })
export class CourseLessonsModule {}
