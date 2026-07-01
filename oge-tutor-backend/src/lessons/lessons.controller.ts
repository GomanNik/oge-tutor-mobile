import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../common/current-user';
import { Roles } from '../common/role.guard';
import { ROLE } from '../common/contracts';
import { LessonsService } from './lessons.service';
import { BootstrapService } from '../bootstrap/bootstrap.service';
import { CompleteLessonDto, CreateLessonDto, UpdateLessonDto } from './lessons.dto';

@Roles(ROLE.TEACHER)
@Controller('lessons')
export class LessonsController {
  constructor(private readonly lessons: LessonsService, private readonly bootstrap: BootstrapService) {}

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: CreateLessonDto) {
    await this.lessons.create(user, body);
    return { data: await this.bootstrap.buildForUser(user.id) };
  }

  @Patch(':lessonId')
  async update(@CurrentUser() user: AuthUser, @Param('lessonId') lessonId: string, @Body() body: UpdateLessonDto) {
    await this.lessons.update(user, lessonId, body);
    return { data: await this.bootstrap.buildForUser(user.id) };
  }

  @Post(':lessonId/complete')
  async complete(@CurrentUser() user: AuthUser, @Param('lessonId') lessonId: string, @Body() body: CompleteLessonDto) {
    await this.lessons.complete(user, lessonId, body);
    return { data: await this.bootstrap.buildForUser(user.id) };
  }
}
