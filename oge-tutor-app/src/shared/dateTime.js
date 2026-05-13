/*
 * OGE Tutor App — timezone-aware ISO/RFC3339 date helpers.
 * Backend-facing state stores machine dates. UI forms work with local date/time values in an explicit timezone.
 */
const FALLBACK_TIMEZONE = 'Europe/Moscow';
const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIMEZONE;

const formatterCache = new Map();

function pad(value) {
  return String(value).padStart(2, '0');
}

function safeTimezone(timezone) {
  const value = String(timezone || DEFAULT_TIMEZONE || FALLBACK_TIMEZONE);
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: value }).format(new Date());
    return value;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

function getFormatter(key, options) {
  const cacheKey = `${key}:${JSON.stringify(options)}`;
  if (!formatterCache.has(cacheKey)) formatterCache.set(cacheKey, new Intl.DateTimeFormat('ru-RU', options));
  return formatterCache.get(cacheKey);
}

function parseDateParts(dateValue) {
  const match = String(dateValue || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  if (![year, month, day].every(Number.isInteger)) return null;
  return { year, month, day };
}

function parseTimeParts(timeValue = '00:00') {
  const match = String(timeValue || '00:00').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function partsFromInstant(date, timezone = appTimezone()) {
  const formatter = getFormatter('parts', {
    timeZone: safeTimezone(timezone),
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function timezoneOffsetMs(instantMs, timezone) {
  const instant = new Date(instantMs);
  const parts = partsFromInstant(instant, timezone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0, 0);
  return asUtc - instantMs;
}

export function appTimezone() {
  return safeTimezone(DEFAULT_TIMEZONE);
}

export function isIsoDateTime(value) {
  if (!value || typeof value !== 'string') return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && /T/.test(value);
}

export function nowIso() {
  return new Date().toISOString();
}

export function toIsoFromLocalParts(dateValue, timeValue = '00:00', timezone = appTimezone()) {
  const dateParts = parseDateParts(dateValue);
  const timeParts = parseTimeParts(timeValue);
  if (!dateParts || !timeParts) return '';

  const targetUtc = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hour,
    timeParts.minute,
    0,
    0,
  );

  let instantMs = targetUtc;
  for (let index = 0; index < 3; index += 1) {
    instantMs = targetUtc - timezoneOffsetMs(instantMs, timezone);
  }

  const check = partsFromInstant(new Date(instantMs), timezone);
  if (
    check.year !== dateParts.year
    || check.month !== dateParts.month
    || check.day !== dateParts.day
    || check.hour !== timeParts.hour
    || check.minute !== timeParts.minute
  ) {
    return '';
  }

  return new Date(instantMs).toISOString();
}

export function endOfLocalDayIso(dateValue, timezone = appTimezone()) {
  return toIsoFromLocalParts(dateValue, '23:59', timezone);
}

export function addMinutesIso(isoValue, minutes) {
  const base = Date.parse(isoValue);
  const amount = Number(minutes);
  if (!Number.isFinite(base) || !Number.isFinite(amount)) return '';
  return new Date(base + amount * 60 * 1000).toISOString();
}

export function minutesBetween(startAt, endAt, fallback = 60) {
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return fallback;
  return Math.round((end - start) / 60000);
}

export function dateInputValue(isoValue, timezone = appTimezone()) {
  const date = new Date(isoValue || '');
  if (Number.isNaN(date.getTime())) return '';
  const parts = partsFromInstant(date, timezone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function timeInputValue(isoValue, timezone = appTimezone()) {
  const date = new Date(isoValue || '');
  if (Number.isNaN(date.getTime())) return '';
  const parts = partsFromInstant(date, timezone);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function formatDateLabel(isoValue, fallback = 'дата не указана', timezone = appTimezone()) {
  const date = new Date(isoValue || '');
  if (Number.isNaN(date.getTime())) return fallback;
  return getFormatter('date', { timeZone: safeTimezone(timezone), day: 'numeric', month: 'long' }).format(date);
}

export function formatTimeLabel(isoValue, fallback = 'время не указано', timezone = appTimezone()) {
  const date = new Date(isoValue || '');
  if (Number.isNaN(date.getTime())) return fallback;
  return getFormatter('time', { timeZone: safeTimezone(timezone), hour: '2-digit', minute: '2-digit' }).format(date);
}

export function formatDateTimeLabel(isoValue, fallback = 'дата не указана', timezone = appTimezone()) {
  const date = new Date(isoValue || '');
  if (Number.isNaN(date.getTime())) return fallback;
  return getFormatter('datetime', { timeZone: safeTimezone(timezone), day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(date);
}

export function normalizeIsoDateTime(value) {
  if (!value) return '';
  if (isIsoDateTime(value)) return new Date(value).toISOString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

export function normalizeDurationMinutes(value) {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes > 0 && minutes <= 480 ? minutes : 0;
}

export function isPastIso(isoValue, now = Date.now()) {
  const time = Date.parse(isoValue);
  return Number.isFinite(time) && time < now;
}

export function buildLessonSchedule({ date, time, durationMinutes = 60, timezone = appTimezone() }) {
  const normalizedDuration = normalizeDurationMinutes(durationMinutes);
  const startAt = normalizedDuration ? toIsoFromLocalParts(date, time, timezone) : '';
  const endAt = startAt ? addMinutesIso(startAt, normalizedDuration) : '';
  return {
    startAt,
    endAt,
    timezone: safeTimezone(timezone),
    durationMinutes: normalizedDuration,
  };
}
