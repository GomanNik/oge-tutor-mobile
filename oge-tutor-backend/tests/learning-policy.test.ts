import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { LearningAccessService, learningCursor, parseLearningCursor } from '../src/learning/learning-access.service';
import { deliveryBackoffMs, deliveryErrorCode } from '../src/learning/learning-delivery.worker';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkspaceContext } from '../src/workspace/workspace-context.service';
import { forbidden } from '../src/common/app-error';

describe('learning pagination and delivery policy', () => {
  it('preserves tied timestamp IDs and rejects malformed cursors', () => {
    const row = { id: 'event-2', recordedAt: new Date('2026-10-26T00:00:00Z') };
    expect(parseLearningCursor(learningCursor(row))).toEqual({ id: row.id, at: row.recordedAt });
    expect(() => parseLearningCursor('not-a-cursor')).toThrow('Некорректный курсор');
    expect(() => parseLearningCursor(Buffer.from('{"id":"x","at":"bad-date"}').toString('base64url'))).toThrow();
  });
  it('backs off retries with a cap and only records known safe error codes', () => {
    expect([1, 2, 3].map(deliveryBackoffMs)).toEqual([30000, 60000, 120000]);
    expect(deliveryBackoffMs(100)).toBe(3600000);
    expect(deliveryErrorCode({ code: 'EAUTH', message: 'private password' })).toBe('EAUTH');
    expect(deliveryErrorCode(new Error('private SMTP details'))).toBe('delivery_failed');
    expect(deliveryErrorCode({ code: 'token=secret' })).toBe('delivery_failed');
  });
});

describe('learning transaction retries', () => {
  const ctx: WorkspaceContext = { userId: 'user', workspaceId: 'workspace', role: 'teacher', sessionId: 'session', requestId: 'request' };
  const dbError = (code: string) => new Prisma.PrismaClientKnownRequestError('database conflict', { code, clientVersion: '6.19.0' });
  function fixture() {
    const tx = {} as Prisma.TransactionClient;
    const transaction = vi.fn(async (action: (tx: Prisma.TransactionClient) => Promise<unknown>) => action(tx));
    const service = new LearningAccessService({ $transaction: transaction } as unknown as PrismaService);
    const live = vi.spyOn(service, 'live').mockResolvedValue();
    return { service, transaction, live };
  }
  it('retries serialization failures and rechecks access', async () => {
    const { service, transaction, live } = fixture();
    await expect(service.transaction(ctx, vi.fn().mockRejectedValueOnce(dbError('P2034')).mockResolvedValue('saved'))).resolves.toBe('saved');
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(live).toHaveBeenCalledTimes(2);
  });
  it('stops after three failed attempts', async () => {
    const { service, transaction } = fixture();
    await expect(service.transaction(ctx, vi.fn().mockRejectedValue(dbError('P2034')))).rejects.toMatchObject({ code: 'concurrent_update' });
    expect(transaction).toHaveBeenCalledTimes(3);
  });
  it('never retries uniqueness violations or permission failures', async () => {
    const first = fixture();
    await expect(first.service.transaction(ctx, vi.fn().mockRejectedValue(dbError('P2002')))).rejects.toMatchObject({ code: 'concurrent_update' });
    expect(first.transaction).toHaveBeenCalledTimes(1);
    const second = fixture();
    const action = vi.fn();
    second.live.mockRejectedValue(forbidden());
    await expect(second.service.transaction(ctx, action)).rejects.toMatchObject({ status: 403 });
    expect(second.transaction).toHaveBeenCalledTimes(1);
    expect(action).not.toHaveBeenCalled();
  });
});
