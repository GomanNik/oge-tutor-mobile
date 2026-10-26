import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { LearningAccessService } from './learning-access.service';
import { LearningEventsService } from './learning-events.service';
import { LearningProgressService } from './learning-progress.service';
import { LearningNotificationsService } from './learning-notifications.service';
import { LearningDeliveryWorker } from './learning-delivery.worker';
import { LearningController, MyLearningNotificationsController } from './learning.controller';

@Module({ imports: [WorkspaceModule, AuthModule], controllers: [LearningController, MyLearningNotificationsController],
  providers: [LearningAccessService, LearningEventsService, LearningProgressService, LearningNotificationsService, LearningDeliveryWorker],
  exports: [LearningEventsService, LearningProgressService, LearningDeliveryWorker],
})
export class LearningModule {}
