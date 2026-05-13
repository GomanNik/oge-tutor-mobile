import { OGE_TASK_MAX, OGE_TASK_MIN, PROGRESS_COVERAGE_STATUS, PROGRESS_MASTERY_LEVEL } from './contracts';
import { validationError } from './app-error';

export function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

export function requireText(value: unknown, field: string): string {
  const text = cleanText(value);
  if (!text) throw validationError('Заполните обязательные поля.', { [field]: 'required' });
  return text;
}

export function validateEmail(email: unknown): string {
  const text = cleanText(email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    throw validationError('Введите корректный email.', { email: 'invalid' });
  }
  return text;
}

export function validatePassword(password: unknown, field = 'password'): string {
  const text = String(password ?? '');
  if (text.length < 6) throw validationError('Пароль должен быть не короче 6 символов.', { [field]: 'min_length_6' });
  return text;
}

export function parseTaskNumbers(input: unknown, field = 'taskNumbers'): number[] {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(/[;,\s]+/);
  const numbers = raw.map(Number).filter((item) => Number.isInteger(item));
  const unique = [...new Set(numbers)];
  const invalid = unique.filter((item) => item < OGE_TASK_MIN || item > OGE_TASK_MAX);
  if (invalid.length || unique.length !== raw.filter((item) => String(item).trim()).length) {
    throw validationError('Номера заданий должны быть уникальными числами от 1 до 25.', { [field]: 'invalid_task_numbers' });
  }
  return unique;
}

export function parseOptionalTaskNumbers(input: unknown, field = 'taskNumbers'): number[] {
  if (input === undefined || input === null || input === '') return [];
  return parseTaskNumbers(input, field);
}

export function parseIsoDate(value: unknown, field: string): Date {
  const text = cleanText(value);
  const date = new Date(text);
  if (!text || Number.isNaN(date.getTime())) throw validationError('Передайте корректную ISO-дату.', { [field]: 'invalid_date' });
  return date;
}

export function assertFutureDate(date: Date, field: string) {
  if (date.getTime() <= Date.now()) throw validationError('Дата должна быть в будущем.', { [field]: 'past_date' });
}

export function assertLessonInterval(startAt: Date, endAt: Date) {
  if (endAt.getTime() <= startAt.getTime()) {
    throw validationError('Время окончания должно быть позже начала.', { endAt: 'must_be_after_startAt' });
  }
  const durationMinutes = Math.round((endAt.getTime() - startAt.getTime()) / 60000);
  if (durationMinutes <= 0) throw validationError('Длительность занятия должна быть больше нуля.', { durationMinutes: 'positive' });
  return durationMinutes;
}

export function assertProgressConsistency(coverageStatus: string, masteryLevel: string | null) {
  const knownCoverage = Object.values(PROGRESS_COVERAGE_STATUS).includes(coverageStatus as any);
  if (!knownCoverage) throw validationError('Некорректный статус прохождения.', { coverageStatus: 'invalid' });
  if (coverageStatus !== PROGRESS_COVERAGE_STATUS.ASSESSED && masteryLevel !== null) {
    throw validationError('Уровень освоения можно назначать только оценённому заданию.', { masteryLevel: 'must_be_null' });
  }
  if (coverageStatus === PROGRESS_COVERAGE_STATUS.ASSESSED && !masteryLevel) {
    throw validationError('Оценённому заданию нужен уровень освоения.', { masteryLevel: 'required' });
  }
  if (masteryLevel && !Object.values(PROGRESS_MASTERY_LEVEL).includes(masteryLevel as any)) {
    throw validationError('Некорректный уровень освоения.', { masteryLevel: 'invalid' });
  }
}
