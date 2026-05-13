/*
 * OGE Tutor App — shared progress contract values.
 * These constants are dependency-neutral: API, domain and UI can import them without circular dependencies.
 */
export const PROGRESS_COVERAGE_STATUS = Object.freeze({
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  ASSESSMENT_NEEDED: 'assessment_needed',
  ASSESSED: 'assessed',
});

export const PROGRESS_MASTERY_LEVEL = Object.freeze({
  WEAK: 'weak',
  MEDIUM: 'medium',
  GOOD: 'good',
  STRONG: 'strong',
});

export const PROGRESS_SOURCE = Object.freeze({
  MANUAL: 'manual',
  LESSON_COMPLETED: 'lesson_completed',
  HOMEWORK_RESULT: 'homework_result',
  DIAGNOSTIC: 'diagnostic',
  IMPORT: 'import',
});

export const PROGRESS_LEVEL = Object.freeze({
  WEAK: PROGRESS_MASTERY_LEVEL.WEAK,
  MID: PROGRESS_MASTERY_LEVEL.MEDIUM,
  MEDIUM: PROGRESS_MASTERY_LEVEL.MEDIUM,
  GOOD: PROGRESS_MASTERY_LEVEL.GOOD,
  HIGH: PROGRESS_MASTERY_LEVEL.STRONG,
  STRONG: PROGRESS_MASTERY_LEVEL.STRONG,
});
