import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard, minutes } from '@nestjs/throttler';
import { WorkspaceRole } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AccessTokenService } from '../auth/access-token.service';
import { AccessTokenCompleteDto, AccessTokenVerifyDto, ChangeAccountPasswordDto, PasswordResetDto } from '../auth/auth.dto';
import { Public } from '../auth/public.decorator';
import { CurrentUser, AuthUser } from '../common/current-user';
import { AppError, notFound } from '../common/app-error';
import { WorkspaceContextService } from './workspace-context.service';
import { WorkspaceMembersService } from './workspace-members.service';
import { WorkspaceInvitationsService } from './workspace-invitations.service';
import {
  AcceptExistingInvitationDto, AcceptNewInvitationDto, AuditQueryDto, CreateInvitationDto,
  GrantRoleDto, InvitationQueryDto, MemberQueryDto, OptionalReasonDto, ReasonDto,
  UpdateLocalNameDto, UpdateMeDto, V2LoginDto,
} from './workspace.dto';

type RequestWithId = Request & { requestId?: string };
function requestId(req: RequestWithId) { return req.requestId || ''; }
function revision(header?: string) {
  const value = String(header || '').replace(/^"|"$/g, '');
  if (!value) throw new AppError(428, 'precondition_required', 'Нужен заголовок If-Match.');
  if (!/^\d+$/.test(value)) throw new AppError(400, 'invalid_revision', 'Некорректная ревизия.');
  return Number(value);
}
function idempotencyKey(header?: string) {
  if (!header || header.length > 128) throw new AppError(400, 'missing_idempotency_key', 'Нужен Idempotency-Key длиной до 128 символов.');
  return header;
}
const objectResponse = { schema: { type: 'object', additionalProperties: false, properties: { item: { type: 'object' }, changed: { type: 'array', items: { type: 'string' } }, requestId: { type: 'string' } } } } as const;
const listResponse = { schema: { type: 'object', additionalProperties: false, properties: { items: { type: 'array', items: { type: 'object' } }, pageInfo: { type: 'object', properties: { nextCursor: { type: 'string', nullable: true }, hasMore: { type: 'boolean' } } } } } } as const;

@ApiTags('v2-auth')
@Controller('api/v2')
@UseGuards(ThrottlerGuard)
export class WorkspaceAccountController {
  constructor(private readonly auth: AuthService, private readonly prisma: PrismaService, private readonly contexts: WorkspaceContextService, private readonly accessTokens: AccessTokenService) {}

  @Public() @Post('auth/login') @HttpCode(200)
  @Throttle({ target: { limit: 8, ttl: minutes(15) } })
  @ApiOkResponse({ schema: { type: 'object', properties: { session: { type: 'object' }, user: { type: 'object' }, contexts: { type: 'array', items: { type: 'object' } } } } })
  async login(@Body() body: V2LoginDto) {
    const account = await this.auth.validateAccountCredentials(body.email, body.password);
    const session = await this.auth.signAccountSession(account.id, account.passwordHash);
    return { session, user: { id: account.id, email: account.email, displayName: account.displayName, revision: account.revision, catalogManage: Boolean(await this.prisma.catalogGrant.findUnique({ where: { userId: account.id } })) }, contexts: await this.contexts.listMyContexts(account.id) };
  }

  @Public() @Post('auth/password-reset') @HttpCode(200)
  @Throttle({ ip: { limit: 10, ttl: minutes(1) }, target: { limit: 3, ttl: minutes(15) } })
  async passwordReset(@Body() body: PasswordResetDto) { return this.auth.requestPasswordReset(body.email, true); }

  @Public() @Post('auth/access-token/verify') @HttpCode(200)
  @Throttle({ target: { limit: 10, ttl: minutes(15) } })
  async verifyToken(@Body() body: AccessTokenVerifyDto) { return this.accessTokens.verify(body.token, true); }

  @Public() @Post('auth/access-token/complete') @HttpCode(200)
  @Throttle({ ip: { limit: 20, ttl: minutes(1) }, target: { limit: 5, ttl: minutes(15) } })
  async completeToken(@Body() body: AccessTokenCompleteDto) { return this.accessTokens.complete(body.token, body.password, true); }

  @ApiBearerAuth() @Post('me/password') @HttpCode(200)
  @Throttle({ target: { limit: 5, ttl: minutes(15) } })
  async password(@CurrentUser() user: AuthUser, @Body() body: ChangeAccountPasswordDto) { return this.auth.changeAccountPassword(user.id, body.currentPassword, body.newPassword); }

