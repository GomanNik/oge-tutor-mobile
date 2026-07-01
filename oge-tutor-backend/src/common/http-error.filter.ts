import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AppError } from './app-error';

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

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = String(request.headers['x-request-id'] || randomUUID());

    if (error instanceof AppError) {
      return response.status(error.status).json({
        code: error.code,
        message: error.message,
        fieldErrors: error.fieldErrors,
        requestId,
      });
    }

    const prismaMapped = prismaErrorToResponse(error);
    if (prismaMapped) {
      return response.status(prismaMapped.status).json({ ...prismaMapped, requestId });
    }

    if (error instanceof HttpException) {
      const status = error.getStatus();
      const body = error.getResponse();
      const message = typeof body === 'object' && body && 'message' in body
        ? Array.isArray((body as any).message) ? (body as any).message.join('; ') : String((body as any).message)
        : error.message || statusToMessage(status);
      return response.status(status).json({
        code: statusToCode(status),
        message,
        fieldErrors: {},
        requestId,
      });
    }

    console.error(error);
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'server_error',
      message: statusToMessage(500),
      fieldErrors: {},
      requestId,
    });
  }
}
