import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../common/current-user';
import { CatalogService } from './catalog.service';
import { CatalogQueryDto, UpdateNotificationDto } from './catalog.dto';

@ApiBearerAuth()
@ApiTags('Lists and history')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('students')
  students(@CurrentUser() user: AuthUser, @Query() query: CatalogQueryDto) { return this.catalog.students(user, query); }

  @Get('students/:studentId')
  async student(@CurrentUser() user: AuthUser, @Param('studentId') id: string) { return { item: await this.catalog.student(user, id) }; }

  @Get('lessons')
  lessons(@CurrentUser() user: AuthUser, @Query() query: CatalogQueryDto) { return this.catalog.lessons(user, query); }

  @Get('lessons/:lessonId')
  async lesson(@CurrentUser() user: AuthUser, @Param('lessonId') id: string) { return { item: await this.catalog.lesson(user, id) }; }

  @Get('homeworks')
  homeworks(@CurrentUser() user: AuthUser, @Query() query: CatalogQueryDto) { return this.catalog.homeworks(user, query); }

  @Get('homeworks/:homeworkId')
  async homework(@CurrentUser() user: AuthUser, @Param('homeworkId') id: string) { return { item: await this.catalog.homework(user, id) }; }

  @Get('materials')
  materials(@CurrentUser() user: AuthUser, @Query() query: CatalogQueryDto) { return this.catalog.materials(user, query); }

  @Get('materials/:topicId')
  async material(@CurrentUser() user: AuthUser, @Param('topicId') id: string) { return { item: await this.catalog.material(user, id) }; }

  @Get('notifications')
  notifications(@CurrentUser() user: AuthUser, @Query() query: CatalogQueryDto) { return this.catalog.notifications(user, query); }

  @Patch('notifications/:notificationId')
  updateNotification(@CurrentUser() user: AuthUser, @Param('notificationId') id: string, @Body() body: UpdateNotificationDto) { return this.catalog.updateNotification(user, id, body); }

  @Post('notifications/read-all')
  readAll(@CurrentUser() user: AuthUser) { return this.catalog.readAllNotifications(user); }

  @Get('students/:studentId/progress/history')
  history(@CurrentUser() user: AuthUser, @Param('studentId') id: string, @Query() query: CatalogQueryDto) { return this.catalog.history(user, id, query); }
}
