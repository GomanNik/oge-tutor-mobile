import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUrl, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { CatalogStatus, ExamType, ProgramVersionStatus, ScoringRuleKind, TaskKind } from '@prisma/client';

const CODE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const PERIOD = /^[a-z0-9][a-z0-9-]{1,31}$/;

export class CatalogQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() workspaceId?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
  @ApiPropertyOptional({ minimum: 1, maximum: 100000 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) q?: string;
  @ApiPropertyOptional({ enum: CatalogStatus }) @IsOptional() @IsEnum(CatalogStatus) status?: CatalogStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() subjectId?: string;
  @ApiPropertyOptional({ enum: ExamType }) @IsOptional() @IsEnum(ExamType) examType?: ExamType;
  @ApiPropertyOptional() @IsOptional() @Matches(CODE) variant?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(PERIOD) period?: string;
  @ApiPropertyOptional({ enum: ProgramVersionStatus }) @IsOptional() @IsEnum(ProgramVersionStatus) versionStatus?: ProgramVersionStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() fromVersionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() toVersionId?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value) @IsBoolean() includeRevoked?: boolean;
}

export class CreateSubjectDto {
  @ApiPropertyOptional() @IsOptional() @IsString() workspaceId?: string;
  @ApiProperty() @Matches(CODE) code!: string;
  @ApiProperty() @IsString() @Length(2, 100) name!: string;
}

export class UpdateSubjectDto {
  @ApiProperty() @IsString() @Length(2, 100) name!: string;
}

export class CreateProgramDto {
  @ApiPropertyOptional() @IsOptional() @IsString() workspaceId?: string;
  @ApiProperty() @IsString() subjectId!: string;
  @ApiProperty() @Matches(CODE) code!: string;
  @ApiProperty({ enum: ExamType }) @IsEnum(ExamType) examType!: ExamType;
  @ApiProperty() @Matches(CODE) variant!: string;
  @ApiProperty() @IsString() @Length(2, 120) name!: string;
}

export class UpdateProgramDto {
  @ApiProperty() @IsString() @Length(2, 120) name!: string;
}

export class CreateProgramVersionDto {
  @ApiProperty() @Matches(PERIOD) period!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) revisionNumber!: number;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) sourceUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 2000) notes?: string;
}

export class UpdateProgramVersionDto {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) sourceUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 2000) notes?: string;
}

export class TaskCriterionDto {
  @ApiProperty() @Matches(CODE) code!: string;
  @ApiProperty() @IsString() @Length(2, 200) title!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(1000) maxScore!: number;
}

export class TaskInputDto {
  @ApiProperty() @IsString() @Length(1, 32) code!: string;
  @ApiProperty() @IsString() @Length(2, 200) title!: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsString({ each: true }) topics!: string[];
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(10000) position!: number;
  @ApiProperty({ enum: TaskKind }) @IsEnum(TaskKind) kind!: TaskKind;
  @ApiProperty({ minimum: 1, maximum: 1000 }) @IsInt() @Min(1) @Max(1000) maxScore!: number;
  @ApiProperty({ type: [TaskCriterionDto] }) @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => TaskCriterionDto) criteria!: TaskCriterionDto[];
}

export class ScoringRuleDto {
  @ApiProperty({ enum: ScoringRuleKind }) @IsEnum(ScoringRuleKind) kind!: ScoringRuleKind;
  @ApiProperty() @Matches(CODE) code!: string;
  @ApiProperty() @IsString() @Length(10, 1000) description!: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) sourceUrl?: string;
}

export class CreateTaskMappingDto {
  @ApiProperty() @IsString() fromTaskId!: string;
  @ApiProperty() @IsString() toTaskId!: string;
  @ApiProperty() @IsString() @Length(10, 500) reason!: string;
}

export class RevokeTaskMappingDto {
  @ApiProperty() @IsString() @Length(10, 500) reason!: string;
}
