/*
 * OGE Tutor Backend — HTTP request logger middleware.
 * Binds the frontend requestId to the backend request lifecycle and logs sanitized transport metadata.
 */
import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { logHttp, safeJson } from './app-logger';
import { runWithRequestContext } from './request-context';

type RequestWithContext = Request & { requestId?: string; user?: any };

function requestIdFromHeader(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = String(raw || '').trim();
  return text || `req_${randomUUID()}`;
}

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  use(req: RequestWithContext, res: Response, next: NextFunction) {
    const startedAt = Date.now();
    const requestId = requestIdFromHeader(req.headers['x-request-id']);
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    res.on('finish', () => {
      const duration = Date.now() - startedAt;
      const user = req.user;
      const role = user?.role || '-';
      const profile = user?.teacherId || user?.studentId || '-';
      const userId = user?.id || '-';
      const ip = req.ip || '-';
      const userAgent = String(req.headers['user-agent'] || '-').replace(/\s+/g, ' ');
      const params = Object.keys(req.params || {}).length ? ` params=${safeJson(req.params)}` : '';
      const query = Object.keys(req.query || {}).length ? ` query=${safeJson(req.query)}` : '';
      const body = req.body && Object.keys(req.body).length ? ` body=${safeJson(req.body)}` : '';

      logHttp(`${requestId} ${req.method} ${req.originalUrl} -> ${res.statusCode} ${duration}ms role=${role} user=${userId} profile=${profile} ip=${ip} ua=${safeJson(userAgent)}${params}${query}${body}`);
    });

    runWithRequestContext({ requestId }, next);
  }
}
