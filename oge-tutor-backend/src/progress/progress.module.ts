/*
 * OGE Tutor Backend — progress module.
 * Stores diagnostic task progress separately from student profile data.
 */
import { Module } from '@nestjs/common';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';

@Module({
  controllers: [ProgressController],
  providers: [ProgressService],
  exports: [ProgressService],
})
export class ProgressModule {}
