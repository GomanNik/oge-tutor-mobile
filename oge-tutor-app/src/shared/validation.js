/*
 * OGE Tutor App — shared validation helpers.
 * Frontend validation mirrors backend contracts but never replaces server-side validation.
 */
import { TASKS } from '../domain/tasks/index.js';
import { normalizeText, parseTaskNumberInput } from './formatters.js';
import { isPastIso } from './dateTime.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

export function validateEmail(value) {
  const email = normalizeText(value).toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) return { ok: false, value: '', error: 'Введите корректный email.' };
  return { ok: true, value: email, error: '' };
}

export function validateTaskNumbersInput(raw, { required = true } = {}) {
  const result = parseTaskNumberInput(raw);
  if (result.invalidTokens.length) return { ok: false, taskNumbers: [], error: `Некорректные номера заданий: ${result.invalidTokens.join(', ')}.` };
  if (result.outOfRange.length) return { ok: false, taskNumbers: [], error: `Номера заданий должны быть от 1 до 25: ${result.outOfRange.join(', ')}.` };
  if (result.duplicates.length) return { ok: false, taskNumbers: [], error: `Повторяются номера заданий: ${result.duplicates.join(', ')}.` };
  const knownNumbers = new Set(TASKS.map((task) => task.n));
  const unknown = result.taskNumbers.filter((taskNumber) => !knownNumbers.has(taskNumber));
  if (unknown.length) return { ok: false, taskNumbers: [], error: `Неизвестные номера заданий: ${unknown.join(', ')}.` };
  if (required && !result.taskNumbers.length) return { ok: false, taskNumbers: [], error: 'Укажите хотя бы один номер задания.' };
  return { ok: true, taskNumbers: result.taskNumbers, error: '' };
}

export function validateFutureIso(value, message = 'Дата не может быть в прошлом.') {
  if (!value) return { ok: false, error: 'Укажите корректную дату.' };
  if (isPastIso(value)) return { ok: false, error: message };
  return { ok: true, error: '' };
}
