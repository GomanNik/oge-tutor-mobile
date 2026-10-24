import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WorkspaceRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuthMailerService } from '../auth/auth-mailer.service';
import { getJwtSecret } from '../auth/auth-config';
import { AppError, forbidden, notFound } from '../common/app-error';
import { validateEmail, validatePassword } from '../common/validation';
import { WorkspaceContext, WorkspaceContextService } from './workspace-context.service';
import { CreateInvitationDto, InvitationQueryDto } from './workspace.dto';
import { recordOutboxDeliveryFailure } from '../observability/metrics';

type InviteRow = Prisma.WorkspaceInvitationGetPayload<{ include: { roles: true; workspace: true } }>;

function fail(code: string, message: string, status = 409): never { throw new AppError(status, code, message); }
function tokenHash(token: string) { return createHash('sha256').update(token).digest('hex'); }
function bodyHash(body: unknown) { return createHash('sha256').update(JSON.stringify(body)).digest('hex'); }
function invitationDto(row: InviteRow) {
  return { id: row.id, email: row.email, roles: row.roles.map(role => role.role), expiresAt: row.expiresAt.toISOString(), status: row.status, deliveryStatus: row.deliveryStatus, revision: row.revision };
}
function isAcceptanceConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034');
}

@Injectable()
export class WorkspaceInvitationsService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: WorkspaceContextService,
    private readonly auth: AuthService,
    private readonly mailer: AuthMailerService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => { void this.flushPending().catch(() => { /* The next sweep retries after a transient database failure. */ }); }, 15000);
    this.timer.unref?.();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private encryptionKey() {
    return createHash('sha256').update(this.config.get<string>('WORKSPACE_INVITE_KEY') || getJwtSecret(this.config)).digest();
  }

  private encrypt(link: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(link, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64url')).join('.');
  }

  private decrypt(encoded: string) {
    const parts = encoded.split('.').map(part => Buffer.from(part, 'base64url'));
    if (parts.length !== 3) throw new Error('Invalid invitation payload');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), parts[0]);
    decipher.setAuthTag(parts[1]);
    return Buffer.concat([decipher.update(parts[2]), decipher.final()]).toString('utf8');
  }

  private makeToken(expiresAt: Date) {
    const token = randomBytes(32).toString('base64url');
    const origin = (this.config.get<string>('APP_FRONTEND_URL') || 'http://localhost:5173').replace(/\/$/, '');
    return { tokenHash: tokenHash(token), encryptedLink: this.encrypt(`${origin}/workspace-invite?token=${encodeURIComponent(token)}`), expiresAt };
  }

  private async adminInTx(tx: Prisma.TransactionClient, ctx: WorkspaceContext) {
    this.context.requireAdmin(ctx);
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${ctx.workspaceId} FOR UPDATE`;
    const member = await tx.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: ctx.userId } }, include: { roles: true },
    });
    if (member?.status !== 'active' || !member.roles.some(role => role.role === 'admin' && !role.revokedAt)) throw forbidden();
  }

  async list(ctx: WorkspaceContext, query: InvitationQueryDto) {
    this.context.requireAdmin(ctx);
    const scope = bodyHash({ workspaceId: ctx.workspaceId, status: query.status });
    let cursor: { at: Date; id: string } | undefined;
    if (query.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
        cursor = { at: new Date(decoded.at), id: decoded.id };
        if (decoded.scope !== scope || !cursor.id || Number.isNaN(cursor.at.getTime())) throw new Error('bad cursor');
      } catch { fail('invalid_cursor', 'Некорректный курсор страницы.', 400); }
    }
    const limit = query.limit || 25;
    const conditions: Prisma.Sql[] = [Prisma.sql`i."workspaceId" = ${ctx.workspaceId}`];
    if (query.status) conditions.push(Prisma.sql`i.status = ${query.status}::"InvitationStatus"`);
    if (cursor) conditions.push(Prisma.sql`(i."createdAt",i.id) > (${cursor.at},${cursor.id})`);
    const ids = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT i.id FROM "WorkspaceInvitation" i
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY i."createdAt",i.id LIMIT ${limit + 1}
    `);
    const rowsById = await this.prisma.workspaceInvitation.findMany({
      where: { id: { in: ids.map(row => row.id) }, workspaceId: ctx.workspaceId },
      include: { roles: true, workspace: true },
    });
    const byId = new Map(rowsById.map(row => [row.id, row]));
    const rows = ids.map(row => byId.get(row.id)!).filter(Boolean);
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return { items: items.map(invitationDto), pageInfo: { hasMore: rows.length > limit, nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ at: last.createdAt.toISOString(), id: last.id, scope })).toString('base64url') : null } };
  }

  async create(ctx: WorkspaceContext, body: CreateInvitationDto, idempotencyKey: string) {
    if (!idempotencyKey) fail('missing_idempotency_key', 'Нужен Idempotency-Key.', 400);
    const email = validateEmail(body.email);
    const route = `invite:${ctx.workspaceId}`;
    const normalized = { email, roles: [...body.roles].sort(), expiresInHours: body.expiresInHours || 72 };
    const digest = bodyHash(normalized);
    const expiresAt = new Date(Date.now() + normalized.expiresInHours * 3600000);
    const token = this.makeToken(expiresAt);
    const run = async () => this.prisma.$transaction(async tx => {
      await this.adminInTx(tx, ctx);
      const earlier = await tx.idempotencyRecord.findUnique({ where: { actorUserId_route_key: { actorUserId: ctx.userId, route, key: idempotencyKey } } });
      if (earlier) {
        if (earlier.bodyHash !== digest) fail('idempotency_conflict', 'Ключ уже использован с другим телом.');
        return { result: earlier.response, outboxId: null as string | null };
      }
      await tx.workspaceInvitation.updateMany({ where: { workspaceId: ctx.workspaceId, email, status: 'pending', expiresAt: { lte: new Date() } }, data: { status: 'expired', revision: { increment: 1 } } });
      const existing = await tx.workspaceInvitation.findFirst({ where: { workspaceId: ctx.workspaceId, email, status: 'pending' } });
      if (existing) fail('invitation_pending', 'Приглашение уже отправлено. Используйте повторную отправку.');
      const row = await tx.workspaceInvitation.create({
        data: { workspaceId: ctx.workspaceId, email, tokenHash: token.tokenHash, expiresAt, inviterUserId: ctx.userId,
          roles: { create: normalized.roles.map(role => ({ role: role as WorkspaceRole })) },
        }, include: { roles: true, workspace: true },
      });
      const outbox = await tx.workspaceEmailOutbox.create({ data: { invitationId: row.id, revision: row.revision, encryptedLink: token.encryptedLink } });
      await tx.workspaceAuditEvent.create({ data: { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, targetType: 'invitation', targetId: row.id, action: 'invitation.created', changes: { roles: normalized.roles }, requestId: ctx.requestId } });
      const result = { item: invitationDto(row), changed: ['invitations'], requestId: ctx.requestId };
      await tx.idempotencyRecord.create({ data: { actorUserId: ctx.userId, route, key: idempotencyKey, bodyHash: digest, response: result, expiresAt: new Date(Date.now() + 86400000) } });
      return { result, outboxId: outbox.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    let applied;
    try { applied = await run(); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034')) {
        const previous = await this.prisma.idempotencyRecord.findUnique({ where: { actorUserId_route_key: { actorUserId: ctx.userId, route, key: idempotencyKey } } });
        if (previous?.bodyHash === digest) return previous.response;
      }
      throw error;
    }
    if (applied.outboxId) await this.deliverOne(applied.outboxId, true);
    return applied.result;
  }

  async resend(ctx: WorkspaceContext, id: string, revision: number) {
    const result = await this.prisma.$transaction(async tx => {
      await this.adminInTx(tx, ctx);
      const row = await tx.workspaceInvitation.findFirst({ where: { id, workspaceId: ctx.workspaceId }, include: { roles: true, workspace: true } });
      if (!row) throw notFound();
      if (row.revision !== revision) fail('revision_mismatch', 'Приглашение изменилось.', 412);
      if (row.status !== 'pending') fail('invalid_state', 'Приглашение больше не активно.');
      const token = this.makeToken(new Date(Date.now() + 72 * 3600000));
      await tx.workspaceEmailOutbox.updateMany({ where: { invitationId: id, sentAt: null }, data: { canceledAt: new Date(), encryptedLink: null } });
      const updated = await tx.workspaceInvitation.update({ where: { id }, data: { tokenHash: token.tokenHash, expiresAt: token.expiresAt, deliveryStatus: 'queued', revision: { increment: 1 } }, include: { roles: true, workspace: true } });
      const outbox = await tx.workspaceEmailOutbox.create({ data: { invitationId: id, revision: updated.revision, encryptedLink: token.encryptedLink } });
      await tx.workspaceAuditEvent.create({ data: { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, targetType: 'invitation', targetId: id, action: 'invitation.resent', changes: {}, requestId: ctx.requestId } });
      return { item: invitationDto(updated), changed: ['invitations'], requestId: ctx.requestId, outboxId: outbox.id };
    });
    await this.deliverOne(result.outboxId, true);
    return { item: result.item, changed: result.changed, requestId: result.requestId };
  }

  async revoke(ctx: WorkspaceContext, id: string, revision: number, reason?: string) {
    return this.prisma.$transaction(async tx => {
      await this.adminInTx(tx, ctx);
      const row = await tx.workspaceInvitation.findFirst({ where: { id, workspaceId: ctx.workspaceId }, include: { roles: true, workspace: true } });
      if (!row) throw notFound();
      if (row.revision !== revision) fail('revision_mismatch', 'Приглашение изменилось.', 412);
      if (row.status !== 'pending') fail('invalid_state', 'Приглашение больше не активно.');
      const updated = await tx.workspaceInvitation.update({ where: { id }, data: { status: 'revoked', revokedAt: new Date(), revision: { increment: 1 } }, include: { roles: true, workspace: true } });
      await tx.workspaceEmailOutbox.updateMany({ where: { invitationId: id, sentAt: null }, data: { canceledAt: new Date(), encryptedLink: null } });
      await tx.workspaceAuditEvent.create({ data: { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, targetType: 'invitation', targetId: id, action: 'invitation.revoked', changes: {}, reason, requestId: ctx.requestId } });
      return { item: invitationDto(updated), changed: ['invitations'], requestId: ctx.requestId };
    });
  }

  private async usableInvite(tx: Prisma.TransactionClient, token: string) {
    const row = await tx.workspaceInvitation.findUnique({ where: { tokenHash: tokenHash(token) }, include: { roles: true, workspace: true } });
    if (row && row.status === 'accepted') fail('invitation_used', 'Приглашение уже использовано.');
    if (!row || row.status !== 'pending' || row.expiresAt <= new Date() || row.workspace.status !== 'active') fail('invalid_invitation', 'Приглашение недействительно.');
    return row;
  }

  async acceptNew(token: string, displayNameInput: string, passwordInput: string, requestId: string) {
    const displayName = displayNameInput.trim();
    if (displayName.length < 2) fail('invalid_name', 'Имя должно содержать не менее двух символов.', 400);
    const passwordHash = await bcrypt.hash(validatePassword(passwordInput), 12);
    let userId: string;
    try {
      userId = await this.prisma.$transaction(async tx => {
        const invite = await this.usableInvite(tx, token);
        const existing = await tx.user.findUnique({ where: { email: invite.email } });
        if (existing) fail('account_exists', 'Войдите в существующий аккаунт.');
        const claimed = await tx.workspaceInvitation.updateMany({ where: { id: invite.id, status: 'pending', tokenHash: invite.tokenHash, expiresAt: { gt: new Date() } }, data: { status: 'accepted', acceptedAt: new Date(), revision: { increment: 1 } } });
        if (claimed.count !== 1) fail('invitation_used', 'Приглашение уже использовано.');
        const user = await tx.user.create({ data: { email: invite.email, displayName, passwordHash, role: null } });
        const member = await tx.workspaceMembership.create({ data: { workspaceId: invite.workspaceId, userId: user.id } });
        await tx.workspaceRoleGrant.createMany({ data: invite.roles.map(item => ({ membershipId: member.id, role: item.role, grantedById: invite.inviterUserId })) });
        await tx.workspaceAuditEvent.create({ data: { workspaceId: invite.workspaceId, actorUserId: user.id, targetType: 'membership', targetId: member.id, action: 'invitation.accepted', changes: { roles: invite.roles.map(item => item.role) }, requestId } });
        return user.id;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (isAcceptanceConflict(error)) {
        const current = await this.prisma.workspaceInvitation.findUnique({ where: { tokenHash: tokenHash(token) } });
        if (current?.status === 'accepted') fail('invitation_used', 'Приглашение уже использовано.');
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') fail('account_exists', 'Войдите в существующий аккаунт.');
        fail('invitation_conflict', 'Приглашение меняется. Повторите запрос.');
      }
      throw error;
    }
    const session = await this.auth.signAccountSession(userId);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const contexts = await this.context.listMyContexts(userId);
    return { session, user: { id: user.id, email: user.email, displayName: user.displayName, revision: user.revision, catalogManage: false }, contexts };
  }

  async acceptExisting(userId: string, token: string, requestId: string) {
    try {
      return await this.prisma.$transaction(async tx => {
        const invite = await this.usableInvite(tx, token);
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        if (user.email !== invite.email) throw forbidden('Приглашение предназначено другому аккаунту.');
        const existing = await tx.workspaceMembership.findUnique({ where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId } } });
        if (existing?.status === 'suspended') fail('membership_suspended', 'Обратитесь к администратору для восстановления доступа.');
        const claimed = await tx.workspaceInvitation.updateMany({ where: { id: invite.id, status: 'pending', tokenHash: invite.tokenHash, expiresAt: { gt: new Date() } }, data: { status: 'accepted', acceptedAt: new Date(), revision: { increment: 1 } } });
        if (claimed.count !== 1) fail('invitation_used', 'Приглашение уже использовано.');
        const member = existing || await tx.workspaceMembership.create({ data: { workspaceId: invite.workspaceId, userId } });
        for (const role of invite.roles) {
          await tx.workspaceRoleGrant.upsert({
            where: { membershipId_role: { membershipId: member.id, role: role.role } },
            create: { membershipId: member.id, role: role.role, grantedById: invite.inviterUserId },
            update: { revokedAt: null, revokedById: null, grantedAt: new Date(), grantedById: invite.inviterUserId },
          });
        }
        const updated = await tx.workspaceMembership.update({ where: { id: member.id }, data: { revision: { increment: 1 } }, include: { roles: true } });
        await tx.workspaceAuditEvent.create({ data: { workspaceId: invite.workspaceId, actorUserId: userId, targetType: 'membership', targetId: member.id, action: 'invitation.accepted', changes: { roles: invite.roles.map(item => item.role) }, requestId } });
        return { item: { id: updated.id, userId, email: user.email, displayName: updated.displayNameOverride || user.displayName, roles: updated.roles.filter(role => !role.revokedAt).map(role => role.role), status: updated.status, revision: updated.revision } };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (isAcceptanceConflict(error)) {
        const current = await this.prisma.workspaceInvitation.findUnique({ where: { tokenHash: tokenHash(token) } });
        if (current?.status === 'accepted') fail('invitation_used', 'Приглашение уже использовано.');
        fail('invitation_conflict', 'Приглашение меняется. Повторите запрос.');
      }
      throw error;
    }
  }

  async deliverOne(id: string, immediate = false) {
    const now = new Date();
    const claimed = await this.prisma.workspaceEmailOutbox.updateMany({
      where: { id, sentAt: null, canceledAt: null, ...(!immediate ? { nextAttemptAt: { lte: now } } : {}), OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      data: { leaseUntil: new Date(now.getTime() + 120000), attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) return;
    const outbox = await this.prisma.workspaceEmailOutbox.findUniqueOrThrow({ where: { id }, include: { invitation: { include: { workspace: true } } } });
    const invite = outbox.invitation;
    if (invite.status !== 'pending' || invite.revision !== outbox.revision || invite.expiresAt <= new Date() || !outbox.encryptedLink) {
      await this.prisma.workspaceEmailOutbox.update({ where: { id }, data: { canceledAt: new Date(), encryptedLink: null, leaseUntil: null } });
      return;
    }
    try {
      await this.mailer.sendWorkspaceInvitation({ email: invite.email, workspaceName: invite.workspace.name, link: this.decrypt(outbox.encryptedLink), expiresAt: invite.expiresAt });
      await this.prisma.$transaction([
        this.prisma.workspaceEmailOutbox.update({ where: { id }, data: { sentAt: new Date(), encryptedLink: null, leaseUntil: null } }),
        this.prisma.workspaceInvitation.update({ where: { id: invite.id }, data: { deliveryStatus: 'sent' } }),
      ]);
    } catch {
      recordOutboxDeliveryFailure();
      await this.prisma.$transaction([
        this.prisma.workspaceEmailOutbox.update({ where: { id }, data: { leaseUntil: null, nextAttemptAt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(outbox.attempts, 7))), lastErrorCode: 'delivery_failed' } }),
        this.prisma.workspaceInvitation.update({ where: { id: invite.id }, data: { deliveryStatus: 'failed' } }),
      ]);
    }
  }

  async flushPending() {
    const now = new Date();
    await this.prisma.$transaction(async tx => {
      await tx.workspaceInvitation.updateMany({
        where: { status: 'pending', expiresAt: { lte: now } },
        data: { status: 'expired', revision: { increment: 1 } },
      });
      await tx.workspaceEmailOutbox.updateMany({
        where: { sentAt: null, canceledAt: null, invitation: { status: 'expired' } },
        data: { canceledAt: now, encryptedLink: null, leaseUntil: null },
      });
    });
    const rows = await this.prisma.workspaceEmailOutbox.findMany({
      where: { sentAt: null, canceledAt: null, nextAttemptAt: { lte: new Date() }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] },
      select: { id: true }, take: 20, orderBy: { createdAt: 'asc' },
    });
    for (const row of rows) await this.deliverOne(row.id);
    await this.prisma.idempotencyRecord.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }
}
