import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NOTIFICATION_STATUS, PROGRESS_SOURCE } from '../common/contracts';

export class CatalogQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  studentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  status?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  taskNumber?: number;

  @ApiPropertyOptional({ enum: Object.values(PROGRESS_SOURCE) })
  @IsOptional()
  @IsIn(Object.values(PROGRESS_SOURCE))
  source?: typeof PROGRESS_SOURCE[keyof typeof PROGRESS_SOURCE];
}

export class UpdateNotificationDto {
  @ApiProperty({ enum: Object.values(NOTIFICATION_STATUS) })
  @IsIn(Object.values(NOTIFICATION_STATUS))
  status!: typeof NOTIFICATION_STATUS[keyof typeof NOTIFICATION_STATUS];
}
