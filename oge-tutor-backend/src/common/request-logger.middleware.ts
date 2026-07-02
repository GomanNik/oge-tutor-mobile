import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

type RequestWithContext = Request & {
  requestId?: string;
  user?: {
    role?: string;
    teacherId?: string;
    studentId?: string;
  };
};

function requestPath(req: Request): string {
  return req.path || req.originalUrl?.split('?')[0] || req.url?.split('?')[0] || '';
}

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  use(req: RequestWithContext, res: Response, next: NextFunction) {
    const requestId = req.header('x-request-id') || randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    const startedAt = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - startedAt;
      const user = req.user;
      console.log(JSON.stringify({
        event: 'http_request',
        requestId,
        method: req.method,
        path: requestPath(req),
        statusCode: res.statusCode,
        durationMs: duration,
        role: user?.role,
        profileId: user?.teacherId || user?.studentId,
      }));
    });
    next();
  }
}
