import React from 'react';
import { Button } from './ui.jsx';

export function PaginationControls({ pagination, count = 0, onLoadMore, label = 'записей' }) {
  if (!pagination) return null;
  const hasMore = pagination.page * pagination.pageSize < pagination.total;
  return (
    <div className="pagination-controls" aria-live="polite">
      <p className="subtitle">Загружено {count} из {pagination.total} {label}</p>
      {pagination.error ? <div className="inline-error" role="alert">{pagination.error}</div> : null}
      {hasMore || pagination.error || pagination.loading ? (
        <Button variant="light" disabled={pagination.loading} onClick={onLoadMore}>
          {pagination.loading ? 'Загрузка…' : pagination.error ? 'Повторить загрузку' : 'Загрузить ещё'}
        </Button>
      ) : null}
    </div>
  );
}

export function CollectionPagination({ data, actions, resource, label }) {
  return <PaginationControls pagination={data.pagination?.[resource]} count={data[resource]?.length || 0} onLoadMore={() => actions.loadMore(resource)} label={label} />;
}
