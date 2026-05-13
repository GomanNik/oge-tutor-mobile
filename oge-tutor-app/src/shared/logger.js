/*
 * OGE Tutor App — frontend structured logger.
 * Keeps UI, store and API actions correlated with requestId while masking sensitive values.
 */
const LEVELS = Object.freeze({ silent: 0, error: 1, warn: 2, info: 3, debug: 4 });

function normalizeLevel(value) {
  const candidate = String(value || '').toLowerCase();
  if (candidate in LEVELS) return candidate;
  return import.meta.env?.PROD ? 'info' : 'debug';
}

function isEnabled(level) {
  return LEVELS[normalizeLevel(import.meta.env?.VITE_LOG_LEVEL)] >= LEVELS[level];
}

export function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `req_${crypto.randomUUID()}`;
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function maskSensitive(value) {
  if (value === null || value === undefined) return value;
  if (typeof File !== 'undefined' && value instanceof File) return `[file:${value.name}:${value.size}]`;
  if (value instanceof FormData) {
    const result = {};
    value.forEach((entry, key) => {
      result[key] = maskSensitive(entry);
    });
    return result;
  }
  if (Array.isArray(value)) return value.map(maskSensitive);
  if (typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    const lower = key.toLowerCase();
    if (lower.includes('password') || lower.includes('token') || lower === 'authorization') return [key, '[masked]'];
    if (lower === 'file' || lower === 'binary' || lower === 'buffer') return [key, maskSensitive(entry)];
    return [key, maskSensitive(entry)];
  }));
}

function safeJson(value) {
  try {
    return JSON.stringify(maskSensitive(value));
  } catch {
    return '"[unserializable]"';
  }
}

function write(level, tag, message, details) {
  if (!isEnabled(level)) return;
  const suffix = details === undefined ? '' : ` ${typeof details === 'string' ? details : safeJson(details)}`;
  const line = `[${tag}] ${message}${suffix}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = Object.freeze({
  ui: (message, details) => write('info', 'UI', message, details),
  form: (message, details) => write('debug', 'FORM', message, details),
  store: (message, details) => write('debug', 'STORE', message, details),
  api: (message, details) => write('debug', 'API', message, details),
  nav: (message, details) => write('info', 'NAV', message, details),
  state: (message, details) => write('debug', 'STATE', message, details),
  warn: (message, details) => write('warn', 'WARN', message, details),
  error: (message, details) => write('error', 'ERROR', message, details),
});