  @ApiBearerAuth() @Post('auth/logout') @HttpCode(204)
  @ApiNoContentResponse({ description: 'Current session revoked.' })
  async logout(@CurrentUser() user: AuthUser) { await this.auth.revokeSession(user.id, user.sessionId); }

  @ApiBearerAuth() @Get('me') @ApiOkResponse(objectResponse)
  async me(@CurrentUser() user: AuthUser) {
    const row = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!row) throw notFound();
    return { item: { id: row.id, email: row.email, displayName: row.displayName, revision: row.revision, catalogManage: Boolean(await this.prisma.catalogGrant.findUnique({ where: { userId: user.id } })) } };
  }

  @ApiBearerAuth() @Patch('me') @ApiOkResponse(objectResponse)
  async updateMe(@CurrentUser() user: AuthUser, @Body() body: UpdateMeDto, @Headers('if-match') match: string, @Req() req: RequestWithId) {
    const expected = revision(match);
    const displayName = body.displayName.trim();
    if (displayName.length < 2) throw new AppError(400, 'invalid_name', 'Имя должно содержать не менее двух символов.');
    const updated = await this.prisma.user.updateMany({ where: { id: user.id, revision: expected }, data: { displayName, revision: { increment: 1 } } });
    if (updated.count !== 1) throw new AppError(412, 'revision_mismatch', 'Профиль изменился. Обновите страницу.');
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return { item: { id: row.id, email: row.email, displayName: row.displayName, revision: row.revision, catalogManage: Boolean(await this.prisma.catalogGrant.findUnique({ where: { userId: user.id } })) }, changed: ['me'], requestId: requestId(req) };
  }

  @ApiBearerAuth() @Get('me/workspaces') @ApiOkResponse(listResponse)
  async myWorkspaces(@CurrentUser() user: AuthUser) {
    return { items: await this.contexts.listMyContexts(user.id), pageInfo: { nextCursor: null, hasMore: false } };
  }
}

