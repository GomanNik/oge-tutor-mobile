/*
 * OGE Tutor App — teacher task heat map.
 * The map opens task diagnostics; color is a state indicator, not a direct toggle.
 */
import React from 'react';
import { TASKS } from '../../domain/tasks/index.js';
import { progressCoverageLabel, progressMasteryLabel, progressTaskTone } from '../../domain/progress/index.js';
import { cx } from '../../shared/ui.jsx';

export function StudentProgressHeatmap({ summary, selectedTaskNumber, onSelectTask }) {
  return (
    <div className="heat-map heat-map-editable">
      {TASKS.map((task) => {
        const progress = summary.progressByTaskMap[task.n];
        const tone = progressTaskTone(progress);
        const title = `${task.n}. ${task.title} — ${progressCoverageLabel(progress.coverageStatus)}${progress.masteryLevel ? `, ${progressMasteryLabel(progress.masteryLevel)}` : ''}`;
        return (
          <button
            key={task.n}
            type="button"
            className={cx('heat-cell', 'heat-cell-editable', `level-${tone}`, selectedTaskNumber === task.n && 'active')}
            title={title}
            aria-label={title}
            onClick={() => onSelectTask(task.n)}
          >
            {task.n}
          </button>
        );
      })}
    </div>
  );
}
