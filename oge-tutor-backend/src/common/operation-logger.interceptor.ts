/*
 * OGE Tutor Backend — operation logger interceptor.
 * Logs every controller action with role/profile context and duration, while avoiding sensitive payload values.
 */
import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable, catchError, tap, throwError } from 'rxjs';

type RequestWithContext = Request & {
  requestId?: string;
  user?: {
    id?: string;
    role?: string;
    teacherId?: string;
    studentId?: string;
  };
};

function requestPath(request: Request): string {
  return request.path || request.originalUrl?.split('?')[0] || request.url?.split('?')[0] || '';
}

function summarizePayload(value: unknown): unknown {
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) return { type: 'array', length: value.length };

  const source = value as Record<string, unknown>;
  const keys = Object.keys(source);
  if (!keys.length) return undefined;
  return {
    keys: keys.filter((key) => {
      const lower = key.toLowerCase();
      return !lower.includes('password') && !lower.includes('token') && lower !== 'file' && lower !== 'buffer';
    }),
    maskedKeys: keys.filter((key) => {
      const lower = key.toLowerCase();
      return lower.includes('password') || lower.includes('token') || lower === 'file' || lower === 'buffer';
    }),
  };
}

@Injectable()
export class OperationLoggerInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Operation');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const startedAt = Date.now();
    const handler = `${context.getClass().name}.${context.getHandler().name}`;
    const user = request.user;
    const profileId = user?.teacherId || user?.studentId || '';
    const baseLog = {
      requestId: request.requestId || request.headers['x-request-id'],
      handler,
      method: request.method,
      path: requestPath(request),
      role: user?.role,
      profileId: profileId || undefined,
      userId: user?.id,
    };
    const params = Object.keys(request.params || {}).length ? request.params : undefined;
    const body = summarizePayload(request.body);

    this.logger.log(JSON.stringify({ event: 'operation_start', ...baseLog, params, body }));

    return next.handle().pipe(
      tap(() => {
        this.logger.log(JSON.stringify({ event: 'operation_ok', ...baseLog, durationMs: Date.now() - startedAt }));
      }),
      catchError((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(JSON.stringify({ event: 'operation_fail', ...baseLog, durationMs: Date.now() - startedAt, error: message }));
        return throwError(() => error);
      }),
    );
  }
}
