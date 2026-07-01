import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const startedAt = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - startedAt;
      const user = (req as any).user;
      const role = user?.role ? ` role=${user.role}` : '';
      const profile = user?.teacherId || user?.studentId || '';
      const profileText = profile ? ` profile=${profile}` : '';
      console.log(`[HTTP] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${duration}ms${role}${profileText}`);
    });
    next();
  }
}
