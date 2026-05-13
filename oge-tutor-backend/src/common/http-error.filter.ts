/*
 * OGE Tutor Backend — structured API error filter.
 * Converts framework, domain and Prisma errors into the frontend error contract with requestId.
 */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AppError } from './app-error';
import { logDomain, safeJson } from './app-logger';
import { getRequestId } from './request-context';

function statusToCode(status: number): string {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 422 || status === 400) return 'validation_error';
  if (status >= 500) return 'server_error';
  return 'http_error';
}

function statusToMessage(status: number): string {
  if (status === 401) return 'Сессия истекла. Войдите заново.';
  if (status === 403) return 'Недостаточно прав для этого действия.';
  if (status === 404) return 'Данные не найдены.';
  if (status === 409) return 'Конфликт данных. Обновите страницу и повторите действие.';
  if (status === 422 || status === 400) return 'Проверьте заполненные поля.';
  return 'Сервер временно недоступен.';
}

function prismaErrorToResponse(error: any) {
  if (error?.code === 'P2002') {
    const targets = Array.isArray(error?.meta?.target) ? error.meta.target : [];
    const fieldErrors = targets.includes('email') ? { email: 'exists' } : { unique: 'exists' };
    return { status: 409, code: 'conflict', message: targets.includes('email') ? 'Email уже используется.' : statusToMessage(409), fieldErrors };
  }
  if (error?.code === 'P2025') {
    return { status: 404, code: 'not_found', message: statusToMessage(404), fieldErrors: {} };
  }
  return null;
}

function fieldErrorsFromHttpBody(body: unknown): Record<string, string> {
  if (!body || typeof body !== 'object') return {};
  const source = body as Record<string, any>;
  if (source.fieldErrors && typeof source.fieldErrors === 'object') return source.fieldErrors;

  const messages = Array.isArray(source.message) ? source.message : [];
  return messages.reduce((acc: Record<string, string>, message: unknown) => {
    const text = String(message || '');
    const field = text.split(' ')[0];
    if (field) acc[field] = text;
    return acc;
  }, {});
}

function requestIdFromRequest(request: Request & { requestId?: string }): string {
  return request.requestId || getRequestId(String(request.headers['x-request-id'] || `req_${randomUUID()}`));
}

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = requestIdFromRequest(request);
    response.setHeader('x-request-id', requestId);

    if (error instanceof AppError) {
      if (error.status === 403) logDomain('access.denied', { code: error.code, message: error.message });
      if (error.status === 422) logDomain('validation.failed', { fieldErrors: error.fieldErrors });
      return response.status(error.status).json({
        code: error.code,
        message: error.message,
        fieldErrors: error.fieldErrors,
        requestId,
      });
    }

    const prismaMapped = prismaErrorToResponse(error);
    if (prismaMapped) {
      logDomain(prismaMapped.status === 409 ? 'validation.failed' : 'access.denied', { code: prismaMapped.code, fieldErrors: prismaMapped.fieldErrors });
      return response.status(prismaMapped.status).json({ ...prismaMapped, requestId });
    }

    if (error instanceof HttpException) {
      const status = error.getStatus();
      const body = error.getResponse();
      const message = typeof body === 'object' && body && 'message' in body
        ? Array.isArray((body as any).message) ? (body as any).message.join('; ') : String((body as any).message)
        : error.message || statusToMessage(status);
      const fieldErrors = fieldErrorsFromHttpBody(body);
      if (status === 400 || status === 422) logDomain('validation.failed', { fieldErrors, message });
      if (status === 403) logDomain('access.denied', { message });
      return response.status(status).json({
        code: statusToCode(status),
        message,
        fieldErrors,
        requestId,
      });
    }

    console.error(`[ERROR] ${requestId} unhandled=${safeJson(error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error)}`);
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'server_error',
      message: statusToMessage(500),
      fieldErrors: {},
      requestId,
    });
  }
}
