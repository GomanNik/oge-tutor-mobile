import { IsOptional, IsString } from 'class-validator';

export class UploadFileMetaDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  context?: string;
}
