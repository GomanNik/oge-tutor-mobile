import { Module } from '@nestjs/common';
import { WorkspaceModule } from '../workspace/workspace.module';
import { CourseLessonsController } from './course-lessons.controller';
import { CourseLessonsService } from './course-lessons.service';

@Module({ imports: [WorkspaceModule], controllers: [CourseLessonsController], providers: [CourseLessonsService] })
export class CourseLessonsModule {}