@ApiTags('v2-workspaces')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Active-Role', required: true, enum: ['admin', 'teacher', 'student'] })
@Controller('api/v2/workspaces/:workspaceId')
export class WorkspaceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contexts: WorkspaceContextService,
    private readonly members: WorkspaceMembersService,
    private readonly invitations: WorkspaceInvitationsService,
  ) {}

  private ctx(user: AuthUser, workspaceId: string, role: string, req: RequestWithId) {
    return this.contexts.resolve(user, workspaceId, role, requestId(req));
  }

  @Get() @ApiOkResponse(objectResponse)
  async getWorkspace(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId) {
    await this.ctx(user, w, role, req);
    const row = await this.prisma.workspace.findUniqueOrThrow({ where: { id: w } });
    return { item: { id: row.id, name: row.name, timezone: row.timezone, status: row.status, revision: row.revision } };
  }

  @Get('members') @ApiOkResponse(listResponse)
  async listMembers(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Query() query: MemberQueryDto) {
    return this.members.list(await this.ctx(user, w, role, req), query);
  }

  @Get('members/:memberId') @ApiOkResponse(objectResponse)
  async getMember(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('memberId') id: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId) {
    return { item: await this.members.get(await this.ctx(user, w, role, req), id) };
  }

  @Patch('members/:memberId') @ApiOkResponse(objectResponse)
  async updateMember(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('memberId') id: string, @Headers('x-active-role') role: string, @Headers('if-match') match: string, @Req() req: RequestWithId, @Body() body: UpdateLocalNameDto) {
    return this.members.updateLocalName(await this.ctx(user, w, role, req), id, body, revision(match));
  }

  @Post('members/:memberId/roles') @HttpCode(200) @ApiOkResponse(objectResponse)
  async grantRole(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('memberId') id: string, @Headers('x-active-role') role: string, @Headers('idempotency-key') key: string, @Req() req: RequestWithId, @Body() body: GrantRoleDto) {
    return this.members.grantRole(await this.ctx(user, w, role, req), id, body, idempotencyKey(key));
  }

  @Post('members/:memberId/roles/:role/revoke') @HttpCode(200) @ApiOkResponse(objectResponse)
  async revokeRole(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('memberId') id: string, @Param('role') targetRole: string, @Headers('x-active-role') role: string, @Headers('if-match') match: string, @Req() req: RequestWithId, @Body() body: ReasonDto) {
    if (!Object.values(WorkspaceRole).includes(targetRole as WorkspaceRole)) throw new AppError(400, 'invalid_role', 'Неизвестная роль.');
    return this.members.revokeRole(await this.ctx(user, w, role, req), id, targetRole as WorkspaceRole, body.reason, revision(match));
  }

  @Post('members/:memberId/suspend') @HttpCode(200) @ApiOkResponse(objectResponse)
  async suspend(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('memberId') id: string, @Headers('x-active-role') role: string, @Headers('if-match') match: string, @Req() req: RequestWithId, @Body() body: ReasonDto) {
    return this.members.setSuspended(await this.ctx(user, w, role, req), id, true, body.reason, revision(match));
  }

  @Post('members/:memberId/resume') @HttpCode(200) @ApiOkResponse(objectResponse)
  async resume(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('memberId') id: string, @Headers('x-active-role') role: string, @Headers('if-match') match: string, @Req() req: RequestWithId, @Body() body: ReasonDto) {
    return this.members.setSuspended(await this.ctx(user, w, role, req), id, false, body.reason, revision(match));
  }

  @Get('invitations') @ApiOkResponse(listResponse)
  async listInvitations(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Query() query: InvitationQueryDto) {
    return this.invitations.list(await this.ctx(user, w, role, req), query);
  }

  @Post('invitations') @HttpCode(200) @UseGuards(ThrottlerGuard)
  @Throttle({ ip: { limit: 30, ttl: minutes(15) }, target: { limit: 5, ttl: minutes(15) } })
  @ApiOkResponse(objectResponse)
  async invite(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Headers('x-active-role') role: string, @Headers('idempotency-key') key: string, @Req() req: RequestWithId, @Body() body: CreateInvitationDto) {
    return this.invitations.create(await this.ctx(user, w, role, req), body, idempotencyKey(key));
  }

  @Post('invitations/:id/resend') @HttpCode(200) @UseGuards(ThrottlerGuard)
  @Throttle({ ip: { limit: 20, ttl: minutes(15) }, target: { limit: 5, ttl: minutes(15) } })
  @ApiOkResponse(objectResponse)
  async resend(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('id') id: string, @Headers('x-active-role') role: string, @Headers('if-match') match: string, @Req() req: RequestWithId, @Body() _body: OptionalReasonDto) {
    return this.invitations.resend(await this.ctx(user, w, role, req), id, revision(match));
  }

  @Post('invitations/:id/revoke') @HttpCode(200) @ApiOkResponse(objectResponse)
  async revoke(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Param('id') id: string, @Headers('x-active-role') role: string, @Headers('if-match') match: string, @Req() req: RequestWithId, @Body() body: OptionalReasonDto) {
    return this.invitations.revoke(await this.ctx(user, w, role, req), id, revision(match), body.reason);
  }

  @Get('audit-events') @ApiOkResponse(listResponse)
  async audit(@CurrentUser() user: AuthUser, @Param('workspaceId') w: string, @Headers('x-active-role') role: string, @Req() req: RequestWithId, @Query() query: AuditQueryDto) {
    return this.members.listAudit(await this.ctx(user, w, role, req), query);
  }
}

@ApiTags('v2-invitations')
@Controller('api/v2/invitations')
@UseGuards(ThrottlerGuard)
export class WorkspaceInvitationAcceptanceController {
  constructor(private readonly invitations: WorkspaceInvitationsService) {}

  @Public() @Post('accept-new') @HttpCode(200)
  @Throttle({ ip: { limit: 10, ttl: minutes(15) }, target: { limit: 5, ttl: minutes(15) } })
  @ApiOkResponse({ schema: { type: 'object', properties: { session: { type: 'object' }, user: { type: 'object' }, contexts: { type: 'array', items: { type: 'object' } } } } })
  async acceptNew(@Body() body: AcceptNewInvitationDto, @Req() req: RequestWithId) {
    return this.invitations.acceptNew(body.token, body.displayName, body.password, requestId(req));
  }

  @ApiBearerAuth() @Post('accept-existing') @HttpCode(200) @ApiOkResponse(objectResponse)
  async acceptExisting(@CurrentUser() user: AuthUser, @Body() body: AcceptExistingInvitationDto, @Req() req: RequestWithId) {
    return this.invitations.acceptExisting(user.id, body.token, requestId(req));
  }
}
