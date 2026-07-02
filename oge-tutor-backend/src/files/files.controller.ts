import { Body, Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
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

  @Get(':fileId/download')
  async download(@CurrentUser() user: AuthUser, @Param('fileId') fileId: string, @Res() response: Response) {
    const file = await this.files.requireDownloadableFile(user, fileId);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Cache-Control', 'private, no-store');
    return response.download(file.storagePath, file.originalName);
  }
}
