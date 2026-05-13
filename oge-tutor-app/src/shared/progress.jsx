/*
 * OGE Tutor App — shared progress widgets.
 * The heat map is a diagnostic navigator: it opens task details and never changes mastery by raw color click.
 */
import React from 'react';
import { TASKS } from '../domain/tasks/index.js';
import {
  getStudentProgressView,
  progressCoverageLabel,
  progressMasteryLabel,
  progressTaskTone,
} from '../domain/progress/index.js';
import { Card, RowCard, cx } from './ui.jsx';

export function ProgressSummary({ progress, predictedMark, primaryScore, coveragePercent, coverageCount, totalTasks, assessmentNeededCount, weakCount }) {
  return (
    <div className="metric-grid">
      <Card><p className="metric-title">Освоение изученного</p><p className="metric-value">{progress}%</p></Card>
      <Card><p className="metric-title">Покрытие программы</p><p className="metric-value">{coveragePercent ?? 0}%</p><p className="metric-subtitle">{coverageCount ?? 0}/{totalTasks ?? TASKS.length}</p></Card>
      <Card><p className="metric-title">Требуют оценки</p><p className="metric-value">{assessmentNeededCount ?? 0}</p></Card>
      <Card><p className="metric-title">Слабые</p><p className="metric-value">{weakCount ?? 0}</p></Card>
      <Card><p className="metric-title">Оценка</p><p className="metric-value">{predictedMark}</p></Card>
      {typeof primaryScore !== 'undefined' ? <Card><p className="metric-title">Баллы</p><p className="metric-value">{primaryScore}/31</p></Card> : null}
    </div>
  );
}

export function StudentProgressSummary({ student }) {
  const summary = getStudentProgressView(student);
  return <ProgressSummary {...summary} weakCount={summary.weak.length} />;
}

export function TaskHeatMap({ student, progressByTask, activeTaskNumber = null, onTaskClick }) {
  const summary = student ? getStudentProgressView(student) : getStudentProgressView({ progressByTask });
  const map = summary.progressByTaskMap;

  return (
    <div className={cx('heat-map', onTaskClick && 'heat-map-editable')}>
      {TASKS.map((task) => {
        const progress = map[task.n];
        const tone = progressTaskTone(progress);
        const title = `${task.n}. ${task.title} — ${progressCoverageLabel(progress.coverageStatus)}${progress.masteryLevel ? `, ${progressMasteryLabel(progress.masteryLevel)}` : ''}`;
        const className = cx('heat-cell', `level-${tone}`, onTaskClick && 'heat-cell-editable', activeTaskNumber === task.n && 'active');

        if (onTaskClick) {
          return (
            <button key={task.n} type="button" className={className} title={title} aria-label={title} onClick={() => onTaskClick(task.n)}>
              {task.n}
            </button>
          );
        }

        return <div key={task.n} className={className} title={title}>{task.n}</div>;
      })}
    </div>
  );
}

export function WeakTaskList({ student, weak = [], onOpen }) {
  const summary = student ? getStudentProgressView(student) : getStudentProgressView({ progressByTask: weak.map((taskNumber) => ({ taskNumber, masteryLevel: 'weak', coverageStatus: 'assessed' })) });

  return summary.weakTasks
    .map((taskProgress) => TASKS.find((task) => task.n === taskProgress.taskNumber))
    .filter(Boolean)
    .map((task) => <RowCard key={task.n} icon={task.n} iconTone="red" title={task.title} subtitle="Открыть ДЗ, материалы и рекомендации" onClick={() => onOpen?.(task.n)} />);
}
