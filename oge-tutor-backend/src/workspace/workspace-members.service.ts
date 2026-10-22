import { Injectable } from '@nestjs/common';
import { Prisma, WorkspaceRole } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppError, forbidden, notFound } from '../common/app-error';
import { WorkspaceContext, WorkspaceContextService } from './workspace-context.service';
import { AuditQueryDto, GrantRoleDto, MemberQueryDto, UpdateLocalNameDto } from './workspace.dto';

type MemberRow = Prisma.WorkspaceMembershipGetPayload<{ include: { user: true; roles: true } }>;

function invalid(code: string, message: string, status = 409): never { throw new AppError(status, code, message); }
function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function cursorFor(row: { id: string; createdAt?: Date; occurredAt?: Date }, scope: string) {
  return Buffer.from(JSON.stringify({ id: row.id, at: (row.createdAt || row.occurredAt)!.toISOString(), scope })).toString('base64url');
}

function parseCursor(value: string | undefined, scope: string): { id: string; at: Date } | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const at = new Date(decoded.at);
    if (decoded.scope !== scope || typeof decoded.id !== 'string' || !decoded.id || Number.isNaN(at.getTime())) throw new Error('invalid');
    return { id: decoded.id, at };
  } catch {
    throw new AppError(400, 'invalid_cursor', 'Некорректный курсор страницы.');
  }
}

function memberDto(row: MemberRow) {
  return {
    id: row.id, userId: row.userId, email: row.user.email,
    displayName: row.displayNameOverride || row.user.displayName,
    roles: row.roles.filter(grant => !grant.revokedAt).map(grant => grant.role),
    status: row.status, revision: row.revision,
  };
}

@Injectable()
export class WorkspaceMembersService {
  constructor(private readonly prisma: PrismaService, private readonly context: WorkspaceContextService) {}

