import { createHash } from 'node:crypto';

export const AUTH_THROTTLE_TTL_MS = 15 * 60 * 1000;

export function authTargetTracker(request: Record<string, unknown>): string {
  const body = request.body as { email?: unknown; token?: unknown } | undefined;
  const params = request.params as { id?: unknown } | undefined;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  const invitationId = typeof params?.id === 'string' ? params.id : '';
  const ip = typeof request.ip === 'string' ? request.ip : 'unknown';
  const user = request.user as { id?: unknown } | undefined;
  const target = email ? `email:${email}` : token ? `token:${token}` : invitationId ? `invitation:${invitationId}` : typeof user?.id === 'string' ? `user:${user.id}` : `ip:${ip}`;
  return createHash('sha256').update(target).digest('hex');
}
