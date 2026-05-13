/*
 * OGE Tutor App — progress domain contracts.
 * Progress separates coverage (whether a task was studied) from mastery (how well it is mastered).
 */
import {
  PROGRESS_COVERAGE_STATUS,
  PROGRESS_MASTERY_LEVEL,
  PROGRESS_SOURCE,
} from '../../shared/progressContracts.js';

export { PROGRESS_COVERAGE_STATUS, PROGRESS_MASTERY_LEVEL, PROGRESS_SOURCE };

export const PROGRESS_COVERAGE_ORDER = Object.freeze([
  PROGRESS_COVERAGE_STATUS.NOT_STARTED,
  PROGRESS_COVERAGE_STATUS.IN_PROGRESS,
  PROGRESS_COVERAGE_STATUS.ASSESSMENT_NEEDED,
  PROGRESS_COVERAGE_STATUS.ASSESSED,
]);

export const PROGRESS_MASTERY_ORDER = Object.freeze([
  PROGRESS_MASTERY_LEVEL.WEAK,
  PROGRESS_MASTERY_LEVEL.MEDIUM,
  PROGRESS_MASTERY_LEVEL.GOOD,
  PROGRESS_MASTERY_LEVEL.STRONG,
]);

export const PROGRESS_COVERAGE_LABELS = Object.freeze({
  [PROGRESS_COVERAGE_STATUS.NOT_STARTED]: 'не проходили',
  [PROGRESS_COVERAGE_STATUS.IN_PROGRESS]: 'в работе',
  [PROGRESS_COVERAGE_STATUS.ASSESSMENT_NEEDED]: 'требует оценки',
  [PROGRESS_COVERAGE_STATUS.ASSESSED]: 'оценено',
});

export const PROGRESS_MASTERY_LABELS = Object.freeze({
  [PROGRESS_MASTERY_LEVEL.WEAK]: 'слабое',
  [PROGRESS_MASTERY_LEVEL.MEDIUM]: 'среднее',
  [PROGRESS_MASTERY_LEVEL.GOOD]: 'хорошее',
  [PROGRESS_MASTERY_LEVEL.STRONG]: 'уверенное',
});

export const PROGRESS_SOURCE_LABELS = Object.freeze({
  [PROGRESS_SOURCE.MANUAL]: 'ручная оценка',
  [PROGRESS_SOURCE.LESSON_COMPLETED]: 'после урока',
  [PROGRESS_SOURCE.HOMEWORK_RESULT]: 'по домашней работе',
  [PROGRESS_SOURCE.DIAGNOSTIC]: 'по диагностике',
  [PROGRESS_SOURCE.IMPORT]: 'импорт',
});

export function progressCoverageLabel(status) {
  return PROGRESS_COVERAGE_LABELS[status] || PROGRESS_COVERAGE_LABELS[PROGRESS_COVERAGE_STATUS.NOT_STARTED];
}

export function progressMasteryLabel(level) {
  return level ? PROGRESS_MASTERY_LABELS[level] || String(level) : 'уровень не выставлен';
}

export function progressSourceLabel(source) {
  return PROGRESS_SOURCE_LABELS[source] || PROGRESS_SOURCE_LABELS[PROGRESS_SOURCE.MANUAL];
}
