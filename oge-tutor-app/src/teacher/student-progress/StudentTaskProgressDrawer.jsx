/*
 * OGE Tutor App — task progress editor.
 * Teacher edits coverage/mastery deliberately; clicking the heat map only opens this panel.
 */
import React, { useEffect, useState } from 'react';
import {
  PROGRESS_COVERAGE_STATUS,
  PROGRESS_MASTERY_LEVEL,
  progressCoverageLabel,
  progressMasteryLabel,
  progressSourceLabel,
} from '../../domain/progress/index.js';
import { formatDateLabel, formatDateTimeLabel } from '../../shared/dateTime.js';
import { Badge, Button, Card, Section, TextArea, cx } from '../../shared/ui.jsx';
import { ProgressHistory } from './ProgressHistory.jsx';

const COVERAGE_OPTIONS = [
  { value: PROGRESS_COVERAGE_STATUS.NOT_STARTED, label: 'Не проходили' },
  { value: PROGRESS_COVERAGE_STATUS.IN_PROGRESS, label: 'В работе' },
  { value: PROGRESS_COVERAGE_STATUS.ASSESSMENT_NEEDED, label: 'Требует оценки' },
];

const MASTERY_OPTIONS = [
  { value: PROGRESS_MASTERY_LEVEL.WEAK, label: 'Слабое' },
  { value: PROGRESS_MASTERY_LEVEL.MEDIUM, label: 'Среднее' },
  { value: PROGRESS_MASTERY_LEVEL.GOOD, label: 'Хорошее' },
  { value: PROGRESS_MASTERY_LEVEL.STRONG, label: 'Уверенное' },
];

function statusTone(progress) {
  if (progress.coverageStatus === PROGRESS_COVERAGE_STATUS.ASSESSMENT_NEEDED) return 'amber';
  if (progress.coverageStatus === PROGRESS_COVERAGE_STATUS.NOT_STARTED) return 'slate';
  if (progress.masteryLevel === PROGRESS_MASTERY_LEVEL.WEAK) return 'red';
  if (progress.masteryLevel) return 'green';
  return 'blue';
}

export function StudentTaskProgressDrawer({ student, progress, onSave, isSaving }) {
  const [coverageStatus, setCoverageStatus] = useState(progress.coverageStatus);
  const [masteryLevel, setMasteryLevel] = useState(progress.masteryLevel || '');
  const [teacherComment, setTeacherComment] = useState(progress.teacherComment || '');
  const [recommendedAction, setRecommendedAction] = useState(progress.recommendedAction || '');
  const [error, setError] = useState('');

  useEffect(() => {
    setCoverageStatus(progress.coverageStatus);
    setMasteryLevel(progress.masteryLevel || '');
    setTeacherComment(progress.teacherComment || '');
    setRecommendedAction(progress.recommendedAction || '');
    setError('');
  }, [progress.taskNumber, progress.coverageStatus, progress.masteryLevel, progress.teacherComment, progress.recommendedAction]);

  const isAssessmentMode = Boolean(masteryLevel);
  const nextCoverageStatus = isAssessmentMode ? PROGRESS_COVERAGE_STATUS.ASSESSED : coverageStatus;
  const canSave = nextCoverageStatus !== PROGRESS_COVERAGE_STATUS.ASSESSED || masteryLevel;

  async function submit() {
    if (!canSave) {
      setError('Для статуса «оценено» нужно выбрать уровень освоения.');
      return;
    }

    try {
      setError('');
      await onSave(progress.taskNumber, {
        coverageStatus: nextCoverageStatus,
        masteryLevel: masteryLevel || null,
        teacherComment,
        recommendedAction,
      });
    } catch (err) {
      setError(err?.message || 'Не удалось сохранить прогресс задания.');
    }
  }

  return (
    <Card className="form-stack task-progress-drawer">
      <div className="task-progress-header">
        <div>
          <strong>Задание {progress.taskNumber}. {progress.title}</strong>
          <p className="subtitle">{student.name} · {progressCoverageLabel(progress.coverageStatus)}{progress.masteryLevel ? ` · ${progressMasteryLabel(progress.masteryLevel)}` : ''}</p>
        </div>
        <Badge tone={statusTone(progress)}>{progressCoverageLabel(progress.coverageStatus)}</Badge>
      </div>

      <div className="task-progress-facts">
        <div><span>Занятий по номеру</span><strong>{progress.lessonCount || 0}</strong></div>
        <div><span>Источник</span><strong>{progressSourceLabel(progress.source)}</strong></div>
        <div><span>Последняя активность</span><strong>{progress.lastActivityAt ? formatDateLabel(progress.lastActivityAt) : 'нет'}</strong></div>
        <div><span>Последняя оценка</span><strong>{progress.lastAssessedAt ? `${formatDateTimeLabel(progress.lastAssessedAt)}${progress.lastAssessedMasteryLevel ? ` · ${progressMasteryLabel(progress.lastAssessedMasteryLevel)}` : ''}` : 'нет'}</strong></div>
      </div>

      {progress.coverageStatus === PROGRESS_COVERAGE_STATUS.ASSESSMENT_NEEDED && progress.lastAssessedMasteryLevel ? (
        <div className="inline-note warning">Ранее было: {progressMasteryLabel(progress.lastAssessedMasteryLevel)}. После нового урока нужна переоценка.</div>
      ) : null}

      <div>
        <strong>Статус прохождения</strong>
        <p className="subtitle">Для непройденных заданий уровень не выставляется и они не считаются слабыми.</p>
        <div className="segmented-grid">
          {COVERAGE_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.value}
              className={cx('segmented-btn', coverageStatus === option.value && !masteryLevel && 'active')}
              onClick={() => { setCoverageStatus(option.value); setMasteryLevel(''); }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <strong>Уровень освоения</strong>
        <p className="subtitle">Выбор уровня автоматически переводит задание в статус «оценено».</p>
        <div className="mastery-grid">
          {MASTERY_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.value}
              className={cx('mastery-btn', `level-${option.value}`, masteryLevel === option.value && 'active')}
              onClick={() => setMasteryLevel(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <TextArea label="Комментарий преподавателя" value={teacherComment} onChange={setTeacherComment} placeholder="Например: путает перенос слагаемых, нужны короткие тренировки" />
      <TextArea label="Рекомендованное действие" value={recommendedAction} onChange={setRecommendedAction} placeholder="Например: назначить 5 задач на закрепление" />

      {error ? <div className="inline-error">{error}</div> : null}
      <Button onClick={submit} disabled={isSaving || !canSave}>{isSaving ? 'Сохраняем…' : 'Сохранить оценку задания'}</Button>

      <Section title="История изменений" />
      <ProgressHistory history={progress.history} />
    </Card>
  );
}
