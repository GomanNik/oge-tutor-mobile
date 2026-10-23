import { EmailField, PasswordField, RequiredText, TextField } from '../common/dto-fields';
import { SettingsDto } from '../common/settings.dto';

export class UpdateTeacherProfileDto {
  @RequiredText() name!: string;
  @TextField() avatar?: string;
  @TextField() bg?: string;
}
export class UpdateTeacherAccountDto {
  @EmailField() email!: string;
}
export class ChangeTeacherPasswordDto {
  @PasswordField() currentPassword!: string;
  @PasswordField() newPassword!: string;
}
export class UpdateTeacherNotificationsDto extends SettingsDto {}
