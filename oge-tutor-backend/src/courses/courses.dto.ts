import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsEnum, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { CourseFormat, CourseStatus, CourseTeacherRole, CourseTeacherStatus, EnrollmentStatus } from '@prisma/client';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CourseQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) q?: string;
  @ApiPropertyOptional({ enum: CourseStatus }) @IsOptional() @IsEnum(CourseStatus) status?: CourseStatus;
  @ApiPropertyOptional({ enum: CourseFormat }) @IsOptional() @IsEnum(CourseFormat) format?: CourseFormat;
  @ApiPropertyOptional() @IsOptional() @IsString() programVersionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() teacherUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() studentUserId?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
  @ApiPropertyOptional({ minimum: 1, maximum: 100000 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
}

export class CreateCourseDto {
  @ApiProperty() @IsString() programVersionId!: string;
  @ApiProperty() @IsString() @Length(2, 120) title!: string;
  @ApiProperty({ enum: CourseFormat }) @IsEnum(CourseFormat) defaultFormat!: CourseFormat;
  @ApiProperty({ minimum: 1, maximum: 100 }) @IsInt() @Min(1) @Max(100) capacity!: number;
  @ApiProperty() @Matches(DATE) startsOn!: string;
  @ApiProperty() @Matches(DATE) endsOn!: string;
  @ApiProperty() @IsString() @Length(1, 100) timezone!: string;
  @ApiProperty() @IsString() leadTeacherUserId!: string;
}

export class UpdateCourseDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 120) title?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100 }) @IsOptional() @IsInt() @Min(1) @Max(100) capacity?: number;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) endsOn?: string;
}

export class AddCourseTeacherDto {
  @ApiProperty() @IsString() teacherUserId!: string;
  @ApiProperty({ enum: CourseTeacherRole }) @IsEnum(CourseTeacherRole) role!: CourseTeacherRole;
}

export class UpdateCourseTeacherDto {
  @ApiPropertyOptional({ enum: CourseTeacherRole }) @IsOptional() @IsEnum(CourseTeacherRole) role?: CourseTeacherRole;
  @ApiPropertyOptional({ enum: CourseTeacherStatus }) @IsOptional() @IsEnum(CourseTeacherStatus) status?: CourseTeacherStatus;
}

export class CreateEnrollmentDto {
  @ApiProperty() @IsString() studentUserId!: string;
  @ApiPropertyOptional({ enum: ['invited', 'active'] }) @IsOptional() @IsEnum(['invited', 'active']) status?: 'invited' | 'active';
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 500) goal?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 1000) note?: string;
}

export class UpdateEnrollmentDto {
  @ApiPropertyOptional({ enum: EnrollmentStatus }) @IsOptional() @IsEnum(EnrollmentStatus) status?: EnrollmentStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 500) goal?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 1000) note?: string;
}

export class EnrollmentBatchDto {
  @ApiProperty() @IsString() courseId!: string;
  @ApiProperty({ type: [String], minItems: 1, maxItems: 50 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ArrayUnique() @IsString({ each: true }) studentUserIds!: string[];
  @ApiPropertyOptional({ enum: ['invited', 'active'] }) @IsOptional() @IsEnum(['invited', 'active']) status?: 'invited' | 'active';
}
