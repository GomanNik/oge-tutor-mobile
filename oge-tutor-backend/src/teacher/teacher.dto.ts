import { IsEmail, IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateTeacherProfileDto {
  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  avatar?: string;

  @IsString()
  @IsOptional()
  bg?: string;
}

export class UpdateTeacherAccountDto {
  @IsEmail()
  email!: string;
}

export class ChangeTeacherPasswordDto {
  @IsString()
  @MinLength(6)
  currentPassword!: string;

  @IsString()
  @MinLength(6)
  newPassword!: string;
}

export class UpdateTeacherNotificationsDto {
  @IsObject()
  @IsOptional()
  settings?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  notifications?: Record<string, unknown>;
}
