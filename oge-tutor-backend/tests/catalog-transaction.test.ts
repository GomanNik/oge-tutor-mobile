import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ProgramCatalogService } from '../src/program-catalog/program-catalog.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkspaceContextService } from '../src/workspace/workspace-context.service';
import { AppError } from '../src/common/app-error';

const actor = { user: { id: 'admin', email: 'admin@test.local', role: null }, requestId: 'request' };
const owner = { workspaceId: null };
const dbError = (code: string) => new Prisma.PrismaClientKnownRequestError('database conflict', { code, clientVersion: '6.19.0' });
function fixture() {
  const grant = vi.fn().mockResolvedValue({ userId: actor.user.id });
  const tx = { catalogGrant: { findUnique: grant } };
  const transaction = vi.fn(async (action: (tx: Prisma.TransactionClient) => Promise<unknown>) => action(tx as unknown as Prisma.TransactionClient));
  const prisma = { $transaction: transaction, catalogGrant: { findUnique: grant } };
  const service = new ProgramCatalogService(prisma as unknown as PrismaService, {} as WorkspaceContextService);
  return { service, transaction, grant };
}

describe('catalog serializable transactions', () => {
  it('rechecks the grant inside each retried transaction', async () => {
    const { service, transaction, grant } = fixture();
    await expect(service['mutate'](actor, owner, vi.fn().mockRejectedValueOnce(dbError('P2034')).mockResolvedValue('saved'))).resolves.toBe('saved');
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(grant).toHaveBeenCalledTimes(3);
  });
  it('returns a conflict after three failed serialization attempts', async () => {
    const { service, transaction } = fixture();
    await expect(service['mutate'](actor, owner, vi.fn().mockRejectedValue(dbError('P2034')))).rejects.toMatchObject({ code: 'concurrent_update' });
    expect(transaction).toHaveBeenCalledTimes(3);
  });
  it('never retries uniqueness, validation or revoked permissions', async () => {
    for (const error of [dbError('P2002'), new AppError(422, 'validation_error', 'Invalid catalog input')]) {
      const { service, transaction } = fixture();
      await expect(service['mutate'](actor, owner, vi.fn().mockRejectedValue(error))).rejects.toBeDefined();
      expect(transaction).toHaveBeenCalledTimes(1);
    }
    const { service, transaction, grant } = fixture();
    grant.mockResolvedValueOnce({ userId: actor.user.id }).mockResolvedValue(null);
    const action = vi.fn();
    await expect(service['mutate'](actor, owner, action)).rejects.toMatchObject({ status: 403 });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(action).not.toHaveBeenCalled();
  });
});
