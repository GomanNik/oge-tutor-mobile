import { useCallback, useEffect, useRef, useState } from 'react';

const EMPTY_PAGE = { items: [], total: 0, page: 0, pageSize: 25, loading: true, error: '' };

export function usePagedRead(loadPage, filters, { enabled = true, fallback = [], revision = '' } = {}) {
  const [state, setState] = useState(EMPTY_PAGE);
  const current = useRef(EMPTY_PAGE);
  const generation = useRef(0);
  const filterKey = JSON.stringify(filters);
  const request = useCallback(async (page, epoch) => {
    current.current = { ...current.current, loading: true, error: '' };
    setState(current.current);
    try {
      const result = await loadPage({ ...JSON.parse(filterKey), page, pageSize: 25 });
      if (epoch !== generation.current) return;
      const items = page === 1 ? result.items : [...new Map([...current.current.items, ...result.items].map((item) => [item.id, item])).values()];
      current.current = { ...result, items, loading: false, error: '' };
    } catch (error) {
      if (epoch !== generation.current) return;
      current.current = { ...current.current, loading: false, error: error?.message || 'Не удалось загрузить записи.' };
    }
    setState(current.current);
  }, [loadPage, filterKey]);

  useEffect(() => {
    const epoch = ++generation.current;
    current.current = EMPTY_PAGE;
    if (enabled && loadPage) void request(1, epoch);
    return () => { generation.current += 1; };
  }, [enabled, loadPage, request, revision]);

  const loadMore = useCallback(() => {
    if (current.current.loading) return;
    return request(current.current.page + 1, generation.current);
  }, [request]);
  const refresh = useCallback(() => request(1, ++generation.current), [request]);
  return loadPage ? { ...state, loadMore, refresh } : { items: fallback, total: fallback.length, page: 1, pageSize: Math.max(1, fallback.length), loading: false, error: '', loadMore, refresh };
}
