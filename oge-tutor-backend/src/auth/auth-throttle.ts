import { createHash } from 'node:crypto';

export const AUTH_THROTTLE_TTL_MS = 15 * 60 * 1000;

export function authTargetTracker(request: Record<string, unknown>): string {
  const body = request.body as { email?: unknown; token?: unknown } | undefined;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  const ip = typeof request.ip === 'string' ? request.ip : 'unknown';
  const target = email ? `email:${email}` : token ? `token:${token}` : `ip:${ip}`;
  return createHash('sha256').update(target).digest('hex');
}
