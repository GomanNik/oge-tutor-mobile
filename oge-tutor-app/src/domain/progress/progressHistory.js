/*
 * OGE Tutor App — progress history helpers.
 * Every meaningful progress change is stored as an event for auditability and backend sync.
 */
import { nowIso, normalizeIsoDateTime } from '../../shared/dateTime.js';
import { PROGRESS_COVERAGE_STATUS, PROGRESS_SOURCE } from './progressContracts.js';

const EVENT_TYPE = Object.freeze({
  LESSON_COMPLETED: 'lesson_completed',
  MANUAL_ASSESSMENT: 'manual_assessment',
  MANUAL_STATUS_CHANGE: 'manual_status_change',
});

function normalizeText(value) {
  return String(value || '').trim();
}

function createId(prefix = 'progress-event') {
  const random = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

export { EVENT_TYPE as PROGRESS_EVENT_TYPE };

export function normalizeProgressHistoryEvent(event = {}) {
  return {
    id: event.id || createId(),
    type: event.type || EVENT_TYPE.MANUAL_STATUS_CHANGE,
    source: event.source || PROGRESS_SOURCE.MANUAL,
    taskNumber: Number(event.taskNumber) || null,
    lessonId: event.lessonId || '',
    coverageStatus: event.coverageStatus || event.statusAfterLesson || PROGRESS_COVERAGE_STATUS.IN_PROGRESS,
    masteryLevel: event.masteryLevel || event.level || null,
    comment: normalizeText(event.comment),
    createdAt: normalizeIsoDateTime(event.createdAt) || nowIso(),
  };
}

export function createLessonCompletedProgressEvent({ taskNumber, lessonId, comment, createdAt }) {
  return normalizeProgressHistoryEvent({
    type: EVENT_TYPE.LESSON_COMPLETED,
    source: PROGRESS_SOURCE.LESSON_COMPLETED,
    taskNumber,
    lessonId,
    coverageStatus: PROGRESS_COVERAGE_STATUS.ASSESSMENT_NEEDED,
    masteryLevel: null,
    comment,
    createdAt,
  });
}

export function createManualAssessmentProgressEvent({ taskNumber, coverageStatus, masteryLevel, comment, createdAt }) {
  return normalizeProgressHistoryEvent({
    type: masteryLevel ? EVENT_TYPE.MANUAL_ASSESSMENT : EVENT_TYPE.MANUAL_STATUS_CHANGE,
    source: PROGRESS_SOURCE.MANUAL,
    taskNumber,
    coverageStatus,
    masteryLevel: masteryLevel || null,
    comment,
    createdAt,
  });
}

export function appendProgressEvent(history = [], event) {
  return [...(Array.isArray(history) ? history : []), normalizeProgressHistoryEvent(event)];
}

export function latestProgressEvent(history = []) {
  const normalized = (Array.isArray(history) ? history : []).map(normalizeProgressHistoryEvent);
  return normalized.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] || null;
}
