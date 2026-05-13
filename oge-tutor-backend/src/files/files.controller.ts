import { Body, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser, AuthUser } from '../common/current-user';
import { FilesService } from './files.service';
import { UploadFileMetaDto } from './files.dto';

@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async upload(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File, @Body() body: UploadFileMetaDto) {
    const saved = await this.files.saveUploadedFile(user, file, { title: body.title, context: body.context });
    return { fileResource: this.files.mapFile(saved) };
  }
}
