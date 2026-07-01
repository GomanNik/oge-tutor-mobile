import { Body, Controller, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser, AuthUser } from '../common/current-user';
import { HomeworksService } from './homeworks.service';
import { BootstrapService } from '../bootstrap/bootstrap.service';
import { CreateHomeworkDto, ReviewHomeworkDto, UpdateHomeworkDto } from './homeworks.dto';

@Controller('homeworks')
export class HomeworksController {
  constructor(private readonly homeworks: HomeworksService, private readonly bootstrap: BootstrapService) {}

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: CreateHomeworkDto) {
    await this.homeworks.create(user, body);
    return { data: await this.bootstrap.buildForUser(user.id) };
  }

  @Patch(':homeworkId')
  async update(@CurrentUser() user: AuthUser, @Param('homeworkId') homeworkId: string, @Body() body: UpdateHomeworkDto) {
    await this.homeworks.update(user, homeworkId, body);
    return { data: await this.bootstrap.buildForUser(user.id) };
  }

  @Post(':homeworkId/submissions')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async submit(@CurrentUser() user: AuthUser, @Param('homeworkId') homeworkId: string, @UploadedFile() file: Express.Multer.File, @Body() body: any) {
    await this.homeworks.submit(user, homeworkId, file, body);
    return { data: await this.bootstrap.buildForUser(user.id) };
  }

  @Post(':homeworkId/review')
  async review(@CurrentUser() user: AuthUser, @Param('homeworkId') homeworkId: string, @Body() body: ReviewHomeworkDto) {
    await this.homeworks.review(user, homeworkId, body);
    return { data: await this.bootstrap.buildForUser(user.id) };
  }
}
