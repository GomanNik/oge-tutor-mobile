/*
 * OGE Tutor App — teacher progress workspace inside a student card.
 * It turns the heat map into a real diagnostic tool with coverage, mastery, weak tasks and assessment queue.
 */
import React, { useMemo, useState } from 'react';
import {
  getStudentProgressView,
  selectAssessmentRequiredTasks,
  selectTaskProgress,
  selectWeakTasks,
} from '../../domain/progress/index.js';
import { Card, Section } from '../../shared/ui.jsx';
import { AssessmentRequiredPanel } from './AssessmentRequiredPanel.jsx';
import { ProgressCoverageSummary } from './ProgressCoverageSummary.jsx';
import { StudentProgressHeatmap } from './StudentProgressHeatmap.jsx';
import { StudentTaskProgressDrawer } from './StudentTaskProgressDrawer.jsx';
import { WeakTasksPanel } from './WeakTasksPanel.jsx';

export function StudentProgressTab({ student, data, actions }) {
  const summary = useMemo(() => getStudentProgressView(student), [student]);
  const assessmentTasks = useMemo(() => selectAssessmentRequiredTasks(student), [student]);
  const weakTasks = useMemo(() => selectWeakTasks(student), [student]);
  const [selectedTaskNumber, setSelectedTaskNumber] = useState(assessmentTasks[0]?.taskNumber || weakTasks[0]?.taskNumber || 1);
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const selectedProgress = selectTaskProgress(student, selectedTaskNumber);
  const homeworks = data.homeworks.filter((item) => item.studentId === student.id);

  async function saveTaskProgress(taskNumber, payload) {
    setIsSaving(true);
    setMessage('');
    try {
      await actions.updateTaskProgress(student.id, taskNumber, payload);
      setMessage(`Прогресс по заданию ${taskNumber} сохранён.`);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <Section title="Диагностика прогресса" />
      <ProgressCoverageSummary summary={summary} />

      <AssessmentRequiredPanel tasks={assessmentTasks} onOpenTask={setSelectedTaskNumber} />

      <Section title="Карта заданий" />
      <Card className="form-stack">
        <div>
          <strong>Тепловая карта заданий</strong>
          <p className="subtitle">Серый — ещё не проходили. Синий — в работе. Жёлтый — после урока нужно оценить. Красный/оранжевый/зелёный — уже выставленный уровень освоения.</p>
        </div>
        <StudentProgressHeatmap summary={summary} selectedTaskNumber={selectedTaskNumber} onSelectTask={setSelectedTaskNumber} />
        <div className="progress-legend progress-legend-wide">
          <span className="progress-legend-item level-not-started">не проходили</span>
          <span className="progress-legend-item level-in-progress">в работе</span>
          <span className="progress-legend-item level-assessment-needed">требует оценки</span>
          <span className="progress-legend-item level-weak">слабое</span>
          <span className="progress-legend-item level-medium">среднее</span>
          <span className="progress-legend-item level-good">хорошее</span>
          <span className="progress-legend-item level-strong">уверенное</span>
        </div>
        {message ? <div className="inline-note success">{message}</div> : null}
      </Card>

      <Section title="Карточка задания" />
      <StudentTaskProgressDrawer student={student} progress={selectedProgress} onSave={saveTaskProgress} isSaving={isSaving} />

      <WeakTasksPanel tasks={weakTasks} homeworks={homeworks} materials={data.materials} onOpenTask={setSelectedTaskNumber} />
    </>
  );
}
