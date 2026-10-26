import { EmailField, PasswordField, RequiredText } from '../common/dto-fields';
import { MaxLength } from 'class-validator';

export class LoginDto {
  @EmailField() email!: string;
  @PasswordField() password!: string;
}
export class PasswordResetDto {
  @EmailField() email!: string;
}
export class AccessTokenVerifyDto {
  @RequiredText() token!: string;
}
export class AccessTokenCompleteDto extends AccessTokenVerifyDto {
  @PasswordField() password!: string;
}
export class ChangeAccountPasswordDto {
  @RequiredText() @MaxLength(1024) currentPassword!: string;
  @PasswordField() @MaxLength(72) newPassword!: string;
}
