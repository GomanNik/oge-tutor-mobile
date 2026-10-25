import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Allow, ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsEnum, IsInt, IsISO8601, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { AssignmentReviewDecision, AssignmentStatus } from '@prisma/client';

export class WorkPageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) courseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 160) q?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
  @ApiPropertyOptional({ minimum: 1, maximum: 100000 }) @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
}
export class AssignmentQueryDto extends WorkPageDto {
  @ApiPropertyOptional({ enum: AssignmentStatus }) @IsOptional() @IsEnum(AssignmentStatus) status?: AssignmentStatus;
}
export class CreateAssignmentDto {
  @ApiProperty() @IsString() @Length(1, 100) courseId!: string;
  @ApiProperty() @IsString() @Length(2, 160) @Matches(/\S/) title!: string;
  @ApiProperty() @IsString() @Length(1, 20000) @Matches(/\S/) instructions!: string;
  @ApiProperty({ type: [String], maxItems: 100 })
  @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) taskDefinitionIds!: string[];
  @ApiProperty() @IsISO8601({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) dueAt!: string;
  @ApiProperty({ type: [String], maxItems: 10 })
  @IsArray() @ArrayMaxSize(10) @ArrayUnique() @IsString({ each: true }) fileIds!: string[];
}
export class UpdateAssignmentDto extends PartialType(OmitType(CreateAssignmentDto, ['courseId'] as const)) {}
export class AssignmentRecipientsDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 100 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) recipientEnrollmentIds!: string[];
}
export class WorkReasonDto {
  @ApiProperty() @IsString() @Length(5, 500) @Matches(/\S/) reason!: string;
}
export class EmptyWorkDto { @Allow() readonly __empty?: undefined; }
export class UpdateRecipientDto extends WorkReasonDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) dueAt?: string;
  @ApiPropertyOptional({ enum: ['exempted', 'closed', 'assigned'] })
  @IsOptional() @IsEnum(['exempted', 'closed', 'assigned']) status?: 'exempted' | 'closed' | 'assigned';
}
export class SubmitAssignmentDto {
  @ApiProperty() @IsString() @Length(0, 30000) text!: string;
  @ApiProperty({ type: [String], maxItems: 10 })
  @IsArray() @ArrayMaxSize(10) @ArrayUnique() @IsString({ each: true }) fileIds!: string[];
}
export class ReviewScoreDto {
  @ApiProperty() @IsString() @Length(1, 100) taskDefinitionId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) criterionCode?: string;
  @ApiProperty({ minimum: 0, maximum: 1000 }) @IsInt() @Min(0) @Max(1000) score!: number;
}
export class CreateReviewDto {
  @ApiProperty({ enum: AssignmentReviewDecision }) @IsEnum(AssignmentReviewDecision) decision!: AssignmentReviewDecision;
  @ApiProperty() @IsString() @Length(0, 10000) comment!: string;
  @ApiProperty({ type: [ReviewScoreDto], maxItems: 300 }) @IsArray() @ArrayMaxSize(300)
  @ArrayUnique((item: ReviewScoreDto) => `${item.taskDefinitionId}:${item.criterionCode || ''}`)
  @ValidateNested({ each: true }) @Type(() => ReviewScoreDto) scores!: ReviewScoreDto[];
  @ApiProperty({ type: [String], maxItems: 10 })
  @IsArray() @ArrayMaxSize(10) @ArrayUnique() @IsString({ each: true }) fileIds!: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(5, 500) @Matches(/\S/) reason?: string;
}
export class MaterialQueryDto extends WorkPageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) programVersionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) taskDefinitionId?: string;
  @ApiPropertyOptional({ enum: ['active', 'archived'] }) @IsOptional() @IsEnum(['active', 'archived']) status?: 'active' | 'archived';
}
export class CreateLearningMaterialDto {
  @ApiProperty() @IsString() @Length(1, 100) programVersionId!: string;
  @ApiProperty() @IsString() @Length(2, 160) @Matches(/\S/) title!: string;
  @ApiProperty() @IsString() @Length(0, 10000) description!: string;
  @ApiProperty({ type: [String], maxItems: 100 })
  @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) taskDefinitionIds!: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) fileId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 2000) url?: string;
}
export class UpdateLearningMaterialDto extends PartialType(OmitType(CreateLearningMaterialDto, ['programVersionId'] as const)) {}
export class PublishMaterialDto extends AssignmentRecipientsDto {
  @ApiProperty() @IsString() @Length(1, 100) courseId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) lessonId?: string;
}
