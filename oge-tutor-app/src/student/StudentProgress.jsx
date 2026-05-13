/*
 * OGE Tutor App — student progress screens.
 * Students see read-only coverage and mastery; not-started tasks remain neutral gray.
 */
import React from 'react';
import { TASKS } from '../domain/tasks/index.js';
import { getStudentProgressView, progressCoverageLabel, progressMasteryLabel } from '../domain/progress/index.js';
import { statusLabel } from '../api/contracts.js';
import { formatDateLabel } from '../shared/dateTime.js';
import { Badge, Card, EmptyState, Header, RowCard, Section, iconByStatus, toneByStatus } from '../shared/ui.jsx';
import { ProgressSummary, TaskHeatMap } from '../shared/progress.jsx';

export function StudentProgress({ student, homeworks: _homeworks, materials: _materials, openWeakTask }) {
  const progress = getStudentProgressView(student);
  const weakTasks = progress.weakTasks
    .map((item) => TASKS.find((task) => task.n === item.taskNumber))
    .filter(Boolean);

  return (
    <>
      <Header title="Прогресс" subtitle="Покрытие программы, освоение изученного и слабые номера" />
      <ProgressSummary {...progress} weakCount={progress.weak.length} />
      <Section title="Карта заданий" />
      <Card className="form-stack">
        <TaskHeatMap student={student} />
        <div className="progress-legend progress-legend-wide">
          <span className="progress-legend-item level-not-started">не проходили</span>
          <span className="progress-legend-item level-in-progress">в работе</span>
          <span className="progress-legend-item level-assessment-needed">требует оценки</span>
          <span className="progress-legend-item level-weak">слабое</span>
          <span className="progress-legend-item level-medium">среднее</span>
          <span className="progress-legend-item level-good">хорошее</span>
          <span className="progress-legend-item level-strong">уверенное</span>
        </div>
      </Card>
      <Section title="Что означает карта" />
      <Card><p className="subtitle">Серые задания ещё не проходили и не ухудшают процент освоения. Слабые задания появляются только после оценки преподавателем.</p></Card>
      <Section title="Слабые задания" />
      {weakTasks.length ? weakTasks.map((task) => (
        <RowCard key={task.n} icon={task.n} iconTone="red" title={task.title} subtitle="Открыть ДЗ, материалы и рекомендации" onClick={() => openWeakTask(task.n)} />
      )) : <EmptyState title="Слабых заданий нет" text="Сейчас среди оценённых заданий нет уровня «слабое»." />}
    </>
  );
}

export function WeakTaskDetail({ taskNumber, student, homeworks, materials, onBack, openHomework, openMaterial }) {
  const task = TASKS.find((item) => item.n === taskNumber);
  const progress = getStudentProgressView(student).progressByTaskMap[taskNumber];
  const linkedHw = homeworks.filter((hw) => hw.taskNumbers.includes(taskNumber));
  const material = materials.find((item) => item.taskNumber === taskNumber);
  return (
    <>
      <Header title={`Задание ${taskNumber}`} subtitle={task?.title} onBack={onBack} right={<Badge tone={progress?.masteryLevel === 'weak' ? 'red' : 'blue'}>{progressCoverageLabel(progress?.coverageStatus)}</Badge>} />
      <Card className="form-stack">
        <strong>Состояние задания</strong>
        <p className="subtitle">{progressCoverageLabel(progress?.coverageStatus)}{progress?.masteryLevel ? ` · ${progressMasteryLabel(progress.masteryLevel)}` : ''}</p>
        {progress?.teacherComment ? <p className="subtitle">Комментарий: {progress.teacherComment}</p> : null}
        {progress?.recommendedAction ? <p className="subtitle">Рекомендация: {progress.recommendedAction}</p> : null}
      </Card>
      <Section title="Домашние задания" />
      {linkedHw.length ? linkedHw.map((hw) => <RowCard key={hw.id} icon={iconByStatus(hw.status)} iconTone={toneByStatus(hw.status)} title={hw.title} subtitle={`${statusLabel(hw.status)} · ${formatDateLabel(hw.dueAt || hw.deadline)}`} onClick={() => openHomework(hw.id)} />) : <EmptyState title="ДЗ нет" text="По этому заданию пока нет отдельной домашки." />}
      <Section title="Материалы" />
      {material ? <RowCard icon={material.taskNumber} iconTone="blue" title={material.title} subtitle={`${material.files.length} материала`} onClick={() => openMaterial(material.id)} /> : <EmptyState title="Материалов нет" text="Материалы по этому номеру пока не добавлены." />}
    </>
  );
}
