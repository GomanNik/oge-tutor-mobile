/*
 * OGE Tutor App — teacher progress summary cards.
 * Coverage and mastery are separate so not-started tasks do not distort progress.
 */
import React from 'react';
import { Card } from '../../shared/ui.jsx';

export function ProgressCoverageSummary({ summary }) {
  return (
    <div className="metric-grid">
      <Card><p className="metric-title">Покрытие программы</p><p className="metric-value">{summary.coveragePercent}%</p><p className="metric-subtitle">{summary.coverageCount}/{summary.totalTasks} заданий</p></Card>
      <Card><p className="metric-title">Освоение изученного</p><p className="metric-value">{summary.masteryPercent}%</p><p className="metric-subtitle">по оценённым заданиям</p></Card>
      <Card><p className="metric-title">Слабые задания</p><p className="metric-value">{summary.weak.length}</p><p className="metric-subtitle">только assessed + weak</p></Card>
      <Card><p className="metric-title">Требуют оценки</p><p className="metric-value">{summary.assessmentNeededCount}</p><p className="metric-subtitle">после завершённых уроков</p></Card>
    </div>
  );
}
