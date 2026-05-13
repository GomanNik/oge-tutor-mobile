/*
 * OGE Tutor Backend — operation logger interceptor.
 * Logs every controller action with requestId, role/profile context, sanitized input and duration.
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { logOperationData, logOperationFail, logOperationOk, logOperationStart, safeJson } from './app-logger';
import { getRequestId } from './request-context';

type RequestWithContext = Request & { requestId?: string; user?: any };

function statusFromError(error: any): number {
  if (typeof error?.status === 'number') return error.status;
  if (typeof error?.getStatus === 'function') return error.getStatus();
  return 500;
}

function codeFromError(error: any): string {
  if (typeof error?.code === 'string') return error.code;
  if (statusFromError(error) === 401) return 'unauthorized';
  if (statusFromError(error) === 403) return 'forbidden';
  if (statusFromError(error) === 404) return 'not_found';
  if (statusFromError(error) === 409) return 'conflict';
  if (statusFromError(error) === 400 || statusFromError(error) === 422) return 'validation_error';
  return 'server_error';
}

function resultSummary(result: any): string {
  if (!result || typeof result !== 'object') return '';
  if (result.lesson?.id) return `lesson.id=${result.lesson.id}`;
  if (result.homework?.id) return `homework.id=${result.homework.id}`;
  if (result.student?.id) return `student.id=${result.student.id}`;
  if (result.teacher?.id) return `teacher.id=${result.teacher.id}`;
  if (result.material?.id) return `material.id=${result.material.id}`;
  if (result.fileResource?.id) return `fileResource.id=${result.fileResource.id}`;
  if (result.session?.id) return `session.id=${result.session.id}`;
  if (result.data) return 'data=bootstrap';
  return '';
}

@Injectable()
export class OperationLoggerInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const startedAt = Date.now();
    const handler = `${context.getClass().name}.${context.getHandler().name}`;
    const user = request.user;
    const requestId = request.requestId || getRequestId(String(request.headers['x-request-id'] || 'req_unknown'));
    const profileId = user?.teacherId || user?.studentId || '-';
    const meta = `role=${user?.role || '-'} user=${user?.id || '-'} profile=${profileId}`;

    logOperationStart(handler, meta);
    logOperationData(handler, {
      requestId,
      params: request.params,
      query: request.query,
      body: request.body,
    });

    return next.handle().pipe(
      tap((result) => {
        logOperationOk(handler, Date.now() - startedAt, resultSummary(result));
      }),
      catchError((error: unknown) => {
        const err = error as any;
        logOperationFail(handler, Date.now() - startedAt, statusFromError(err), codeFromError(err), `message=${safeJson(err?.message || String(err))}`);
        return throwError(() => error);
      }),
    );
  }
}
