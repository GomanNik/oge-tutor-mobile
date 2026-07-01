import { IsArray, IsOptional, IsString } from 'class-validator';

export class ReplaceProgressDto {
  @IsArray()
  @IsOptional()
  progressByTask?: unknown[];
}

export class UpdateTaskProgressDto {
  @IsString()
  @IsOptional()
  coverageStatus?: string;

  @IsString()
  @IsOptional()
  masteryLevel?: string;

  @IsString()
  @IsOptional()
  teacherComment?: string;

  @IsString()
  @IsOptional()
  recommendedAction?: string;
}

export class ResolveAssessmentDto extends UpdateTaskProgressDto {}
