import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsEmail, IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { InvitationStatus, MembershipStatus, WorkspaceRole } from '@prisma/client';

export class V2LoginDto {
  @ApiProperty() @IsEmail() @Length(3, 254) email!: string;
  @ApiProperty() @IsString() password!: string;
}

export class UpdateMeDto {
  @ApiProperty() @IsString() @Length(2, 100) displayName!: string;
}

export class UpdateLocalNameDto {
  @ApiProperty({ nullable: true }) @IsOptional() @IsString() @Length(2, 100) displayNameOverride!: string | null;
}

export class GrantRoleDto {
  @ApiProperty({ enum: WorkspaceRole }) @IsEnum(WorkspaceRole) role!: WorkspaceRole;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(10, 500) reason?: string;
}

export class ReasonDto {
  @ApiProperty() @IsString() @Length(10, 500) reason!: string;
}

export class OptionalReasonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(10, 500) reason?: string;
}

export class CreateInvitationDto {
  @ApiProperty() @IsEmail() @Length(3, 254) email!: string;
  @ApiProperty({ enum: WorkspaceRole, isArray: true })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @ArrayUnique() @IsEnum(WorkspaceRole, { each: true }) roles!: WorkspaceRole[];
  @ApiPropertyOptional({ minimum: 24, maximum: 168 }) @IsOptional() @IsInt() @Min(24) @Max(168) expiresInHours?: number;
}

export class AcceptNewInvitationDto {
  @ApiProperty() @IsString() token!: string;
  @ApiProperty() @IsString() @Length(2, 100) displayName!: string;
  @ApiProperty() @IsString() password!: string;
}

export class AcceptExistingInvitationDto {
  @ApiProperty() @IsString() token!: string;
}

export class MemberQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @ApiPropertyOptional({ enum: MembershipStatus }) @IsOptional() @IsEnum(MembershipStatus) status?: MembershipStatus;
  @ApiPropertyOptional({ enum: WorkspaceRole }) @IsOptional() @IsEnum(WorkspaceRole) role?: WorkspaceRole;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) q?: string;
}

export class InvitationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @ApiPropertyOptional({ enum: InvitationStatus }) @IsOptional() @IsEnum(InvitationStatus) status?: InvitationStatus;
}

export class AuditQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 80) action?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() targetId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() to?: string;
}
