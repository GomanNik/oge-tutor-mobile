/*
 * OGE Tutor Backend — operation logger interceptor.
 * Logs every controller action with role/profile context and duration, while avoiding sensitive payload values.
 */
import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable, catchError, tap, throwError } from 'rxjs';

function maskSensitive(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => maskSensitive(item));

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    const lower = key.toLowerCase();
    if (lower.includes('password') || lower.includes('token')) {
      result[key] = '[masked]';
    } else if (lower === 'file' || lower === 'buffer') {
      result[key] = '[file]';
    } else {
      result[key] = maskSensitive(entry);
    }
  }
  return result;
}

@Injectable()
export class OperationLoggerInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Operation');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { user?: any }>();
    const startedAt = Date.now();
    const handler = `${context.getClass().name}.${context.getHandler().name}`;
    const user = request.user;
    const profileId = user?.teacherId || user?.studentId || '';
    const userText = user ? ` role=${user.role} profile=${profileId || '-'} user=${user.id}` : ' public';
    const params = Object.keys(request.params || {}).length ? ` params=${JSON.stringify(request.params)}` : '';
    const body = request.body && Object.keys(request.body).length ? ` body=${JSON.stringify(maskSensitive(request.body))}` : '';

    this.logger.log(`START ${handler} ${request.method} ${request.originalUrl}${userText}${params}${body}`);

    return next.handle().pipe(
      tap(() => {
        this.logger.log(`OK ${handler} ${Date.now() - startedAt}ms${userText}`);
      }),
      catchError((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`FAIL ${handler} ${Date.now() - startedAt}ms${userText}: ${message}`);
        return throwError(() => error);
      }),
    );
  }
}
