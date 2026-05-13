/*
 * OGE Tutor Backend — materials module.
 * Imports FilesModule because material attachments must reference existing accessible uploaded files.
 */
import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { MaterialsController } from './materials.controller';
import { MaterialsService } from './materials.service';

@Module({
  imports: [FilesModule],
  controllers: [MaterialsController],
  providers: [MaterialsService],
  exports: [MaterialsService],
})
export class MaterialsModule {}
