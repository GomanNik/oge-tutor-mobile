import { Body, Controller, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { StreamingUploadInterceptor } from '../files/streaming-upload.interceptor';
import { CurrentUser, AuthUser } from '../common/current-user';
import { HomeworksService } from './homeworks.service';
import { CatalogService } from '../catalog/catalog.service';
import { CreateHomeworkDto, ReviewHomeworkDto, SubmitHomeworkDto, UpdateHomeworkDto } from './homeworks.dto';

@Controller('homeworks')
export class HomeworksController {
  constructor(private readonly homeworks: HomeworksService, private readonly catalog: CatalogService) {}

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: CreateHomeworkDto) {
    const homework = await this.homeworks.create(user, body);
    return { changes: { homeworks: [await this.catalog.homework(user, homework.id)] }, invalidated: ['homeworks'] };
  }

  @Patch(':homeworkId')
  async update(@CurrentUser() user: AuthUser, @Param('homeworkId') homeworkId: string, @Body() body: UpdateHomeworkDto) {
    await this.homeworks.update(user, homeworkId, body);
    return { changes: { homeworks: [await this.catalog.homework(user, homeworkId)] }, invalidated: ['homeworks'] };
  }

  @Post(':homeworkId/submissions')
  @UseInterceptors(StreamingUploadInterceptor)
  async submit(@CurrentUser() user: AuthUser, @Param('homeworkId') homeworkId: string, @UploadedFile() file: Express.Multer.File, @Body() body: SubmitHomeworkDto) {
    await this.homeworks.submit(user, homeworkId, file, body);
    return { changes: { homeworks: [await this.catalog.homework(user, homeworkId)] }, invalidated: ['homeworks'] };
  }

  @Post(':homeworkId/review')
  async review(@CurrentUser() user: AuthUser, @Param('homeworkId') homeworkId: string, @Body() body: ReviewHomeworkDto) {
    await this.homeworks.review(user, homeworkId, body);
    const homework = await this.catalog.homework(user, homeworkId);
    return { changes: { homeworks: [homework], students: [await this.catalog.student(user, homework.studentId)] }, invalidated: ['homeworks', 'notifications'] };
  }
}
