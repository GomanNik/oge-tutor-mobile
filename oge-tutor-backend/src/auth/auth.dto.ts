import { EmailField, PasswordField, RequiredText } from '../common/dto-fields';

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
