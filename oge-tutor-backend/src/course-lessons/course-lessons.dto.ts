import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsEnum, IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { CourseFormat, LessonAttendance } from '@prisma/client';

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export class LessonCalendarQueryDto {
  @ApiProperty() @Matches(TIMESTAMP) from!: string;
  @ApiProperty() @Matches(TIMESTAMP) to!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() courseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() teacherUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() studentUserId?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
  @ApiPropertyOptional({ minimum: 1, maximum: 100000 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
}

export class CreateCourseLessonDto {
  @ApiProperty() @IsString() courseId!: string;
  @ApiProperty() @IsString() @Length(2, 160) @Matches(/\S/) topic!: string;
  @ApiProperty() @Matches(TIMESTAMP) startAt!: string;
  @ApiProperty() @Matches(TIMESTAMP) endAt!: string;
  @ApiProperty() @IsString() @Length(1, 100) timezone!: string;
  @ApiPropertyOptional({ enum: CourseFormat }) @IsOptional() @IsEnum(CourseFormat) format?: CourseFormat;
  @ApiProperty({ type: [String], minItems: 1, maxItems: 100 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) participantEnrollmentIds!: string[];
  @ApiProperty({ type: [String], minItems: 1, maxItems: 10 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ArrayUnique() @IsString({ each: true }) teacherLinkIds!: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 1000) note?: string;
}

export class UpdateCourseLessonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 160) @Matches(/\S/) topic?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(TIMESTAMP) startAt?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(TIMESTAMP) endAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) timezone?: string;
  @ApiPropertyOptional({ enum: CourseFormat }) @IsOptional() @IsEnum(CourseFormat) format?: CourseFormat;
  @ApiPropertyOptional({ type: [String], minItems: 1, maxItems: 100 })
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) participantEnrollmentIds?: string[];
  @ApiPropertyOptional({ type: [String], minItems: 1, maxItems: 10 })
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ArrayUnique() @IsString({ each: true }) teacherLinkIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 1000) note?: string;
}

export class LessonAttendanceInputDto {
  @ApiProperty() @IsString() enrollmentId!: string;
  @ApiProperty({ enum: ['present', 'absent', 'excused'] })
  @IsEnum(['present', 'absent', 'excused']) attendance!: Exclude<LessonAttendance, 'unknown'>;
}

export class CompleteCourseLessonDto {
  @ApiProperty({ type: [LessonAttendanceInputDto], minItems: 1 })
  @IsArray() @ArrayMinSize(1) @ArrayUnique((item: LessonAttendanceInputDto) => item.enrollmentId)
  @ValidateNested({ each: true }) @Type(() => LessonAttendanceInputDto) attendance!: LessonAttendanceInputDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 1000) completionComment?: string;
}

export class CorrectLessonAttendanceDto {
  @ApiProperty() @IsString() enrollmentId!: string;
  @ApiProperty({ enum: ['present', 'absent', 'excused'] })
  @IsEnum(['present', 'absent', 'excused']) attendance!: Exclude<LessonAttendance, 'unknown'>;
  @ApiProperty() @IsString() @Length(5, 500) @Matches(/\S/) reason!: string;
}

export class CancelCourseLessonDto {
  @ApiProperty() @IsString() @Length(5, 500) @Matches(/\S/) reason!: string;
}
