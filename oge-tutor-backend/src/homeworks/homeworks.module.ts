/*
 * OGE Tutor Backend — homeworks module.
 * Imports FilesModule because homework materials, review materials and submissions validate file resources.
 */
import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { HomeworksController } from './homeworks.controller';
import { HomeworksService } from './homeworks.service';

@Module({
  imports: [FilesModule],
  controllers: [HomeworksController],
  providers: [HomeworksService],
  exports: [HomeworksService],
})
export class HomeworksModule {}
