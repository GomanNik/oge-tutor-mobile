import { Body, Controller, Patch, Post } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../common/current-user';
import { Roles } from '../common/role.guard';
import { ROLE } from '../common/contracts';
import { TeacherService } from './teacher.service';
import { BootstrapService } from '../bootstrap/bootstrap.service';
import { ChangeTeacherPasswordDto, UpdateTeacherAccountDto, UpdateTeacherNotificationsDto, UpdateTeacherProfileDto } from './teacher.dto';

@Roles(ROLE.TEACHER)
@Controller('teacher')
export class TeacherController {
  constructor(private readonly teacher: TeacherService, private readonly bootstrap: BootstrapService) {}

  private async buildTeacherResponse(user: AuthUser) {
    const data = await this.bootstrap.buildForUser(user.id);
    return { teacher: data.teacher, data };
  }

  @Patch('profile')
  async updateProfile(@CurrentUser() user: AuthUser, @Body() body: UpdateTeacherProfileDto) {
    await this.teacher.updateProfile(user, body);
    return this.buildTeacherResponse(user);
  }

  @Patch('account')
  async updateAccount(@CurrentUser() user: AuthUser, @Body() body: UpdateTeacherAccountDto) {
    await this.teacher.updateAccount(user, body);
    return this.buildTeacherResponse(user);
  }

  @Post('security/password')
  async changePassword(@CurrentUser() user: AuthUser, @Body() body: ChangeTeacherPasswordDto) {
    await this.teacher.changePassword(user, body);
    return this.buildTeacherResponse(user);
  }

  @Patch('notifications')
  async updateNotifications(@CurrentUser() user: AuthUser, @Body() body: UpdateTeacherNotificationsDto) {
    await this.teacher.updateNotifications(user, body);
    return this.buildTeacherResponse(user);
  }
}
