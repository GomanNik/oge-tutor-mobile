/*
 * OGE Tutor App — student progress domain model.
 * A task can be not started, in work, waiting for teacher assessment, or assessed with mastery level.
 */
import { TASKS, getTaskTitle } from '../tasks/index.js';
import { nowIso, normalizeIsoDateTime } from '../../shared/dateTime.js';
import {
  PROGRESS_COVERAGE_ORDER,
  PROGRESS_COVERAGE_STATUS,
  PROGRESS_MASTERY_LABELS,
  PROGRESS_MASTERY_LEVEL,
  PROGRESS_MASTERY_ORDER,
  PROGRESS_SOURCE,
  progressCoverageLabel,
  progressMasteryLabel,
  progressSourceLabel,
} from './progressContracts.js';
import {
  appendProgressEvent,
  createLessonCompletedProgressEvent,
  createManualAssessmentProgressEvent,
  normalizeProgressHistoryEvent,
} from './progressHistory.js';

export const PROGRESS_LEVEL_ORDER = PROGRESS_MASTERY_ORDER;
export const PROGRESS_LEVEL_LABELS = PROGRESS_MASTERY_LABELS;

export const PROGRESS_SCORE_FORMULA_VERSION = 'oge-progress-v1';
const MAX_PRIMARY_SCORE = 31;

const MASTERY_SCORE = Object.freeze({
  [PROGRESS_MASTERY_LEVEL.WEAK]: 0.25,
  [PROGRESS_MASTERY_LEVEL.MEDIUM]: 0.55,
  [PROGRESS_MASTERY_LEVEL.GOOD]: 0.8,
  [PROGRESS_MASTERY_LEVEL.STRONG]: 1,
});

function toTaskNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function knownTaskNumber(value) {
  const number = toTaskNumber(value);
  return TASKS.some((task) => task.n === number) ? number : null;
}

