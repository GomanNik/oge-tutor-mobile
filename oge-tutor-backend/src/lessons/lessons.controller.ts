import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../common/current-user';
import { Roles } from '../common/role.guard';
import { ROLE } from '../common/contracts';
import { LessonsService } from './lessons.service';
import { CatalogService } from '../catalog/catalog.service';
import { CompleteLessonDto, CreateLessonDto, UpdateLessonDto } from './lessons.dto';

@Roles(ROLE.TEACHER)
@Controller('lessons')
export class LessonsController {
  constructor(private readonly lessons: LessonsService, private readonly catalog: CatalogService) {}

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: CreateLessonDto) {
    const lesson = await this.lessons.create(user, body);
    return { changes: { lessons: [await this.catalog.lesson(user, lesson.id)] }, invalidated: ['lessons'] };
  }

  @Patch(':lessonId')
  async update(@CurrentUser() user: AuthUser, @Param('lessonId') lessonId: string, @Body() body: UpdateLessonDto) {
    await this.lessons.update(user, lessonId, body);
    return { changes: { lessons: [await this.catalog.lesson(user, lessonId)] }, invalidated: ['lessons'] };
  }

  @Post(':lessonId/complete')
  async complete(@CurrentUser() user: AuthUser, @Param('lessonId') lessonId: string, @Body() body: CompleteLessonDto) {
    await this.lessons.complete(user, lessonId, body);
    const lesson = await this.catalog.lesson(user, lessonId);
    return { changes: { lessons: [lesson], students: [await this.catalog.student(user, lesson.studentId)] }, invalidated: ['lessons', 'notifications'] };
  }
}
