import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsISO8601, IsOptional, IsString, Length, Matches, Max, Min, ValidateIf } from 'class-validator';
import { LearningDeliveryStatus, LearningProgressSource, LearningVisibility, ProgressCoverageStatus, ProgressMasteryLevel } from '@prisma/client';

export class LearningPageDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 1000) cursor?: string;
}
export class ProgressEventsQueryDto extends LearningPageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) taskDefinitionId?: string;
  @ApiPropertyOptional({ enum: LearningProgressSource }) @IsOptional() @IsEnum(LearningProgressSource) source?: LearningProgressSource;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) to?: string;
}
export class CreateAssessmentDto {
  @ApiProperty() @IsString() @Length(1, 100) taskDefinitionId!: string;
  @ApiPropertyOptional({ enum: ['manual', 'diagnostic'] }) @IsEnum(['manual', 'diagnostic']) source: 'manual' | 'diagnostic' = 'manual';
  @ApiProperty({ enum: LearningVisibility }) @IsEnum(LearningVisibility) visibility!: LearningVisibility;
  @ApiPropertyOptional({ enum: ProgressCoverageStatus }) @IsOptional() @IsEnum(ProgressCoverageStatus) coverageStatus?: ProgressCoverageStatus;
  @ApiPropertyOptional({ enum: ProgressMasteryLevel }) @IsOptional() @IsEnum(ProgressMasteryLevel) masteryLevel?: ProgressMasteryLevel;
  @ApiPropertyOptional({ minimum: 0, maximum: 1000 }) @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(0) @Max(1000) score?: number;
  @ApiProperty() @IsString() @Length(5, 1000) @Matches(/\S/) basis!: string;
  @ApiProperty() @IsString() @Length(0, 5000) comment!: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) occurredAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) replacesEventId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(5, 500) @Matches(/\S/) reason?: string;
  @ApiPropertyOptional() @IsBoolean() retract = false;
}
export class ProgramProgressQueryDto {
  @ApiProperty() @IsString() @Length(1, 100) programVersionId!: string;
}
export class NotificationQueryDto extends LearningPageDto {
  @ApiPropertyOptional({ enum: ['all', 'unread', 'read'] }) @IsEnum(['all', 'unread', 'read']) status: 'all' | 'unread' | 'read' = 'all';
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) type?: string;
}
export class WorkspaceIdQueryDto {
  @ApiProperty() @IsString() @Length(1, 100) workspaceId!: string;
}
export class MyNotificationQueryDto extends NotificationQueryDto {
  @ApiProperty() @IsString() @Length(1, 100) workspaceId!: string;
}
export class MarkNotificationDto { @ApiProperty() @IsBoolean() read!: boolean; }
export class ReadAllNotificationsDto { @ApiProperty() @IsISO8601({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) before!: string; }
export class NotificationPreferenceDto { @ApiProperty() @IsBoolean() emailEnabled!: boolean; }
export class DeliveryQueryDto extends LearningPageDto {
  @ApiPropertyOptional({ enum: LearningDeliveryStatus }) @IsOptional() @IsEnum(LearningDeliveryStatus) status?: LearningDeliveryStatus;
}
export class RetryDeliveryDto { @ApiProperty() @IsString() @Length(5, 500) @Matches(/\S/) reason!: string; }
