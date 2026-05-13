import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../common/current-user';
import { Roles } from '../common/role.guard';
import { ROLE } from '../common/contracts';
import { StudentsService } from './students.service';
import { BootstrapService } from '../bootstrap/bootstrap.service';
import { ChangeStudentPasswordDto, CreateStudentDto, UpdateAccessDto, UpdateStudentAccountDto, UpdateStudentNotificationsDto, UpdateStudentProfileDto } from './students.dto';

@Controller('students')
export class StudentsController {
  constructor(private readonly students: StudentsService, private readonly bootstrap: BootstrapService) {}

  private async buildStudentResponse(user: AuthUser, studentId: string) {
    const data = await this.bootstrap.buildForUser(user.id);
    const student = data.students.find((current: any) => current.id === studentId) || data.students[0] || null;
    return { student, data };
  }

  @Roles(ROLE.TEACHER)
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: CreateStudentDto) {
    const created = await this.students.create(user, body);
    return this.buildStudentResponse(user, created.id);
  }

  @Patch(':studentId/profile')
  async updateProfile(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string, @Body() body: UpdateStudentProfileDto) {
    await this.students.updateProfile(user, studentId, body);
    return this.buildStudentResponse(user, studentId);
  }

  @Patch(':studentId/account')
  async updateAccount(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string, @Body() body: UpdateStudentAccountDto) {
    await this.students.updateAccount(user, studentId, body);
    return this.buildStudentResponse(user, studentId);
  }

  @Post(':studentId/security/password')
  async changePassword(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string, @Body() body: ChangeStudentPasswordDto) {
    await this.students.changePassword(user, studentId, body);
    return this.buildStudentResponse(user, studentId);
  }

  @Patch(':studentId/notifications')
  async updateNotifications(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string, @Body() body: UpdateStudentNotificationsDto) {
    await this.students.updateNotifications(user, studentId, body);
    return this.buildStudentResponse(user, studentId);
  }

  @Roles(ROLE.TEACHER)
  @Post(':studentId/access')
  async updateAccess(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string, @Body() body: UpdateAccessDto) {
    await this.students.updateAccess(user, studentId, body.action);
    return this.buildStudentResponse(user, studentId);
  }
}
