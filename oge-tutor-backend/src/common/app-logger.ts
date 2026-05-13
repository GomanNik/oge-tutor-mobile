/*
 * OGE Tutor Backend — structured console logger.
 * Supports requestId correlation, log levels and sensitive payload masking.
 */
import { getRequestId } from './request-context';

const LEVELS = Object.freeze({ silent: 0, error: 1, warn: 2, info: 3, debug: 4 });
type LogLevel = keyof typeof LEVELS;

function normalizeLevel(value: unknown): LogLevel {
  const candidate = String(value || '').toLowerCase();
  return candidate in LEVELS ? candidate as LogLevel : process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

function enabled(level: LogLevel): boolean {
  return LEVELS[normalizeLevel(process.env.LOG_LEVEL)] >= LEVELS[level];
}

export function maskSensitive(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Buffer.isBuffer(value)) return '[file]';
  if (Array.isArray(value)) return value.map((item) => maskSensitive(item));
  if (typeof value !== 'object') return value;

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (lower.includes('password') || lower.includes('token') || lower === 'authorization') {
      result[key] = '[masked]';
    } else if (lower === 'file' || lower === 'buffer' || lower === 'binary') {
      result[key] = '[file]';
    } else {
      result[key] = maskSensitive(entry);
    }
  }
  return result;
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(maskSensitive(value));
  } catch {
    return '"[unserializable]"';
  }
}

function write(level: LogLevel, line: string): void {
  if (!enabled(level)) return;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function logHttp(line: string): void {
  write('info', `[HTTP] ${line}`);
}

export function logOperationStart(handler: string, meta = ''): void {
  write('debug', `[OPERATION START] ${getRequestId()} ${handler}${meta ? ` ${meta}` : ''}`);
}

export function logOperationData(handler: string, payload: unknown): void {
  write('debug', `[OPERATION DATA] ${getRequestId()} ${handler} payload=${safeJson(payload)}`);
}

export function logOperationOk(handler: string, durationMs: number, result = ''): void {
  write('debug', `[OPERATION OK] ${getRequestId()} ${handler} ${durationMs}ms${result ? ` result=${result}` : ''}`);
}

export function logOperationFail(handler: string, durationMs: number, status: number, code: string, extra = ''): void {
  write('error', `[OPERATION FAIL] ${getRequestId()} ${handler} ${durationMs}ms status=${status} code=${code}${extra ? ` ${extra}` : ''}`);
}

export function logDomain(event: string, details: Record<string, unknown> = {}): void {
  const fields = Object.entries(maskSensitive(details) as Record<string, unknown>)
    .map(([key, value]) => `${key}=${Array.isArray(value) || typeof value === 'object' ? safeJson(value) : String(value)}`)
    .join(' ');
  write('info', `[DOMAIN] ${getRequestId()} ${event}${fields ? ` ${fields}` : ''}`);
}

export function logDb(action: string, details: Record<string, unknown> = {}): void {
  const fields = Object.entries(maskSensitive(details) as Record<string, unknown>)
    .map(([key, value]) => `${key}=${Array.isArray(value) || typeof value === 'object' ? safeJson(value) : String(value)}`)
    .join(' ');
  write('debug', `[DB] ${getRequestId()} ${action}${fields ? ` ${fields}` : ''}`);
}
