/*
 * OGE Tutor Backend — lessons module.
 * Imports FilesModule because lesson materials must validate file resources before saving.
 */
import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { LessonsController } from './lessons.controller';
import { LessonsService } from './lessons.service';

@Module({
  imports: [FilesModule],
  controllers: [LessonsController],
  providers: [LessonsService],
  exports: [LessonsService],
})
export class LessonsModule {}