  private async withRetry<T>(action: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await action(); }
      catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
        if (attempt === 2) invalid('concurrent_update', 'Запись изменилась. Повторите запрос.');
      }
    }
    throw new Error('Unreachable transaction retry state');
  }

  private async adminInTx(tx: Prisma.TransactionClient, ctx: WorkspaceContext) {
    this.context.requireAdmin(ctx);
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${ctx.workspaceId} FOR UPDATE`;
    const actor = await tx.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: ctx.userId } },
      include: { roles: true },
    });
    if (actor?.status !== 'active' || !actor.roles.some(role => role.role === 'admin' && !role.revokedAt)) throw forbidden();
  }

  private async targetInTx(tx: Prisma.TransactionClient, ctx: WorkspaceContext, memberId: string) {
    const row = await tx.workspaceMembership.findFirst({
      where: { id: memberId, workspaceId: ctx.workspaceId },
      include: { user: true, roles: true },
    });
    if (!row) throw notFound();
    return row;
  }

  private async assertNotLastAdmin(tx: Prisma.TransactionClient, ctx: WorkspaceContext, row: MemberRow) {
    if (row.status !== 'active' || !row.roles.some(role => role.role === 'admin' && !role.revokedAt)) return;
    const count = await tx.workspaceMembership.count({
      where: { workspaceId: ctx.workspaceId, status: 'active', roles: { some: { role: 'admin', revokedAt: null } } },
    });
    if (count <= 1) invalid('last_admin', 'Нельзя снять последнего администратора.');
  }

  private async audit(tx: Prisma.TransactionClient, ctx: WorkspaceContext, action: string, targetId: string, changes: Prisma.InputJsonValue, reason?: string) {
    await tx.workspaceAuditEvent.create({
      data: { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, targetType: 'membership', targetId, action, changes, reason, requestId: ctx.requestId },
    });
  }

  async list(ctx: WorkspaceContext, query: MemberQueryDto) {
    this.context.requireAdmin(ctx);
    const scope = hash({ workspaceId: ctx.workspaceId, status: query.status, role: query.role, q: query.q?.trim().toLowerCase() });
    const cursor = parseCursor(query.cursor, scope);
    const limit = query.limit || 25;
    const conditions: Prisma.Sql[] = [Prisma.sql`m."workspaceId" = ${ctx.workspaceId}`];
    if (query.status) conditions.push(Prisma.sql`m.status = ${query.status}::"MembershipStatus"`);
    if (query.role) conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "WorkspaceRoleGrant" r WHERE r."membershipId" = m.id
        AND r.role = ${query.role}::"WorkspaceRole" AND r."revokedAt" IS NULL
    )`);
    if (query.q) {
      const pattern = `%${query.q.trim()}%`;
      conditions.push(Prisma.sql`(m."displayNameOverride" ILIKE ${pattern} OR EXISTS (
        SELECT 1 FROM "User" u WHERE u.id = m."userId"
          AND (u.email ILIKE ${pattern} OR u."displayName" ILIKE ${pattern})
      ))`);
    }
    if (cursor) conditions.push(Prisma.sql`(m."createdAt",m.id) > (${cursor.at},${cursor.id})`);
    const ids = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT m.id FROM "WorkspaceMembership" m
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY m."createdAt",m.id LIMIT ${limit + 1}
    `);
    const rowsById = await this.prisma.workspaceMembership.findMany({
      where: { id: { in: ids.map(row => row.id) }, workspaceId: ctx.workspaceId },
      include: { user: true, roles: true },
    });
    const byId = new Map(rowsById.map(row => [row.id, row]));
    const rows = ids.map(row => byId.get(row.id)!).filter(Boolean);
    const items = rows.slice(0, limit);
    return { items: items.map(memberDto), pageInfo: { hasMore: rows.length > limit, nextCursor: rows.length > limit ? cursorFor(items.at(-1)!, scope) : null } };
  }

  async get(ctx: WorkspaceContext, memberId: string) {
    this.context.requireAdmin(ctx);
    const row = await this.prisma.workspaceMembership.findFirst({ where: { id: memberId, workspaceId: ctx.workspaceId }, include: { user: true, roles: true } });
    if (!row) throw notFound();
    return memberDto(row);
  }

  async updateLocalName(ctx: WorkspaceContext, memberId: string, body: UpdateLocalNameDto, revision: number) {
    return this.prisma.$transaction(async tx => {
      await this.adminInTx(tx, ctx);
      const row = await this.targetInTx(tx, ctx, memberId);
      if (row.revision !== revision) invalid('revision_mismatch', 'Участник изменился. Обновите страницу.', 412);
      const name = body.displayNameOverride === null ? null : body.displayNameOverride?.trim();
      if (name === undefined) invalid('invalid_request', 'Укажите имя или null.', 400);
      if (name !== null && name.length < 2) invalid('invalid_name', 'Имя должно содержать не менее двух символов.', 400);
      const updated = await tx.workspaceMembership.update({ where: { id: memberId }, data: { displayNameOverride: name, revision: { increment: 1 } }, include: { user: true, roles: true } });
      await this.audit(tx, ctx, 'member.name.updated', memberId, { displayNameOverride: name });
      return { item: memberDto(updated), changed: ['members'], requestId: ctx.requestId };
    });
  }

  async grantRole(ctx: WorkspaceContext, memberId: string, body: GrantRoleDto, key: string) {
    if (!key) invalid('missing_idempotency_key', 'Нужен Idempotency-Key.', 400);
    const route = `member-role:${ctx.workspaceId}:${memberId}`;
    const bodyHash = hash(body);
    const apply = async () => this.prisma.$transaction(async tx => {
      await this.adminInTx(tx, ctx);
      const previous = await tx.idempotencyRecord.findUnique({ where: { actorUserId_route_key: { actorUserId: ctx.userId, route, key } } });
      if (previous) {
        if (previous.bodyHash !== bodyHash) invalid('idempotency_conflict', 'Ключ уже использован с другим телом.');
        return previous.response;
      }
      const row = await this.targetInTx(tx, ctx, memberId);
      await tx.workspaceRoleGrant.upsert({
        where: { membershipId_role: { membershipId: memberId, role: body.role } },
        create: { membershipId: memberId, role: body.role, grantedById: ctx.userId },
        update: { revokedAt: null, revokedById: null, grantedAt: new Date(), grantedById: ctx.userId },
      });
      const updated = await tx.workspaceMembership.update({ where: { id: row.id }, data: { revision: { increment: 1 } }, include: { user: true, roles: true } });
      await this.audit(tx, ctx, 'member.role.granted', memberId, { role: body.role }, body.reason);
      const result = { item: memberDto(updated), changed: ['members'], requestId: ctx.requestId };
      await tx.idempotencyRecord.create({ data: { actorUserId: ctx.userId, route, key, bodyHash, response: result, expiresAt: new Date(Date.now() + 86400000) } });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    try { return await apply(); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034')) {
        const previous = await this.prisma.idempotencyRecord.findUnique({ where: { actorUserId_route_key: { actorUserId: ctx.userId, route, key } } });
        if (previous?.bodyHash === bodyHash) return previous.response;
      }
      throw error;
    }
  }

  async revokeRole(ctx: WorkspaceContext, memberId: string, role: WorkspaceRole, reason: string, revision: number) {
    return this.withRetry(() => this.prisma.$transaction(async tx => {
      await this.adminInTx(tx, ctx);
      const row = await this.targetInTx(tx, ctx, memberId);
      if (row.revision !== revision) invalid('revision_mismatch', 'Участник изменился. Обновите страницу.', 412);
      const grant = row.roles.find(item => item.role === role && !item.revokedAt);
      if (!grant) invalid('invalid_state', 'Роль уже отозвана.');
      if (role === 'admin') await this.assertNotLastAdmin(tx, ctx, row);
      await tx.workspaceRoleGrant.update({ where: { id: grant!.id }, data: { revokedAt: new Date(), revokedById: ctx.userId } });
      const updated = await tx.workspaceMembership.update({ where: { id: memberId }, data: { revision: { increment: 1 } }, include: { user: true, roles: true } });
      await this.audit(tx, ctx, 'member.role.revoked', memberId, { role }, reason);
      return { item: memberDto(updated), changed: ['members'], requestId: ctx.requestId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  }

  async setSuspended(ctx: WorkspaceContext, memberId: string, suspend: boolean, reason: string, revision: number) {
    return this.withRetry(() => this.prisma.$transaction(async tx => {
      await this.adminInTx(tx, ctx);
      const row = await this.targetInTx(tx, ctx, memberId);
      if (row.revision !== revision) invalid('revision_mismatch', 'Участник изменился. Обновите страницу.', 412);
      if ((row.status === 'suspended') === suspend) invalid('invalid_state', 'Состояние уже установлено.');
      if (suspend) await this.assertNotLastAdmin(tx, ctx, row);
      const updated = await tx.workspaceMembership.update({
        where: { id: memberId },
        data: { status: suspend ? 'suspended' : 'active', suspendedAt: suspend ? new Date() : null, revision: { increment: 1 } },
        include: { user: true, roles: true },
      });
      await this.audit(tx, ctx, suspend ? 'member.suspended' : 'member.resumed', memberId, { status: updated.status }, reason);
      return { item: memberDto(updated), changed: ['members'], requestId: ctx.requestId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  }

  async listAudit(ctx: WorkspaceContext, query: AuditQueryDto) {
    this.context.requireAdmin(ctx);
    const scope = hash({ workspaceId: ctx.workspaceId, action: query.action, targetId: query.targetId, from: query.from, to: query.to });
    const cursor = parseCursor(query.cursor, scope);
    const limit = query.limit || 25;
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) invalid('invalid_request', 'Некорректный диапазон дат.', 400);
    const conditions: Prisma.Sql[] = [Prisma.sql`a."workspaceId" = ${ctx.workspaceId}`];
    if (query.action) conditions.push(Prisma.sql`a.action = ${query.action}`);
    if (query.targetId) conditions.push(Prisma.sql`a."targetId" = ${query.targetId}`);
    if (from) conditions.push(Prisma.sql`a."occurredAt" >= ${from}`);
    if (to) conditions.push(Prisma.sql`a."occurredAt" <= ${to}`);
    if (cursor) conditions.push(Prisma.sql`(a."occurredAt",a.id) < (${cursor.at},${cursor.id})`);
    const ids = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT a.id FROM "WorkspaceAuditEvent" a
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY a."occurredAt" DESC,a.id DESC LIMIT ${limit + 1}
    `);
    const rowsById = await this.prisma.workspaceAuditEvent.findMany({ where: { id: { in: ids.map(row => row.id) }, workspaceId: ctx.workspaceId } });
    const byId = new Map(rowsById.map(row => [row.id, row]));
    const rows = ids.map(row => byId.get(row.id)!).filter(Boolean);
    const items = rows.slice(0, limit);
    return { items: items.map(row => ({ id: row.id, actorUserId: row.actorUserId, action: row.action, targetType: row.targetType, targetId: row.targetId, reason: row.reason, changes: row.changes, requestId: row.requestId, occurredAt: row.occurredAt.toISOString() })), pageInfo: { hasMore: rows.length > limit, nextCursor: rows.length > limit ? cursorFor(items.at(-1)!, scope) : null } };
  }
}
