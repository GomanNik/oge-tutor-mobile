/*
 * OGE Tutor App — teacher panel with progress assessments required after completed lessons.
 */
import React from 'react';
import { formatDateLabel } from '../../shared/dateTime.js';
import { Card, RowCard, Section } from '../../shared/ui.jsx';

export function AssessmentRequiredPanel({ tasks, onOpenTask }) {
  return (
    <>
      <Section title="Требуется оценка после занятия" />
      {tasks.length ? tasks.map((task) => (
        <RowCard
          key={task.taskNumber}
          icon={task.taskNumber}
          iconTone="amber"
          title={`Задание ${task.taskNumber}: ${task.title}`}
          subtitle={`Занятий по номеру: ${task.lessonCount || 0}${task.lastActivityAt ? ` · последнее ${formatDateLabel(task.lastActivityAt)}` : ''}`}
          onClick={() => onOpenTask(task.taskNumber)}
        />
      )) : <Card><strong>Неоценённых заданий нет.</strong><p className="subtitle">После завершения урока с указанными номерами здесь появится задача на оценку освоения.</p></Card>}
    </>
  );
}
