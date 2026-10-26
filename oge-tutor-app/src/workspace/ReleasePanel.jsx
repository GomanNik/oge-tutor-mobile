import React, { useEffect, useState } from 'react';

const labels = { student_mapping: 'Связи учеников', lesson_roster: 'Состав занятий', assignment_recipients: 'Получатели работ', submission_files: 'Файлы попыток', material_sources: 'Источники материалов', progress_history: 'История прогресса', progress_snapshots: 'Снимки прогресса', notification_recipients: 'Адресаты уведомлений', pending_legacy_invites: 'Старые приглашения', progress_projection: 'Проекции прогресса', live_migration_failures: 'Ошибки продления серий' };
const modes = { enabled: 'Совместимость с v1', read_only: 'v1 только для чтения', disabled: 'v2, старый API отключён' };
export default function ReleasePanel({ api, context, onAccessError }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    api.releaseStatus(context).then(result => { if (alive) setReport(result.item); }).catch(err => { if (alive) { setError(err.message); onAccessError(err); } }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [api, context, version, onAccessError]);
  return <main className="workspace-content"><div className="course-section-head"><h1>Сверка данных</h1><button type="button" disabled={loading} onClick={() => setVersion(v => v + 1)}>Обновить сверку</button></div>
    {error && <p className="workspace-error" role="alert">{error}</p>}{loading && !report && <p>Загрузка…</p>}
    {report && <><p>{modes[report.legacyApiMode]} · {new Date(report.asOf).toLocaleString('ru-RU')}</p><p>{report.dataConsistent ? 'Связи данных согласованы' : 'Обнаружены расхождения'}</p>
      <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Проверка</th><th>Расхождения</th><th>Результат</th></tr></thead><tbody>{report.checks.map(row => <tr key={row.code}><td data-label="Проверка">{labels[row.code] || row.code}</td><td data-label="Расхождения">{row.count}</td><td data-label="Результат">{row.passed ? 'Пройдено' : 'Требует решения'}</td></tr>)}</tbody></table></div>
      <section className="course-section"><h2>Контроль выпуска</h2><dl><dt>Файлы</dt><dd>{report.counts.files}</dd><dt>Проверка файлов и восстановления</dt><dd>Отдельное подтверждение оператора</dd><dt>Барьер переключения</dt><dd>{report.cutoverCommittedAt ? new Date(report.cutoverCommittedAt).toLocaleString('ru-RU') : 'Не зафиксирован'}</dd></dl></section></>}
  </main>;
}
