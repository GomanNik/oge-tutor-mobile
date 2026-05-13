import { IsArray, IsISO8601, IsOptional, IsString } from 'class-validator';

export class CreateLessonDto {
  @IsString()
  studentId!: string;

  @IsString()
  topic!: string;

  @IsArray()
  @IsOptional()
  focusTaskNumbers?: number[];

  @IsISO8601()
  startAt!: string;

  @IsISO8601()
  endAt!: string;

  @IsString()
  @IsOptional()
  timezone?: string;

  @IsString()
  @IsOptional()
  source?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsArray()
  @IsOptional()
  materials?: unknown[];
}

export class UpdateLessonDto {
  @IsString()
  @IsOptional()
  studentId?: string;

  @IsString()
  @IsOptional()
  topic?: string;

  @IsArray()
  @IsOptional()
  focusTaskNumbers?: number[];

  @IsISO8601()
  @IsOptional()
  startAt?: string;

  @IsISO8601()
  @IsOptional()
  endAt?: string;

  @IsString()
  @IsOptional()
  timezone?: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  source?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsArray()
  @IsOptional()
  materials?: unknown[];
}

export class CompleteLessonDto {
  @IsArray()
  @IsOptional()
  focusTaskNumbers?: number[];

  @IsString()
  @IsOptional()
  completionComment?: string;

  @IsString()
  @IsOptional()
  comment?: string;
}
