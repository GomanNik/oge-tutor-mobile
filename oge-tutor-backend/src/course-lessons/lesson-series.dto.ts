import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsEnum, IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateIf } from 'class-validator';
import { CourseFormat, LessonSeriesFrequency, LessonSeriesStatus } from '@prisma/client';

export class SeriesRuleDto {
  @ApiProperty() @IsString() @Length(1, 100) courseId!: string;
  @ApiProperty() @IsString() @Length(2, 160) @Matches(/\S/) topic!: string;
  @ApiPropertyOptional() @IsString() @Length(0, 1000) note = '';
  @ApiProperty({ enum: CourseFormat }) @IsEnum(CourseFormat) format!: CourseFormat;
  @ApiProperty({ example: '2026-11-02T18:00' }) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) startsAtLocal!: string;
  @ApiProperty({ example: '2027-02-28' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) untilLocalDate!: string;
  @ApiProperty() @IsString() @Length(1, 100) timezone!: string;
  @ApiProperty({ enum: LessonSeriesFrequency }) @IsEnum(LessonSeriesFrequency) frequency!: LessonSeriesFrequency;
  @ApiPropertyOptional({ minimum: 1, maximum: 12 }) @IsInt() @Min(1) @Max(12) interval = 1;
  @ApiPropertyOptional({ type: [Number], description: 'ISO weekdays: Monday=1, Sunday=7.' })
  @IsArray() @ArrayMaxSize(7) @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) weekdays: number[] = [];
  @ApiPropertyOptional({ type: [Number] })
  @IsArray() @ArrayMaxSize(31) @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true }) @Max(31, { each: true }) monthDays: number[] = [];
  @ApiPropertyOptional({ type: [String] }) @IsArray() @ArrayMaxSize(100) @ArrayUnique() @Matches(/^\d{4}-\d{2}-\d{2}$/, { each: true }) excludedDates: string[] = [];
  @ApiProperty({ minimum: 15, maximum: 480 }) @IsInt() @Min(15) @Max(480) durationMinutes!: number;
  @ApiPropertyOptional({ minimum: 7, maximum: 90 }) @IsInt() @Min(7) @Max(90) materializeDays = 45;
  @ApiPropertyOptional({ enum: ['reject', 'earlier', 'later'] }) @IsEnum(['reject', 'earlier', 'later']) dstDisambiguation: 'reject' | 'earlier' | 'later' = 'reject';
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ArrayUnique() @IsString({ each: true }) teacherLinkIds!: string[];
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) participantEnrollmentIds!: string[];
}
export class SeriesPreviewDto extends SeriesRuleDto {
  @ApiPropertyOptional() @ValidateIf((_, value: unknown) => value !== undefined) @IsString() @Length(5, 500) @Matches(/\S/) reason?: string;
}
export class SaveSeriesDto extends SeriesPreviewDto {
  @ApiProperty() @IsString() @Length(1, 3000) previewToken!: string;
}
export class SeriesActionPreviewDto {
  @ApiProperty({ enum: ['materialize', 'pause', 'resume', 'cancel'] }) @IsEnum(['materialize', 'pause', 'resume', 'cancel']) action!: 'materialize' | 'pause' | 'resume' | 'cancel';
  @ApiProperty() @IsString() @Length(5, 500) @Matches(/\S/) reason!: string;
}
export class SeriesActionDto extends SeriesActionPreviewDto {
  @ApiProperty() @IsString() @Length(1, 3000) previewToken!: string;
}
export class SeriesQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() courseId?: string;
  @ApiPropertyOptional({ enum: LessonSeriesStatus }) @IsOptional() @IsEnum(LessonSeriesStatus) status?: LessonSeriesStatus;
  @ApiPropertyOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @ApiPropertyOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}
