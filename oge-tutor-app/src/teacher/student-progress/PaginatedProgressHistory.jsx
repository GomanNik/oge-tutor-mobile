import React, { useCallback, useState } from 'react';
import { progressCoverageLabel, progressMasteryLabel, progressSourceLabel } from '../../domain/progress/index.js';
import { formatDateTimeLabel } from '../../shared/dateTime.js';
import { Button, EmptyState, Field, RowCard, SelectField } from '../../shared/ui.jsx';
import { PaginationControls } from '../../shared/PaginationControls.jsx';
import { usePagedRead } from '../../shared/usePagedRead.js';

export function PaginatedProgressHistory({ student, actions, taskNumber, revision = '' }) {
  const [draft, setDraft] = useState({ taskNumber: taskNumber || '', from: '', to: '' });
  const [filters, setFilters] = useState({ taskNumber: taskNumber || '' });
  const reader = useCallback((query) => actions.progressHistory(student.id, query), [actions, student.id]);
  const fallback = (student.progressByTask || []).flatMap((task) => (task.history || []).map((event) => ({ ...event, taskNumber: task.taskNumber })))
    .filter((event) => (!filters.taskNumber || event.taskNumber === Number(filters.taskNumber))
      && (!filters.from || event.createdAt >= filters.from) && (!filters.to || event.createdAt <= filters.to))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const page = usePagedRead(actions.progressHistory ? reader : null, { ...filters, ...(taskNumber ? { taskNumber } : {}) }, { fallback, revision });
  const invalidRange = draft.from && draft.to && draft.from > draft.to;

  function applyFilters(event) {
    event.preventDefault();
    if (invalidRange) return;
    setFilters({
      taskNumber: draft.taskNumber,
      from: draft.from ? new Date(`${draft.from}T00:00:00`).toISOString() : '',
      to: draft.to ? new Date(`${draft.to}T23:59:59.999`).toISOString() : '',
    });
  }

  return (
    <div className="progress-history-panel">
      <form className="history-filters" onSubmit={applyFilters}>
        {!taskNumber ? <SelectField label="Задание" value={draft.taskNumber} onChange={(value) => setDraft({ ...draft, taskNumber: value })} options={[
          { value: '', label: 'Все задания' },
          ...Array.from({ length: 25 }, (_, index) => ({ value: String(index + 1), label: `Задание ${index + 1}` })),
        ]} /> : null}
        <Field label="С даты" type="date" value={draft.from} onChange={(from) => setDraft({ ...draft, from })} />
        <Field label="По дату" type="date" value={draft.to} onChange={(to) => setDraft({ ...draft, to })} />
        <Button type="submit" variant="light" disabled={Boolean(invalidRange)}>Применить</Button>
      </form>
      {invalidRange ? <div className="inline-error" role="alert">Дата начала должна быть не позже даты окончания.</div> : null}
      {page.items.map((event) => (
        <RowCard key={event.id} icon={event.taskNumber} iconTone="blue"
          title={`Задание ${event.taskNumber}: ${progressCoverageLabel(event.coverageStatus)}${event.masteryLevel ? ` · ${progressMasteryLabel(event.masteryLevel)}` : ''}`}
          subtitle={[formatDateTimeLabel(event.createdAt), progressSourceLabel(event.source), event.comment].filter(Boolean).join(' · ')} />
      ))}
      {!page.loading && !page.error && !page.items.length ? <EmptyState title="Изменений прогресса нет" text="За выбранный период записи не найдены." /> : null}
      <PaginationControls pagination={page} count={page.items.length} onLoadMore={page.loadMore} />
    </div>
  );
}
