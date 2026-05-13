import { IsObject, IsOptional } from 'class-validator';

export class SettingsDto {
  @IsObject()
  @IsOptional()
  settings?: Record<string, unknown>;
}
