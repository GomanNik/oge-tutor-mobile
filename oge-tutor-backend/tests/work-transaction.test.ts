import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { WorkAccessService } from '../src/assignments/work-access.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkspaceContext } from '../src/workspace/workspace-context.service';
import { forbidden } from '../src/common/app-error';

const ctx: WorkspaceContext = { userId: 'user', workspaceId: 'workspace', role: 'teacher', sessionId: 'session', requestId: 'request' };
const dbError = (code: string) => new Prisma.PrismaClientKnownRequestError('database conflict', { code, clientVersion: '6.19.0' });
function fixture() {
  const tx = {} as Prisma.TransactionClient;
  const transaction = vi.fn(async (action: (tx: Prisma.TransactionClient) => Promise<unknown>) => action(tx));
  const service = new WorkAccessService({ $transaction: transaction } as unknown as PrismaService);
  const live = vi.spyOn(service, 'live').mockResolvedValue(undefined as never);
  return { service, transaction, live };
}

describe('work serializable transactions', () => {
  it('restarts a rolled-back transaction and rechecks authorization', async () => {
    const { service, transaction, live } = fixture();
    const action = vi.fn().mockRejectedValueOnce(dbError('P2034')).mockResolvedValue('committed');
    await expect(service.transaction(ctx, action)).resolves.toBe('committed');
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(live).toHaveBeenCalledTimes(2);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('limits retries to three attempts and returns a conflict after exhaustion', async () => {
    const { service, transaction } = fixture();
    await expect(service.transaction(ctx, vi.fn().mockRejectedValue(dbError('P2034')))).rejects.toMatchObject({ code: 'concurrent_update' });
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it('does not retry uniqueness violations, domain errors or revoked access', async () => {
    for (const error of [dbError('P2002'), new Error('domain validation')]) {
      const { service, transaction } = fixture();
      await expect(service.transaction(ctx, vi.fn().mockRejectedValue(error))).rejects.toBeDefined();
      expect(transaction).toHaveBeenCalledTimes(1);
    }
    const { service, transaction, live } = fixture();
    const action = vi.fn();
    live.mockRejectedValue(forbidden());
    await expect(service.transaction(ctx, action)).rejects.toBeDefined();
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(action).not.toHaveBeenCalled();
  });
});
