import { Allow, IsObject, IsOptional, IsString } from 'class-validator';

export class AddMaterialDto {
  @Allow()
  taskNumber!: unknown;

  @IsString()
  @IsOptional()
  topicTitle?: string;

  @IsString()
  type!: string;

  @IsString()
  @IsOptional()
  fileId?: string;

  @IsString()
  @IsOptional()
  url?: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsObject()
  @IsOptional()
  item?: Record<string, unknown>;
}

export class UpdateMaterialFileDto {
  @Allow()
  @IsOptional()
  taskNumber?: unknown;

  @IsString()
  @IsOptional()
  topicTitle?: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  type?: string;

  @IsString()
  @IsOptional()
  fileId?: string;

  @IsString()
  @IsOptional()
  url?: string;

  @IsObject()
  @IsOptional()
  item?: Record<string, unknown>;
}
