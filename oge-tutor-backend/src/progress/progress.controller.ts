import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../common/current-user';
import { ProgressService } from './progress.service';
import { BootstrapService } from '../bootstrap/bootstrap.service';
import { ReplaceProgressDto, ResolveAssessmentDto, UpdateTaskProgressDto } from './progress.dto';

@Controller('students/:studentId/progress')
export class ProgressController {
  constructor(private readonly progress: ProgressService, private readonly bootstrap: BootstrapService) {}

  @Patch()
  async replace(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string, @Body() body: ReplaceProgressDto) {
    await this.progress.replaceProgress(user, studentId, body);
    return { data: await this.bootstrap.buildForUser(user.id) };
  }

  @Patch('tasks/:taskNumber')
  async updateTask(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string, @Param('taskNumber') taskNumber: string, @Body() body: UpdateTaskProgressDto) {
    await this.progress.updateTask(user, studentId, taskNumber, body);
    return { data: await this.bootstrap.buildForUser(user.id) };
  }

  @Post('tasks/:taskNumber/assessment')
  async resolveAssessment(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string, @Param('taskNumber') taskNumber: string, @Body() body: ResolveAssessmentDto) {
    await this.progress.resolveAssessment(user, studentId, taskNumber, body);
    return { data: await this.bootstrap.buildForUser(user.id) };
  }
}
