import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../common/current-user';
import { Roles } from '../common/role.guard';
import { ROLE } from '../common/contracts';
import { StudentsService } from './students.service';
import { CatalogService } from '../catalog/catalog.service';
import { ChangeStudentPasswordDto, CreateStudentDto, UpdateAccessDto, UpdateStudentAccountDto, UpdateStudentNotificationsDto, UpdateStudentProfileDto } from './students.dto';

@Controller('students')
export class StudentsController {
  constructor(private readonly students: StudentsService, private readonly catalog: CatalogService) {}

  @Roles(ROLE.TEACHER)
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: CreateStudentDto) {
    const result = await this.students.create(user, body);
    return { changes: { students: [await this.catalog.student(user, result.student.id)] }, invalidated: ['students'], invite: result.invite.preview };
  }

  @Patch(':studentId/profile')
  async updateProfile(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string, @Body() body: UpdateStudentProfileDto) {
    await this.students.updateProfile(user, studentId, body);
    return { changes: { students: [await this.catalog.student(user, studentId)] } };
  }

  @Patch(':studentId/account')
  async updateAccount(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string, @Body() body: UpdateStudentAccountDto) {
    await this.students.updateAccount(user, studentId, body);
    return { changes: { students: [await this.catalog.student(user, studentId)] } };
  }

  @Post(':studentId/security/password')
  async changePassword(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string, @Body() body: ChangeStudentPasswordDto) {
    await this.students.changePassword(user, studentId, body);
    return { ok: true };
  }

  @Patch(':studentId/notifications')
  async updateNotifications(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string, @Body() body: UpdateStudentNotificationsDto) {
    await this.students.updateNotifications(user, studentId, body);
    return { changes: { students: [await this.catalog.student(user, studentId)] } };
  }

  @Roles(ROLE.TEACHER)
  @Post(':studentId/access')
  async updateAccess(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string, @Body() body: UpdateAccessDto) {
    const result = await this.students.updateAccess(user, studentId, body.action);
    return { changes: { students: [await this.catalog.student(user, studentId)] }, invite: result.invite?.preview, reset: result.reset?.preview };
  }
}
