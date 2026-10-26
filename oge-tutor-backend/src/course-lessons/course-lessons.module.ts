import { Module } from '@nestjs/common';
import { WorkspaceModule } from '../workspace/workspace.module';
import { CourseLessonsController } from './course-lessons.controller';
import { CourseLessonsService } from './course-lessons.service';
import { LearningModule } from '../learning/learning.module';
import { LessonSeriesService } from './lesson-series.service';
import { LessonSeriesController } from './lesson-series.controller';
import { LessonSeriesWorker } from './lesson-series.worker';

@Module({ imports: [WorkspaceModule, LearningModule], controllers: [CourseLessonsController, LessonSeriesController], providers: [CourseLessonsService, LessonSeriesService, LessonSeriesWorker], exports: [LessonSeriesService, LessonSeriesWorker] })
export class CourseLessonsModule {}
