import { describe, expect, it } from 'vitest';
import { calculateProgressSummary } from '../src/bootstrap/progress-summary';

describe('calculateProgressSummary', () => {
  it('ignores not started tasks and counts only assessed weak tasks as weak', () => {
    const summary = calculateProgressSummary([
      { taskNumber: 1, coverageStatus: 'not_started', masteryLevel: null },
      { taskNumber: 2, coverageStatus: 'assessed', masteryLevel: 'weak' },
      { taskNumber: 3, coverageStatus: 'assessment_needed', masteryLevel: null },
    ]);
    expect(summary.weak).toEqual([2]);
    expect(summary.coveragePercent).toBe(8);
    expect(summary.masteryPercent).toBe(25);
  });
});
