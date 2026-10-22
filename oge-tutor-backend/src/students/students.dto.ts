import { STUDENT_ACCESS_ACTION } from '../common/contracts';
import { EmailField, EnumField, NestedField, PasswordField, RequiredText, TextField } from '../common/dto-fields';
import { SettingsDto } from '../common/settings.dto';

export class UpdateStudentProfileDto {
  @RequiredText() name!: string;
  @TextField() grade?: string;
  @TextField() goal?: string;
  @TextField() avatar?: string;
  @TextField() bg?: string;
  @TextField() note?: string;
}
export class CreateStudentDto extends UpdateStudentProfileDto {
  @EmailField() email!: string;
  @PasswordField(false) password?: string;
  @NestedField(SettingsDto) settings?: SettingsDto;
}
export class UpdateStudentAccountDto {
  @EmailField() email!: string;
}
export class ChangeStudentPasswordDto {
  @TextField(false, { writeOnly: true }) currentPassword?: string;
  @PasswordField() newPassword!: string;
}
export class UpdateAccessDto {
  @EnumField(STUDENT_ACCESS_ACTION, true) action!: string;
}
export class UpdateStudentNotificationsDto extends SettingsDto {}
