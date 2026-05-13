import { PROGRESS_COVERAGE_STATUS, PROGRESS_MASTERY_LEVEL, SCORE_FORMULA_VERSION, MAX_PRIMARY_SCORE } from '../common/contracts';

const MASTERY_SCORE: Record<string, number> = {
  [PROGRESS_MASTERY_LEVEL.WEAK]: 0.25,
  [PROGRESS_MASTERY_LEVEL.MEDIUM]: 0.55,
  [PROGRESS_MASTERY_LEVEL.GOOD]: 0.8,
  [PROGRESS_MASTERY_LEVEL.STRONG]: 1,
};

export function calculateProgressSummary(progressByTask: Array<{ coverageStatus: string; masteryLevel: string | null; taskNumber: number }>) {
  const assessed = progressByTask.filter((item) => item.coverageStatus === PROGRESS_COVERAGE_STATUS.ASSESSED && item.masteryLevel);
  const touched = progressByTask.filter((item) => item.coverageStatus !== PROGRESS_COVERAGE_STATUS.NOT_STARTED);
  const weak = assessed.filter((item) => item.masteryLevel === PROGRESS_MASTERY_LEVEL.WEAK).map((item) => item.taskNumber).sort((a, b) => a - b);
  const average = assessed.length
    ? assessed.reduce((sum, item) => sum + (MASTERY_SCORE[item.masteryLevel || ''] || 0), 0) / assessed.length
    : 0;
  const masteryPercent = Math.round(average * 100);
  const coveragePercent = Math.round((touched.length / 25) * 100);
  const primaryScore = Math.round(average * MAX_PRIMARY_SCORE);
  const predictedMark = primaryScore >= 22 ? 5 : primaryScore >= 15 ? 4 : primaryScore >= 8 ? 3 : 2;
  return {
    weak,
    coveragePercent,
    masteryPercent,
    progress: masteryPercent,
    primaryScore,
    predictedMark,
    scoreFormulaVersion: SCORE_FORMULA_VERSION,
  };
}
