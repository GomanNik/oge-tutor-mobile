/*
 * OGE Tutor App — task progress history.
 * Shows why a progress state changed instead of hiding progress behind a color square.
 */
import React from 'react';
import { progressCoverageLabel, progressMasteryLabel, progressSourceLabel } from '../../domain/progress/index.js';
import { formatDateTimeLabel } from '../../shared/dateTime.js';

export function ProgressHistory({ history = [] }) {
  if (!history.length) return <p className="subtitle">История по этому заданию пока не накоплена.</p>;

  return (
    <div className="progress-history-list">
      {[...history].reverse().map((event) => (
        <div className="progress-history-item" key={event.id}>
          <div className="progress-history-main">
            <strong>{progressSourceLabel(event.source)}</strong>
            <span>{formatDateTimeLabel(event.createdAt)}</span>
          </div>
          <p className="subtitle">
            {progressCoverageLabel(event.coverageStatus)}{event.masteryLevel ? ` · ${progressMasteryLabel(event.masteryLevel)}` : ''}{event.lessonId ? ` · урок ${event.lessonId}` : ''}
          </p>
          {event.comment ? <p className="subtitle">{event.comment}</p> : null}
        </div>
      ))}
    </div>
  );
}
