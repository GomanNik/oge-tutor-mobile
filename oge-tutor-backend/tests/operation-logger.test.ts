import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { lastValueFrom, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/common/app-error';
import { OperationLoggerInterceptor } from '../src/common/operation-logger.interceptor';

afterEach(() => vi.restoreAllMocks());

describe('operation logging', () => {
  it('records a safe error code without the exception message or request values', async () => {
    const write = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const request = {
      method: 'POST', path: '/api/v2/invitations/accept-new', requestId: 'request-1', headers: {}, params: {},
      body: { email: 'private@example.test', token: 'raw-secret' },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getClass: () => ({ name: 'InvitationController' }),
      getHandler: () => ({ name: 'accept' }),
    } as unknown as ExecutionContext;
    const handler = { handle: () => throwError(() => new AppError(409, 'invitation_used', 'private@example.test raw-secret')) } as CallHandler;

    await expect(lastValueFrom(new OperationLoggerInterceptor().intercept(context, handler))).rejects.toMatchObject({ code: 'invitation_used' });
    const recorded = String(write.mock.calls[0][0]);
    expect(JSON.parse(recorded)).toMatchObject({ requestId: 'request-1', statusCode: 409, errorCode: 'invitation_used' });
    expect(recorded).not.toContain('private@example.test');
    expect(recorded).not.toContain('raw-secret');
  });
});
