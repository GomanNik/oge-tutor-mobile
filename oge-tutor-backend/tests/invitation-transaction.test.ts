import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AuthService } from '../src/auth/auth.service';
import { AuthMailerService } from '../src/auth/auth-mailer.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkspaceInvitationsService } from '../src/workspace/workspace-invitations.service';
import { WorkspaceContext, WorkspaceContextService } from '../src/workspace/workspace-context.service';

const ctx: WorkspaceContext = { userId: 'admin', workspaceId: 'workspace', role: 'admin', sessionId: 'session', requestId: 'request' };
const body = { email: 'student@test.local', roles: ['student' as const], expiresInHours: 72 };
const dbError = (code: string) => new Prisma.PrismaClientKnownRequestError('database conflict', { code, clientVersion: '6.19.0' });

function fixture() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    workspaceMembership: { findUnique: vi.fn().mockResolvedValue({ status: 'active', roles: [{ role: 'admin', revokedAt: null }] }) },
    idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    workspaceInvitation: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'invitation', email: body.email, roles: [{ role: 'student' }], expiresAt: new Date('2026-10-29T00:00:00Z'), status: 'pending', deliveryStatus: 'queued', revision: 0 }),
    },
    workspaceEmailOutbox: { create: vi.fn().mockResolvedValue({ id: 'outbox' }) },
    workspaceAuditEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  let inTransaction = false;
  const transaction = vi.fn(async (action: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    inTransaction = true;
    try { return await action(tx as unknown as Prisma.TransactionClient); }
    finally { inTransaction = false; }
  });
  const previous = vi.fn().mockResolvedValue(null);
  const requireAdmin = vi.fn();
  const config = new ConfigService({ JWT_SECRET: 'invitation-retry-unit-test-secret' });
  const service = new WorkspaceInvitationsService(
    { $transaction: transaction, idempotencyRecord: { findUnique: previous } } as unknown as PrismaService,
    { requireAdmin } as unknown as WorkspaceContextService,
    {} as AuthService, {} as AuthMailerService, config,
  );
  const deliver = vi.spyOn(service, 'deliverOne').mockImplementation(async () => { expect(inTransaction).toBe(false); });
  return { service, tx, transaction, previous, requireAdmin, deliver };
}

describe('invitation creation serialization recovery', () => {
  it('retries a rolled-back final write, rechecks authorization and sends only after commit', async () => {
    const { service, tx, transaction, requireAdmin, deliver } = fixture();
    tx.idempotencyRecord.create.mockRejectedValueOnce(dbError('P2034'));
    await expect(service.create(ctx, body, 'request-key')).resolves.toMatchObject({ item: { id: 'invitation' } });
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(requireAdmin).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.workspaceMembership.findUnique).toHaveBeenCalledTimes(2);
    expect(tx.idempotencyRecord.findUnique).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenCalledExactlyOnceWith('outbox', true);
  });

  it('stops after three serialization failures with a domain conflict and no delivery', async () => {
    const { service, tx, transaction, deliver } = fixture();
    tx.idempotencyRecord.create.mockRejectedValue(dbError('P2034'));
    await expect(service.create(ctx, body, 'request-key')).rejects.toMatchObject({ status: 409, code: 'concurrent_update' });
    expect(transaction).toHaveBeenCalledTimes(3);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('stops when administration is revoked between attempts', async () => {
    const { service, tx, transaction, deliver } = fixture();
    tx.idempotencyRecord.create.mockRejectedValueOnce(dbError('P2034'));
    tx.workspaceMembership.findUnique.mockResolvedValueOnce({ status: 'active', roles: [{ role: 'admin', revokedAt: null }] }).mockResolvedValueOnce({ status: 'suspended', roles: [] });
    await expect(service.create(ctx, body, 'request-key')).rejects.toMatchObject({ status: 403 });
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(tx.workspaceInvitation.create).toHaveBeenCalledTimes(1);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('preserves a concurrently committed idempotent response without another delivery', async () => {
    const { service, tx, transaction, previous, deliver } = fixture();
    const response = { item: { id: 'already-committed' } };
    tx.idempotencyRecord.create.mockRejectedValue(dbError('P2002'));
    previous.mockImplementation(async () => ({ bodyHash: tx.idempotencyRecord.create.mock.calls[0][0].data.bodyHash, response }));
    await expect(service.create(ctx, body, 'request-key')).resolves.toEqual(response);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('does not retry unrelated uniqueness violations', async () => {
    const { service, tx, transaction, deliver } = fixture();
    tx.idempotencyRecord.create.mockRejectedValue(dbError('P2002'));
    await expect(service.create(ctx, body, 'request-key')).rejects.toMatchObject({ code: 'P2002' });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('does not retry a pending invitation or conflicting request body', async () => {
    for (const conflict of ['invitation_pending', 'idempotency_conflict']) {
      const { service, tx, transaction, deliver } = fixture();
      if (conflict === 'invitation_pending') tx.workspaceInvitation.findFirst.mockResolvedValue({ id: 'pending' });
      else tx.idempotencyRecord.findUnique.mockResolvedValue({ bodyHash: 'different-body', response: {} });
      await expect(service.create(ctx, body, 'request-key')).rejects.toMatchObject({ status: 409, code: conflict });
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(deliver).not.toHaveBeenCalled();
    }
  });
});
