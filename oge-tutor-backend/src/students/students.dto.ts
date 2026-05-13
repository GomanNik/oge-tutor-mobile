import { IsEmail, IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateStudentDto {
  @IsEmail()
  email!: string;

  @IsString()
  name!: string;

  @IsString()
  @MinLength(6)
  @IsOptional()
  password?: string;

  @IsString()
  @IsOptional()
  grade?: string;

  @IsString()
  @IsOptional()
  goal?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsString()
  @IsOptional()
  avatar?: string;

  @IsString()
  @IsOptional()
  bg?: string;

  @IsObject()
  @IsOptional()
  settings?: Record<string, unknown>;
}

export class UpdateStudentProfileDto {
  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  grade?: string;

  @IsString()
  @IsOptional()
  goal?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsString()
  @IsOptional()
  avatar?: string;

  @IsString()
  @IsOptional()
  bg?: string;
}

export class UpdateStudentAccountDto {
  @IsEmail()
  email!: string;
}

export class ChangeStudentPasswordDto {
  @IsString()
  @IsOptional()
  currentPassword?: string;

  @IsString()
  @MinLength(6)
  newPassword!: string;
}

export class UpdateStudentNotificationsDto {
  @IsObject()
  @IsOptional()
  notifications?: Record<string, unknown>;
}

export class UpdateAccessDto {
  @IsString()
  action!: string;
}
