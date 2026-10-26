import { Temporal } from '@js-temporal/polyfill';
import { RRule } from 'rrule';
import { validationError } from '../common/app-error';
import { SeriesRuleDto } from './lesson-series.dto';

export type SeriesOccurrence = { key: string; localStart: string; startAt: Date; endAt: Date };
export type RecurrenceIssue = { occurrenceKey: string; code: string };
export function seriesHasEnded(rule: Pick<SeriesRuleDto, 'timezone' | 'untilLocalDate'>, now = new Date()) {
  const localDay = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(rule.timezone).toPlainDate();
  return Temporal.PlainDate.compare(localDay, Temporal.PlainDate.from(rule.untilLocalDate)) > 0;
}
export function normalizeSeriesRule(input: SeriesRuleDto): SeriesRuleDto {
  const rule: SeriesRuleDto = {
    courseId: input.courseId, topic: input.topic.trim(), note: input.note.trim(), format: input.format,
    startsAtLocal: input.startsAtLocal, untilLocalDate: input.untilLocalDate, timezone: input.timezone,
    frequency: input.frequency, interval: input.interval, weekdays: [...input.weekdays].sort((a, b) => a - b),
    monthDays: [...input.monthDays].sort((a, b) => a - b), excludedDates: [...input.excludedDates].sort(), durationMinutes: input.durationMinutes,
    materializeDays: input.materializeDays, dstDisambiguation: input.dstDisambiguation,
    teacherLinkIds: [...input.teacherLinkIds].sort(), participantEnrollmentIds: [...input.participantEnrollmentIds].sort(),
  };
  try {
    const start = Temporal.PlainDateTime.from(rule.startsAtLocal);
    const end = Temporal.PlainDate.from(rule.untilLocalDate);
    if (start.year < 1970 || start.year > 9998) throw new Error();
    if (Temporal.PlainDate.compare(end, start.toPlainDate()) < 0 || start.toPlainDate().until(end).days > 366) throw new Error();
    start.toZonedDateTime(rule.timezone);
    for (const value of rule.excludedDates) {
      const date = Temporal.PlainDate.from(value);
      if (Temporal.PlainDate.compare(date, start.toPlainDate()) < 0 || Temporal.PlainDate.compare(date, end) > 0) throw new Error();
    }
  } catch { throw validationError('Проверьте локальное начало, зону IANA и окончание серии (не более 366 дней).'); }
  if (rule.topic.length < 2 || rule.frequency === 'weekly' && !rule.weekdays.length
    || rule.frequency !== 'weekly' && rule.weekdays.length || rule.frequency !== 'monthly' && rule.monthDays.length)
    throw validationError('Дни недели задаются для недельного правила, дни месяца — для месячного.');
  return rule;
}

// RRule expands floating calendar values; Temporal alone resolves them to real UTC instants.
export function expandSeries(rule: SeriesRuleDto, from: Date, through?: Date) {
  const start = Temporal.PlainDateTime.from(rule.startsAtLocal);
  const until = Temporal.PlainDate.from(rule.untilLocalDate).toPlainDateTime('23:59:59');
  const localFrom = Temporal.Instant.fromEpochMilliseconds(from.getTime()).toZonedDateTimeISO(rule.timezone).toPlainDateTime();
  const cutoff = through || new Date(from.getTime() + rule.materializeDays * 86400000);
  const horizon = Temporal.Instant.fromEpochMilliseconds(cutoff.getTime()).toZonedDateTimeISO(rule.timezone).toPlainDateTime();
  const floating = (date: Temporal.PlainDateTime) => new Date(Date.UTC(date.year, date.month - 1, date.day, date.hour, date.minute, date.second));
  const recurrence = new RRule({
    dtstart: floating(start), until: floating(until), freq: { daily: RRule.DAILY, weekly: RRule.WEEKLY, monthly: RRule.MONTHLY }[rule.frequency],
    interval: rule.interval, ...(rule.frequency === 'weekly' ? { byweekday: rule.weekdays.map(day => day - 1) } : {}),
    ...(rule.frequency === 'monthly' ? { bymonthday: rule.monthDays.length ? rule.monthDays : [start.day] } : {}),
  });
  const values = recurrence.between(floating(localFrom.with({ hour: 0, minute: 0, second: 0 })), floating(horizon), true);
  if (values.length > 200) throw validationError('Слишком много занятий в одном пакете: максимум 200.');
  const occurrences: SeriesOccurrence[] = [];
  const issues: RecurrenceIssue[] = [];
  for (const value of values) {
    const plain = Temporal.PlainDateTime.from(value.toISOString().slice(0, 19));
    const key = plain.toPlainDate().toString();
    if (rule.excludedDates.includes(key)) continue;
    try {
      const zoned = plain.toZonedDateTime(rule.timezone, { disambiguation: rule.dstDisambiguation });
      if (!zoned.toPlainDateTime().equals(plain)) throw new RangeError('Nonexistent local time');
      const startAt = new Date(zoned.epochMilliseconds);
      if (startAt > from && startAt <= cutoff) occurrences.push({ key, localStart: plain.toString({ smallestUnit: 'minute' }), startAt, endAt: new Date(startAt.getTime() + rule.durationMinutes * 60000) });
    } catch { if (Temporal.PlainDateTime.compare(plain, localFrom) >= 0) issues.push({ occurrenceKey: key, code: 'ambiguous_or_nonexistent_local_time' }); }
  }
  return { occurrences, issues, through: cutoff };
}