function percentage(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

export function normalizeCoverageStatus(status) {
  return PROGRESS_COVERAGE_ORDER.includes(status) ? status : PROGRESS_COVERAGE_STATUS.NOT_STARTED;
}

export function normalizeMasteryLevel(level) {
  if (!level) return null;
  return Object.values(PROGRESS_MASTERY_LEVEL).includes(level) ? level : null;
}

export function progressLevelLabel(level) {
  return progressMasteryLabel(normalizeMasteryLevel(level));
}

export function nextProgressLevel(level) {
  const normalized = normalizeMasteryLevel(level) || PROGRESS_MASTERY_LEVEL.WEAK;
  const index = PROGRESS_MASTERY_ORDER.indexOf(normalized);
  return PROGRESS_MASTERY_ORDER[(index + 1) % PROGRESS_MASTERY_ORDER.length];
}

export function createNotStartedProgressEntry(taskNumber) {
  return {
    taskNumber,
    taskTitle: getTaskTitle(taskNumber),
    coverageStatus: PROGRESS_COVERAGE_STATUS.NOT_STARTED,
    masteryLevel: null,
    lessonCount: 0,
    lastLessonId: '',
    lastActivityAt: '',
    lastAssessedAt: '',
    lastAssessedMasteryLevel: null,
    source: PROGRESS_SOURCE.MANUAL,
    teacherComment: '',
    recommendedAction: '',
    history: [],
  };
}

export function normalizeProgressEntry(raw = {}, fallbackTaskNumber = null) {
  const taskNumber = knownTaskNumber(raw.taskNumber ?? raw.n ?? fallbackTaskNumber);
  if (!taskNumber) return null;

  const legacyLevel = normalizeMasteryLevel(raw.masteryLevel || raw.level);
  const explicitStatus = normalizeCoverageStatus(raw.coverageStatus || raw.status);
  const coverageStatus = raw.coverageStatus || raw.status
    ? explicitStatus
    : (legacyLevel ? PROGRESS_COVERAGE_STATUS.ASSESSED : PROGRESS_COVERAGE_STATUS.NOT_STARTED);
  const masteryLevel = coverageStatus === PROGRESS_COVERAGE_STATUS.ASSESSED ? legacyLevel : null;
  const history = (raw.history || []).map((event) => normalizeProgressHistoryEvent({ ...event, taskNumber })).filter(Boolean);
  const lessonCount = Math.max(0, Number(raw.lessonCount || history.filter((event) => event.source === PROGRESS_SOURCE.LESSON_COMPLETED).length || 0));

  return {
    ...createNotStartedProgressEntry(taskNumber),
    ...raw,
    taskNumber,
    taskTitle: getTaskTitle(taskNumber),
    coverageStatus,
    masteryLevel,
    lessonCount,
    lastLessonId: normalizeText(raw.lastLessonId),
    lastActivityAt: normalizeIsoDateTime(raw.lastActivityAt) || '',
    lastAssessedAt: normalizeIsoDateTime(raw.lastAssessedAt) || '',
    lastAssessedMasteryLevel: normalizeMasteryLevel(raw.lastAssessedMasteryLevel) || (legacyLevel && coverageStatus === PROGRESS_COVERAGE_STATUS.ASSESSED ? legacyLevel : null),
    source: Object.values(PROGRESS_SOURCE).includes(raw.source) ? raw.source : PROGRESS_SOURCE.MANUAL,
    teacherComment: normalizeText(raw.teacherComment),
    recommendedAction: normalizeText(raw.recommendedAction),
    history,
  };
}

export function buildProgressByTask(progressByTask, weak = []) {
  const byTask = new Map();

  if (Array.isArray(progressByTask)) {
    progressByTask.forEach((item) => {
      const normalized = normalizeProgressEntry(item);
      if (normalized) byTask.set(normalized.taskNumber, normalized);
    });
  } else if (progressByTask && typeof progressByTask === 'object') {
    Object.entries(progressByTask).forEach(([taskNumberRaw, value]) => {
      const taskNumber = knownTaskNumber(taskNumberRaw);
      if (!taskNumber) return;
      const normalized = typeof value === 'string'
        ? normalizeProgressEntry({ taskNumber, masteryLevel: value, coverageStatus: PROGRESS_COVERAGE_STATUS.ASSESSED })
        : normalizeProgressEntry({ ...value, taskNumber });
      if (normalized) byTask.set(taskNumber, normalized);
    });
  }

  (weak || []).map(knownTaskNumber).filter(Boolean).forEach((taskNumber) => {
    const current = byTask.get(taskNumber) || createNotStartedProgressEntry(taskNumber);
    byTask.set(taskNumber, {
      ...current,
      coverageStatus: PROGRESS_COVERAGE_STATUS.ASSESSED,
      masteryLevel: PROGRESS_MASTERY_LEVEL.WEAK,
      source: current.source || PROGRESS_SOURCE.MANUAL,
    });
  });

  return TASKS.map((task) => byTask.get(task.n) || createNotStartedProgressEntry(task.n));
}

export function progressMapFromEntries(progressByTask) {
  return buildProgressByTask(progressByTask).reduce((acc, item) => {
    acc[item.taskNumber] = item;
    return acc;
  }, {});
}

export function isTaskCovered(item) {
  return item?.coverageStatus && item.coverageStatus !== PROGRESS_COVERAGE_STATUS.NOT_STARTED;
}

export function isTaskAssessed(item) {
  return item?.coverageStatus === PROGRESS_COVERAGE_STATUS.ASSESSED && Boolean(item.masteryLevel);
}

export function isWeakTask(item) {
  return isTaskAssessed(item) && item.masteryLevel === PROGRESS_MASTERY_LEVEL.WEAK;
}

export function isAssessmentNeeded(item) {
  return item?.coverageStatus === PROGRESS_COVERAGE_STATUS.ASSESSMENT_NEEDED;
}

export function progressTaskTone(item) {
  if (!item || item.coverageStatus === PROGRESS_COVERAGE_STATUS.NOT_STARTED) return 'not-started';
  if (item.coverageStatus === PROGRESS_COVERAGE_STATUS.IN_PROGRESS) return 'in-progress';
  if (item.coverageStatus === PROGRESS_COVERAGE_STATUS.ASSESSMENT_NEEDED) return 'assessment-needed';
  return item.masteryLevel || 'not-started';
}

export function deriveProgressStats(progressByTask) {
  const entries = buildProgressByTask(progressByTask);
  const covered = entries.filter(isTaskCovered);
  const assessed = entries.filter(isTaskAssessed);
  const weak = entries.filter(isWeakTask);
  const assessmentNeeded = entries.filter(isAssessmentNeeded);
  const inProgress = entries.filter((item) => item.coverageStatus === PROGRESS_COVERAGE_STATUS.IN_PROGRESS);
  const notStarted = entries.filter((item) => item.coverageStatus === PROGRESS_COVERAGE_STATUS.NOT_STARTED);
  const masteryRatio = assessed.length
    ? assessed.reduce((sum, item) => sum + (MASTERY_SCORE[item.masteryLevel] || 0), 0) / assessed.length
    : 0;
  const masteryPercent = percentage(masteryRatio);
  const coveragePercent = percentage(covered.length / entries.length);
  const primaryScore = Math.round((masteryPercent / 100) * MAX_PRIMARY_SCORE);
  const predictedMark = primaryScore >= 25 ? 5 : primaryScore >= 18 ? 4 : primaryScore >= 8 ? 3 : 2;

  return {
    progressByTask: entries,
    progressByTaskMap: progressMapFromEntries(entries),
    masteryPercent,
    progress: masteryPercent,
    coveragePercent,
    coverageCount: covered.length,
    assessedCount: assessed.length,
    assessmentNeededCount: assessmentNeeded.length,
    inProgressCount: inProgress.length,
    notStartedCount: notStarted.length,
    totalTasks: entries.length,
    weak: weak.map((item) => item.taskNumber),
    weakTasks: weak,
    assessmentNeededTasks: assessmentNeeded,
    inProgressTasks: inProgress,
    notStartedTasks: notStarted,
    primaryScore,
    predictedMark,
    scoreFormulaVersion: PROGRESS_SCORE_FORMULA_VERSION,
  };
}

export function getStudentProgressView(student = {}) {
  return deriveProgressStats(student?.progressByTask || []);
}

export function normalizeStudentProgressPayload(payload = {}) {
  const progressByTask = buildProgressByTask(payload.progressByTask, payload.weak);
  const stats = deriveProgressStats(progressByTask);
  return {
    progressByTask,
    weak: stats.weak,
    progress: stats.progress,
    masteryPercent: stats.masteryPercent,
    coveragePercent: stats.coveragePercent,
    primaryScore: stats.primaryScore,
    predictedMark: stats.predictedMark,
    scoreFormulaVersion: stats.scoreFormulaVersion,
  };
}

export function updateTaskProgressEntry(progressByTask, taskNumber, patch = {}) {
  const normalizedTaskNumber = knownTaskNumber(taskNumber);
  if (!normalizedTaskNumber) return buildProgressByTask(progressByTask);
  const now = normalizeIsoDateTime(patch.updatedAt) || nowIso();
  const entries = buildProgressByTask(progressByTask);
  return entries.map((item) => {
    if (item.taskNumber !== normalizedTaskNumber) return item;

    const requestedStatus = patch.coverageStatus ? normalizeCoverageStatus(patch.coverageStatus) : item.coverageStatus;
    const requestedLevel = patch.masteryLevel !== undefined ? normalizeMasteryLevel(patch.masteryLevel) : item.masteryLevel;
    const coverageStatus = requestedLevel ? PROGRESS_COVERAGE_STATUS.ASSESSED : requestedStatus;
    const masteryLevel = coverageStatus === PROGRESS_COVERAGE_STATUS.ASSESSED ? requestedLevel : null;
    const event = createManualAssessmentProgressEvent({
      taskNumber: normalizedTaskNumber,
      coverageStatus,
      masteryLevel,
      comment: patch.teacherComment ?? item.teacherComment,
      createdAt: now,
    });

    return {
      ...item,
      coverageStatus,
      masteryLevel,
      teacherComment: patch.teacherComment === undefined ? item.teacherComment : normalizeText(patch.teacherComment),
      recommendedAction: patch.recommendedAction === undefined ? item.recommendedAction : normalizeText(patch.recommendedAction),
      source: patch.source || PROGRESS_SOURCE.MANUAL,
      lastActivityAt: now,
      lastAssessedAt: masteryLevel ? now : item.lastAssessedAt,
      lastAssessedMasteryLevel: masteryLevel || item.lastAssessedMasteryLevel || null,
      history: appendProgressEvent(item.history, event),
    };
  });
}

export function markTasksAssessmentNeeded(progressByTask, taskNumbers = [], lesson = {}, comment = '') {
  const normalizedTaskNumbers = [...new Set((taskNumbers || []).map(knownTaskNumber).filter(Boolean))];
  const completedAt = normalizeIsoDateTime(lesson.completedAt) || nowIso();
  const entries = buildProgressByTask(progressByTask);

  return entries.map((item) => {
    if (!normalizedTaskNumbers.includes(item.taskNumber)) return item;
    const event = createLessonCompletedProgressEvent({
      taskNumber: item.taskNumber,
      lessonId: lesson.id,
      comment,
      createdAt: completedAt,
    });

    return {
      ...item,
      coverageStatus: PROGRESS_COVERAGE_STATUS.ASSESSMENT_NEEDED,
      masteryLevel: null,
      lastAssessedMasteryLevel: item.masteryLevel || item.lastAssessedMasteryLevel || null,
      lessonCount: Number(item.lessonCount || 0) + 1,
      lastLessonId: lesson.id || item.lastLessonId,
      lastActivityAt: completedAt,
      source: PROGRESS_SOURCE.LESSON_COMPLETED,
      history: appendProgressEvent(item.history, event),
    };
  });
}

export function setTaskProgressLevel(progressByTask, taskNumber, level) {
  return updateTaskProgressEntry(progressByTask, taskNumber, { masteryLevel: level });
}

export { progressCoverageLabel, progressMasteryLabel, progressSourceLabel };
