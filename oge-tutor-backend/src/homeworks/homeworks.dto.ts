import { IsArray, IsISO8601, IsOptional, IsString } from 'class-validator';

export class CreateHomeworkDto {
  @IsString()
  studentId!: string;

  @IsString()
  title!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  topic?: string;

  @IsArray()
  taskNumbers!: number[];

  @IsISO8601()
  dueAt!: string;

  @IsArray()
  @IsOptional()
  materials?: unknown[];
}

export class UpdateHomeworkDto {
  @IsString()
  @IsOptional()
  studentId?: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  topic?: string;

  @IsArray()
  @IsOptional()
  taskNumbers?: number[];

  @IsISO8601()
  @IsOptional()
  dueAt?: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsArray()
  @IsOptional()
  materials?: unknown[];
}

export class ReviewHomeworkDto {
  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  action?: string;

  @IsString()
  @IsOptional()
  reviewAction?: string;

  @IsString()
  @IsOptional()
  comment?: string;

  @IsString()
  @IsOptional()
  teacherComment?: string;

  @IsArray()
  @IsOptional()
  reviewMaterials?: unknown[];
}
