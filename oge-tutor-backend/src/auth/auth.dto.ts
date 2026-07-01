import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

export class PasswordResetDto {
  @IsEmail()
  email!: string;
}

export class AccessTokenVerifyDto {
  @IsString()
  token!: string;
}

export class AccessTokenCompleteDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}
