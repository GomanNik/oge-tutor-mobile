import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../common/current-user';
import { ProgressService } from './progress.service';
import { CatalogService } from '../catalog/catalog.service';
import { ReplaceProgressDto, ResolveAssessmentDto, UpdateTaskProgressDto } from './progress.dto';

@Controller('students/:studentId/progress')
export class ProgressController {
  constructor(private readonly progress: ProgressService, private readonly catalog: CatalogService) {}

  @Patch()
  async replace(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string, @Body() body: ReplaceProgressDto) {
    await this.progress.replaceProgress(user, studentId, body);
    return { changes: { students: [await this.catalog.student(user, studentId)] } };
  }

  @Patch('tasks/:taskNumber')
  async updateTask(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string, @Param('taskNumber') taskNumber: string, @Body() body: UpdateTaskProgressDto) {
    await this.progress.updateTask(user, studentId, taskNumber, body);
    return { changes: { students: [await this.catalog.student(user, studentId)] } };
  }

  @Post('tasks/:taskNumber/assessment')
  async resolveAssessment(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string, @Param('taskNumber') taskNumber: string, @Body() body: ResolveAssessmentDto) {
    await this.progress.resolveAssessment(user, studentId, taskNumber, body);
    return { changes: { students: [await this.catalog.student(user, studentId)] }, invalidated: ['notifications'] };
  }
}
