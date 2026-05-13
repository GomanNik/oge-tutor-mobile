/*
 * OGE Tutor App — progress selectors.
 * Derived progress lists are computed from normalized task progress, not from hand-made weak arrays.
 */
import { getTaskByNumber } from '../tasks/index.js';
import { deriveProgressStats, progressCoverageLabel, progressMasteryLabel, progressSourceLabel } from './progressModel.js';

function withTaskMeta(item) {
  const task = getTaskByNumber(item.taskNumber);
  return {
    ...item,
    title: task?.title || item.taskTitle || `Задание ${item.taskNumber}`,
    coverageLabel: progressCoverageLabel(item.coverageStatus),
    masteryLabel: progressMasteryLabel(item.masteryLevel),
    sourceLabel: progressSourceLabel(item.source),
  };
}

export function selectStudentProgressSummary(student) {
  return deriveProgressStats(student?.progressByTask || []);
}

export function selectWeakTasks(student) {
  return selectStudentProgressSummary(student).weakTasks.map(withTaskMeta);
}

export function selectAssessmentRequiredTasks(student) {
  return selectStudentProgressSummary(student).assessmentNeededTasks.map(withTaskMeta);
}

export function selectNotStartedTasks(student) {
  return selectStudentProgressSummary(student).notStartedTasks.map(withTaskMeta);
}

export function selectTaskProgress(student, taskNumber) {
  return withTaskMeta(selectStudentProgressSummary(student).progressByTaskMap[Number(taskNumber)] || { taskNumber });
}
