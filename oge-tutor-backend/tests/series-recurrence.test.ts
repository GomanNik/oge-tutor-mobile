import { describe, expect, it } from 'vitest';
import { SeriesRuleDto } from '../src/course-lessons/lesson-series.dto';
import { expandSeries, normalizeSeriesRule } from '../src/course-lessons/series-recurrence';

const rule = (overrides: Partial<SeriesRuleDto> = {}) => normalizeSeriesRule(Object.assign(new SeriesRuleDto(), {
  courseId: 'course', topic: 'Алгебра', format: 'group', startsAtLocal: '2027-01-04T18:00', untilLocalDate: '2027-04-30', timezone: 'Europe/Moscow',
  frequency: 'weekly', weekdays: [1, 3], durationMinutes: 60, teacherLinkIds: ['teacher'], participantEnrollmentIds: ['student'], ...overrides,
}));

describe('bounded calendar recurrence', () => {
  it('expands weekdays in the series zone, independently of the host timezone', () => {
    const result = expandSeries(rule(), new Date('2027-01-01Z'), new Date('2027-01-12Z'));
    expect(result.occurrences.map(row => row.startAt.toISOString())).toEqual(['2027-01-04T15:00:00.000Z', '2027-01-06T15:00:00.000Z', '2027-01-11T15:00:00.000Z']);
    expect(result.issues).toEqual([]);
  });
  it('respects anchored biweekly intervals rather than restarting the cadence at the horizon', () => {
    expect(expandSeries(rule({ interval: 2, weekdays: [1] }), new Date('2027-01-10Z'), new Date('2027-02-01Z')).occurrences.map(row => row.key)).toEqual(['2027-01-18']);
  });
  it('supports explicit monthly days and skips nonexistent month dates', () => {
    const monthly = rule({ frequency: 'monthly', weekdays: [], monthDays: [31], startsAtLocal: '2027-01-31T10:00' });
    expect(expandSeries(monthly, new Date('2027-01-01Z'), new Date('2027-04-01Z')).occurrences.map(row => row.key)).toEqual(['2027-01-31', '2027-03-31']);
  });
  it('keeps wall-clock time stable across a DST change', () => {
    const weekly = rule({ timezone: 'America/New_York', startsAtLocal: '2027-03-01T18:00', weekdays: [1] });
    const values = expandSeries(weekly, new Date('2027-03-01Z'), new Date('2027-03-17Z')).occurrences;
    expect(values.map(row => row.startAt.toISOString())).toEqual(['2027-03-01T23:00:00.000Z', '2027-03-08T23:00:00.000Z', '2027-03-15T22:00:00.000Z']);
  });
  it('reports a spring DST gap without silently moving the lesson', () => {
    for (const dstDisambiguation of ['reject', 'earlier', 'later'] as const) {
      const gap = rule({ timezone: 'America/New_York', startsAtLocal: '2027-03-14T02:30', weekdays: [7], dstDisambiguation });
      const result = expandSeries(gap, new Date('2027-03-13Z'), new Date('2027-03-15Z'));
      expect(result.occurrences).toHaveLength(0);
      expect(result.issues).toEqual([{ occurrenceKey: '2027-03-14', code: 'ambiguous_or_nonexistent_local_time' }]);
    }
  });
  it('allows an explicitly excluded DST date or holiday', () => {
    const gap = rule({ timezone: 'America/New_York', startsAtLocal: '2027-03-14T02:30', weekdays: [7], excludedDates: ['2027-03-14'] });
    expect(expandSeries(gap, new Date('2027-03-13Z'), new Date('2027-03-15Z'))).toMatchObject({ occurrences: [], issues: [] });
  });
  it('requires an explicit choice for an ambiguous fall-back time', () => {
    const base = { timezone: 'America/New_York', startsAtLocal: '2027-11-07T01:30', untilLocalDate: '2027-11-08', weekdays: [7] };
    const from = new Date('2027-11-06Z'), through = new Date('2027-11-08Z');
    expect(expandSeries(rule(base), from, through).issues).toHaveLength(1);
    expect(expandSeries(rule({ ...base, dstDisambiguation: 'earlier' }), from, through).occurrences[0].startAt.toISOString()).toBe('2027-11-07T05:30:00.000Z');
    expect(expandSeries(rule({ ...base, dstDisambiguation: 'later' }), from, through).occurrences[0].startAt.toISOString()).toBe('2027-11-07T06:30:00.000Z');
  });
  it('never includes the past or instants outside the requested horizon', () => {
    const from = new Date('2027-01-04T15:00Z');
    expect(expandSeries(rule(), from, new Date('2027-01-06T14:59Z')).occurrences).toHaveLength(0);
  });
  it('bounds the rule period and rejects invalid dates, zones and incompatible day filters', () => {
    for (const values of [{ timezone: 'Not/AZone' }, { startsAtLocal: '2027-02-30T18:00' }, { untilLocalDate: '2029-01-01' }, { untilLocalDate: '2026-12-01' }, { frequency: 'weekly', weekdays: [] }, { frequency: 'daily' }, { monthDays: [2] }, { excludedDates: ['2027-02-30'] }]) {
      expect(() => rule(values as Partial<SeriesRuleDto>)).toThrow();
    }
  });
  it('applies the default bounded rolling horizon and explicit end date', () => {
    const daily = rule({ frequency: 'daily', weekdays: [], untilLocalDate: '2027-01-05', materializeDays: 7 });
    const result = expandSeries(daily, new Date('2027-01-01Z'));
    expect(result.occurrences.map(row => row.key)).toEqual(['2027-01-04', '2027-01-05']);
    expect(result.through.toISOString()).toBe('2027-01-08T00:00:00.000Z');
  });
});
