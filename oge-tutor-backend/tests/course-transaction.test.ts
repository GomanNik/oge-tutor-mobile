import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { CoursesService } from '../src/courses/courses.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkspaceContext, WorkspaceContextService } from '../src/workspace/workspace-context.service';
import { LearningEventsService } from '../src/learning/learning-events.service';
import { AppError, forbidden } from '../src/common/app-error';
import { CourseLessonsService } from '../src/course-lessons/course-lessons.service';

const ctx: WorkspaceContext = { userId: 'admin', workspaceId: 'workspace', role: 'admin', sessionId: 'session', requestId: 'request' };
const dbError = (code: string) => new Prisma.PrismaClientKnownRequestError('database conflict', { code, clientVersion: '6.19.0' });
function fixture() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    workspaceMembership: { findUnique: vi.fn().mockResolvedValue({ status: 'active', workspace: { status: 'active' }, roles: [{ role: 'admin', revokedAt: null }] }) },
  };
  const transaction = vi.fn(async (action: (tx: Prisma.TransactionClient) => Promise<unknown>) => action(tx as unknown as Prisma.TransactionClient));
  const requireAdmin = vi.fn();
  const service = new CoursesService({ $transaction: transaction } as unknown as PrismaService, { requireAdmin } as unknown as WorkspaceContextService, {} as LearningEventsService);
  return { service, transaction, tx, requireAdmin };
}

describe('course serializable transactions', () => {
  it('retries transient failures and reacquires locks and authorization', async () => {
    const { service, transaction, tx } = fixture();
    const action = vi.fn().mockRejectedValueOnce(dbError('P2034')).mockResolvedValue('saved');
    await expect(service['mutate'](ctx, action)).resolves.toBe('saved');
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.workspaceMembership.findUnique).toHaveBeenCalledTimes(2);
  });
  it('bounds serialization retries without retrying other conflicts', async () => {
    for (const [code, expected, attempts] of [['P2034', 'concurrent_update', 3], ['P2002', 'duplicate_link', 1]] as const) {
      const { service, transaction } = fixture();
      await expect(service['mutate'](ctx, vi.fn().mockRejectedValue(dbError(code)))).rejects.toMatchObject({ code: expected });
      expect(transaction).toHaveBeenCalledTimes(attempts);
    }
  });
  it('does not repeat revoked authorization or run the mutation', async () => {
    const { service, transaction, tx } = fixture();
    tx.workspaceMembership.findUnique.mockRejectedValue(forbidden());
    const action = vi.fn();
    await expect(service['mutate'](ctx, action)).rejects.toMatchObject({ status: 403 });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(action).not.toHaveBeenCalled();
  });
});

describe('lesson serializable transactions', () => {
  function fixture() {
    const transaction = vi.fn(async (action: (tx: Prisma.TransactionClient) => Promise<unknown>) => action({} as Prisma.TransactionClient));
    return { transaction, service: new CourseLessonsService({ $transaction: transaction } as unknown as PrismaService, {} as LearningEventsService) };
  }
  it('repeats only rolled-back serialization failures, with three attempts maximum', async () => {
    const first = fixture();
    await expect(first.service['mutate'](vi.fn().mockRejectedValueOnce(dbError('P2034')).mockResolvedValue('saved'))).resolves.toBe('saved');
    expect(first.transaction).toHaveBeenCalledTimes(2);
    const second = fixture();
    await expect(second.service['mutate'](vi.fn().mockRejectedValue(dbError('P2034')))).rejects.toMatchObject({ code: 'concurrent_update' });
    expect(second.transaction).toHaveBeenCalledTimes(3);
  });
  it('preserves actual schedule conflicts and uniqueness errors without retries', async () => {
    for (const error of [new AppError(409, 'schedule_conflict', 'Schedule collision'), dbError('P2002')]) {
      const { service, transaction } = fixture();
      await expect(service['mutate'](vi.fn().mockRejectedValue(error))).rejects.toMatchObject({ status: 409 });
      expect(transaction).toHaveBeenCalledTimes(1);
    }
  });
});
