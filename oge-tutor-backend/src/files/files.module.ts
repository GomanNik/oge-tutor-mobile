/*
 * OGE Tutor Backend — files module.
 * Exposes FilesService so domain modules can validate uploaded file ownership before attaching files.
 */
import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
