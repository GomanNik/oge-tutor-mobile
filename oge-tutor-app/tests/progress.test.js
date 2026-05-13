/*
 * OGE Tutor App — progress model tests.
 */
import { describe, expect, it } from 'vitest';
import {
  PROGRESS_COVERAGE_STATUS,
  PROGRESS_MASTERY_LEVEL,
  deriveProgressStats,
  markTasksAssessmentNeeded,
} from '../src/domain/progress/index.js';

describe('student progress diagnostics', () => {
  it('does not count not-started tasks as weak or mastered', () => {
    const stats = deriveProgressStats([
      { taskNumber: 1, coverageStatus: PROGRESS_COVERAGE_STATUS.NOT_STARTED, masteryLevel: null },
      { taskNumber: 2, coverageStatus: PROGRESS_COVERAGE_STATUS.ASSESSED, masteryLevel: PROGRESS_MASTERY_LEVEL.WEAK },
    ]);

    expect(stats.coverageCount).toBe(1);
    expect(stats.weak).toEqual([2]);
    expect(stats.notStartedTasks.some((task) => task.taskNumber === 1)).toBe(true);
  });

  it('preserves previous mastery while requesting a new assessment after a lesson', () => {
    const next = markTasksAssessmentNeeded([
      { taskNumber: 6, coverageStatus: PROGRESS_COVERAGE_STATUS.ASSESSED, masteryLevel: PROGRESS_MASTERY_LEVEL.MEDIUM },
    ], [6], { id: 'l-1', completedAt: '2026-05-15T10:00:00.000Z' }, 'Повторили');

    const task = next.find((item) => item.taskNumber === 6);
    expect(task.coverageStatus).toBe(PROGRESS_COVERAGE_STATUS.ASSESSMENT_NEEDED);
    expect(task.masteryLevel).toBeNull();
    expect(task.lastAssessedMasteryLevel).toBe(PROGRESS_MASTERY_LEVEL.MEDIUM);
    expect(task.lessonCount).toBe(1);
  });
});
