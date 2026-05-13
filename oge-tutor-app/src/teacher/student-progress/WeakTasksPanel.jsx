/*
 * OGE Tutor App — weak tasks panel.
 * Weak tasks are derived from assessed progress entries with masteryLevel=weak.
 */
import React from 'react';
import { Card, RowCard, Section } from '../../shared/ui.jsx';

export function WeakTasksPanel({ tasks, homeworks, materials, onOpenTask }) {
  return (
    <>
      <Section title="Слабые задания" />
      {tasks.length ? tasks.map((task) => {
        const hasHomework = homeworks.some((hw) => (hw.taskNumbers || []).includes(task.taskNumber));
        const hasMaterials = materials.some((topic) => Number(topic.taskNumber) === task.taskNumber);
        return (
          <RowCard
            key={task.taskNumber}
            icon={task.taskNumber}
            iconTone="red"
            title={`Задание ${task.taskNumber}: ${task.title}`}
            subtitle={`${hasHomework ? 'есть ДЗ' : 'нет ДЗ'} · ${hasMaterials ? 'есть материалы' : 'нет материалов'}${task.teacherComment ? ` · ${task.teacherComment}` : ''}`}
            onClick={() => onOpenTask(task.taskNumber)}
          />
        );
      }) : <Card><strong>Слабых заданий нет.</strong><p className="subtitle">Слабыми считаются только пройденные и оценённые задания с уровнем «слабое».</p></Card>}
    </>
  );
}
