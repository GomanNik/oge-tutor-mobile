import React, { useCallback, useEffect, useRef, useState } from 'react';

const EXAMS = { oge: 'ОГЭ', ege: 'ЕГЭ' };
const STATUS = { active: 'Активен', archived: 'Архив', draft: 'Черновик', published: 'Опубликована' };
const TASK_KINDS = { short_answer: 'Краткий ответ', extended_answer: 'Развёрнутый ответ', choice: 'Выбор ответа' };
const emptyTask = { code: '', title: '', topics: '', position: 1, kind: 'short_answer', maxScore: 1, criteria: [] };
const message = error => error?.message || 'Не удалось выполнить запрос.';

function Pager({ page, total, pageSize, onChange }) {
  if (total <= pageSize) return null;
  return <div className="catalog-pager"><button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}>Назад</button><span>{page} / {Math.ceil(total / pageSize)}</span><button type="button" disabled={page * pageSize >= total} onClick={() => onChange(page + 1)}>Далее</button></div>;
}

function TaskEditor({ task, version, api, context, onSaved, onCancel }) {
  const [form, setForm] = useState(() => task ? { ...task, topics: task.topics.join(', '), criteria: task.criteria || [] } : { ...emptyTask });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const setCriterion = (index, key, value) => setForm(current => ({ ...current, criteria: current.criteria.map((item, i) => i === index ? { ...item, [key]: value } : item) }));

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    const body = {
      code: form.code.trim(), title: form.title.trim(), topics: form.topics.split(',').map(item => item.trim()).filter(Boolean),
      position: Number(form.position), kind: form.kind, maxScore: Number(form.maxScore),
      criteria: form.criteria.map(item => ({ code: item.code.trim(), title: item.title.trim(), maxScore: Number(item.maxScore) })),
    };
    try {
      const result = task ? await api.updateCatalogTask(context, version, task, body) : await api.createCatalogTask(context, version, body);
      await onSaved(result.versionRevision);
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }

  return <section className="workspace-editor catalog-editor" aria-label={task ? 'Редактирование задания' : 'Новое задание'}>
    <div className="workspace-editor-head"><h2>{task ? 'Редактирование задания' : 'Новое задание'}</h2><button type="button" onClick={onCancel} aria-label="Закрыть">×</button></div>
    <form onSubmit={submit}>
      <label>Код<input required maxLength="32" value={form.code} onChange={event => set('code', event.target.value)} /></label>
      <label>Название<input required minLength="2" maxLength="200" value={form.title} onChange={event => set('title', event.target.value)} /></label>
      <label>Темы<input value={form.topics} onChange={event => set('topics', event.target.value)} /></label>
      <label>Порядок<input type="number" required min="1" max="10000" value={form.position} onChange={event => set('position', event.target.value)} /></label>
      <label>Тип<select value={form.kind} onChange={event => set('kind', event.target.value)}>{Object.entries(TASK_KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Максимум баллов<input type="number" required min="1" max="1000" value={form.maxScore} onChange={event => set('maxScore', event.target.value)} /></label>
      <div className="catalog-criteria"><div className="catalog-section-head"><h3>Критерии</h3><button type="button" onClick={() => set('criteria', [...form.criteria, { code: '', title: '', maxScore: 1 }])}>Добавить критерий</button></div>
        {form.criteria.map((item, index) => <div className="catalog-criterion" key={index}>
          <label>Код<input required value={item.code} onChange={event => setCriterion(index, 'code', event.target.value)} /></label>
          <label>Описание<input required value={item.title} onChange={event => setCriterion(index, 'title', event.target.value)} /></label>
          <label>Баллы<input type="number" required min="1" max="1000" value={item.maxScore} onChange={event => setCriterion(index, 'maxScore', event.target.value)} /></label>
          <button type="button" onClick={() => set('criteria', form.criteria.filter((_, i) => i !== index))}>Удалить</button>
        </div>)}
      </div>
      {error && <p className="workspace-error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить задание'}</button>
    </form>
  </section>;
}

async function findTask(api, context, versionId, code) {
  let page = 1;
  while (true) {
    const result = await api.catalogTasks(context, versionId, { page, pageSize: 100 });
    const task = result.items.find(item => item.code === code);
    if (task) return task;
    if (page * 100 >= result.total) throw new Error(`Задание «${code}» не найдено в выбранной версии.`);
    page += 1;
  }
}

export default function CatalogPanel({ api, context, canManage, onAccessError }) {
  const [tab, setTab] = useState('subjects');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState(null);
  const [subjectForm, setSubjectForm] = useState({ code: '', name: '' });
  const [programForm, setProgramForm] = useState({ subjectId: '', code: '', examType: 'oge', variant: 'general', name: '' });
  const [versionForm, setVersionForm] = useState({ period: '', revisionNumber: 1, sourceUrl: '', notes: '' });
  const [selectedProgram, setSelectedProgram] = useState(null);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [taskPage, setTaskPage] = useState(1);
  const [taskRows, setTaskRows] = useState([]);
  const [taskTotal, setTaskTotal] = useState(0);
  const [editingTask, setEditingTask] = useState(undefined);
  const [scoringForm, setScoringForm] = useState({ kind: 'historical_heuristic', code: '', description: '', sourceUrl: '' });
  const [mappingForm, setMappingForm] = useState({ fromVersionId: '', toVersionId: '', fromCode: '', toCode: '', reason: '' });
  const [mappingRows, setMappingRows] = useState([]);
  const [mappingPage, setMappingPage] = useState(1);
  const [mappingTotal, setMappingTotal] = useState(0);
  const [showRevoked, setShowRevoked] = useState(false);
  const [mappingToRevoke, setMappingToRevoke] = useState(null);
  const [revocationReason, setRevocationReason] = useState('');
  const sequence = useRef(0);
  const pageSize = 25;

  const load = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true); setError('');
    try {
      if (tab === 'mappings') { setRows([]); setTotal(0); return; }
      const result = tab === 'subjects'
        ? await api.subjects(context, { q: query, status, page, pageSize })
        : tab === 'programs' || !selectedProgram
          ? await api.programs(context, { q: query, ...(tab === 'programs' ? { status } : {}), page, pageSize })
          : await api.versions(context, selectedProgram.id, { period: query, versionStatus: status, page, pageSize });
      if (current === sequence.current) { setRows(result.items); setTotal(result.total); }
    } catch (err) { if (current === sequence.current) { setError(message(err)); onAccessError(err); } }
    finally { if (current === sequence.current) setLoading(false); }
  }, [api, context, onAccessError, page, query, selectedProgram, status, tab]);

  useEffect(() => { void load(); }, [load, refresh]);
  useEffect(() => {
    if (!selectedVersion) { setTaskRows([]); setTaskTotal(0); return; }
    let alive = true;
    api.catalogTasks(context, selectedVersion.id, { page: taskPage, pageSize }).then(result => {
      if (alive) { setTaskRows(result.items); setTaskTotal(result.total); }
    }).catch(err => { if (alive) { setError(message(err)); onAccessError(err); } });
    return () => { alive = false; };
  }, [api, context, onAccessError, selectedVersion, taskPage, refresh]);

  function changeTab(value) { setTab(value); setQuery(''); setStatus(''); setPage(1); setRows([]); setSelected(null); setSelectedProgram(null); setSelectedVersion(null); setEditingTask(undefined); setError(''); setNotice(''); }
  function changed() { setRefresh(value => value + 1); }
  async function run(operation, after) {
    setBusy(true); setError(''); setNotice('');
    try { const result = await operation(); await after?.(result); changed(); setNotice('Сохранено.'); return result; }
    catch (err) { setError(message(err)); onAccessError(err); return null; }
    finally { setBusy(false); }
  }

  async function chooseProgram(program) {
    setSelectedProgram(program); setSelectedVersion(null); setEditingTask(undefined); setPage(1); setQuery(''); setStatus(''); setRows([]);
    setTab('versions');
  }

  async function chooseVersion(version) {
    setError(''); setEditingTask(undefined); setTaskPage(1);
    try {
      const result = await api.version(context, version.id);
      setSelectedVersion(result.item);
      const rule = result.item.scoringRule;
      setScoringForm(rule ? { kind: rule.kind, code: rule.code, description: rule.description, sourceUrl: rule.sourceUrl || '' } : { kind: 'historical_heuristic', code: '', description: '', sourceUrl: '' });
    } catch (err) { setError(message(err)); onAccessError(err); }
  }

  async function reloadVersion(id) {
    const result = await api.version(context, id);
    setSelectedVersion(result.item);
  }

  async function saveMapping(event) {
    event.preventDefault();
    await run(async () => {
      if (mappingForm.fromVersionId === mappingForm.toVersionId) throw new Error('Выберите две разные версии.');
      const [from, to] = await Promise.all([
        findTask(api, context, mappingForm.fromVersionId, mappingForm.fromCode.trim()),
        findTask(api, context, mappingForm.toVersionId, mappingForm.toCode.trim()),
      ]);
      return api.createTaskMapping(context, { fromTaskId: from.id, toTaskId: to.id, reason: mappingForm.reason.trim() });
    }, async () => { setMappingForm(current => ({ ...current, fromCode: '', toCode: '', reason: '' })); await loadMappings(1); });
  }

  async function loadMappings(nextPage = 1) {
    if (!mappingForm.fromVersionId || !mappingForm.toVersionId) return;
    try { const result = await api.taskMappings(context, mappingForm.fromVersionId, mappingForm.toVersionId, { page: nextPage, pageSize, includeRevoked: showRevoked }); setMappingRows(result.items); setMappingTotal(result.total); setMappingPage(nextPage); }
    catch (err) { setError(message(err)); onAccessError(err); }
  }

  return <main className="workspace-content catalog-content">
    <div className="workspace-tabs" role="tablist" aria-label="Каталог программ">
      {[['subjects', 'Предметы'], ['programs', 'Программы'], ['versions', 'Версии и задания'], ['mappings', 'Сопоставления']].map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => changeTab(key)}>{label}</button>)}
    </div>
    {tab !== 'mappings' && <div className="workspace-toolbar">
      <label>{tab === 'versions' && selectedProgram ? 'Фильтр периода' : 'Поиск'}<input type={tab === 'versions' && selectedProgram ? 'text' : 'search'} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
      {(tab !== 'versions' || selectedProgram) && <label>Статус<select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">Все</option>{(tab === 'versions' ? ['draft', 'published', 'archived'] : ['active', 'archived']).map(value => <option key={value} value={value}>{STATUS[value]}</option>)}</select></label>}
    </div>}
    {error && <p className="workspace-error" role="alert">{error}</p>}
    {notice && <p className="catalog-notice" role="status">{notice}</p>}

    {tab === 'subjects' && <>
      {canManage && <form className="workspace-invite-form" onSubmit={event => { event.preventDefault(); void run(() => api.createSubject(context, { code: subjectForm.code.trim().toLowerCase(), name: subjectForm.name.trim() }), () => setSubjectForm({ code: '', name: '' })); }}>
        <label>Код<input required pattern="[a-z0-9][a-z0-9-]{1,63}" value={subjectForm.code} onChange={event => setSubjectForm(current => ({ ...current, code: event.target.value }))} /></label>
        <label>Название<input required minLength="2" maxLength="100" value={subjectForm.name} onChange={event => setSubjectForm(current => ({ ...current, name: event.target.value }))} /></label>
        <button type="submit" disabled={busy}>Создать предмет</button>
      </form>}
      {loading ? <p className="workspace-muted">Загрузка…</p> : rows.length ? <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Предмет</th><th>Код</th><th>Область</th><th>Статус</th><th></th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{row.name}</td><td>{row.code}</td><td>{row.workspaceId ? 'Локальный' : 'Общий'}</td><td>{STATUS[row.status]}</td><td>{canManage && row.workspaceId === (context?.workspaceId || null) ? <button type="button" onClick={() => setSelected(row)}>Изменить</button> : null}</td></tr>)}</tbody></table></div> : <p className="workspace-muted">Предметов пока нет.</p>}
      <Pager page={page} total={total} pageSize={pageSize} onChange={setPage} />
      {selected && <section className="workspace-editor"><div className="workspace-editor-head"><h2>{selected.code}</h2><button type="button" aria-label="Закрыть" onClick={() => setSelected(null)}>×</button></div><form onSubmit={event => { event.preventDefault(); void run(() => api.updateSubject(context, selected, selected.name), result => setSelected(result.item)); }}><label>Название<input required minLength="2" maxLength="100" value={selected.name} onChange={event => setSelected(current => ({ ...current, name: event.target.value }))} /></label><button type="submit" disabled={busy || selected.status !== 'active'}>Сохранить</button><button type="button" disabled={busy || selected.status !== 'active'} onClick={() => { if (window.confirm('Архивировать предмет?')) void run(() => api.archiveSubject(context, selected), result => setSelected(result.item)); }}>Архивировать</button></form></section>}
    </>}

    {tab === 'programs' && <>
      {canManage && <form className="workspace-invite-form catalog-program-form" onSubmit={event => { event.preventDefault(); void run(() => api.createProgram(context, { ...programForm, code: programForm.code.trim().toLowerCase(), variant: programForm.variant.trim().toLowerCase(), name: programForm.name.trim() }), () => setProgramForm({ subjectId: '', code: '', examType: 'oge', variant: 'general', name: '' })); }}>
        <SubjectPicker api={api} context={context} value={programForm.subjectId} onChange={subjectId => setProgramForm(current => ({ ...current, subjectId }))} onError={setError} />
        <label>Экзамен<select value={programForm.examType} onChange={event => setProgramForm(current => ({ ...current, examType: event.target.value }))}>{Object.entries(EXAMS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Вариант<input required pattern="[a-z0-9][a-z0-9-]{1,63}" value={programForm.variant} onChange={event => setProgramForm(current => ({ ...current, variant: event.target.value }))} /></label>
        <label>Код<input required pattern="[a-z0-9][a-z0-9-]{1,63}" value={programForm.code} onChange={event => setProgramForm(current => ({ ...current, code: event.target.value }))} /></label>
        <label>Название<input required minLength="2" maxLength="120" value={programForm.name} onChange={event => setProgramForm(current => ({ ...current, name: event.target.value }))} /></label>
        <button type="submit" disabled={busy || !programForm.subjectId}>Создать программу</button>
      </form>}
      {loading ? <p className="workspace-muted">Загрузка…</p> : rows.length ? <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Программа</th><th>Экзамен</th><th>Предмет</th><th>Вариант</th><th>Статус</th><th></th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><strong>{row.name}</strong><small>{row.code} · {row.workspaceId ? 'Локальная' : 'Общая'}</small></td><td>{EXAMS[row.examType]}</td><td>{row.subject?.name || row.subjectId}</td><td>{row.variant}</td><td>{STATUS[row.status]}</td><td><button type="button" onClick={() => chooseProgram(row)}>Версии</button>{canManage && row.workspaceId === (context?.workspaceId || null) && <button type="button" onClick={() => setSelected(row)}>Изменить</button>}</td></tr>)}</tbody></table></div> : <p className="workspace-muted">Программ пока нет.</p>}
      <Pager page={page} total={total} pageSize={pageSize} onChange={setPage} />
      {selected && <section className="workspace-editor"><div className="workspace-editor-head"><h2>{selected.code}</h2><button type="button" aria-label="Закрыть" onClick={() => setSelected(null)}>×</button></div><form onSubmit={event => { event.preventDefault(); void run(() => api.updateProgram(context, selected, selected.name), result => setSelected(result.item)); }}><label>Название<input required minLength="2" maxLength="120" value={selected.name} onChange={event => setSelected(current => ({ ...current, name: event.target.value }))} /></label><button type="submit" disabled={busy || selected.status !== 'active'}>Сохранить</button><button type="button" disabled={busy || selected.status !== 'active'} onClick={() => { if (window.confirm('Архивировать программу?')) void run(() => api.archiveProgram(context, selected), result => setSelected(result.item)); }}>Архивировать</button></form></section>}
    </>}

    {tab === 'versions' && <>
      <div className="catalog-section-head"><h1>{selectedProgram ? selectedProgram.name : 'Версии программ'}</h1>{selectedProgram && <button type="button" onClick={() => { setSelectedProgram(null); setSelectedVersion(null); setRows([]); setPage(1); }}>Выбрать другую программу</button>}</div>
      {!selectedProgram ? <ProgramPicker api={api} context={context} onSelect={chooseProgram} onError={setError} /> : <>
        {canManage && selectedProgram.workspaceId === (context?.workspaceId || null) && selectedProgram.status === 'active' && <form className="workspace-invite-form" onSubmit={event => { event.preventDefault(); void run(() => api.createVersion(context, selectedProgram.id, { period: versionForm.period.trim(), revisionNumber: Number(versionForm.revisionNumber), ...(versionForm.sourceUrl ? { sourceUrl: versionForm.sourceUrl.trim() } : {}), notes: versionForm.notes.trim() }), () => setVersionForm({ period: '', revisionNumber: 1, sourceUrl: '', notes: '' })); }}>
          <label>Период версии<input required pattern="[a-z0-9][a-z0-9-]{1,31}" value={versionForm.period} onChange={event => setVersionForm(current => ({ ...current, period: event.target.value }))} /></label>
          <label>Ревизия<input type="number" min="1" required value={versionForm.revisionNumber} onChange={event => setVersionForm(current => ({ ...current, revisionNumber: event.target.value }))} /></label>
          <label>Источник<input type="url" value={versionForm.sourceUrl} onChange={event => setVersionForm(current => ({ ...current, sourceUrl: event.target.value }))} /></label>
          <label>Примечание<input maxLength="2000" value={versionForm.notes} onChange={event => setVersionForm(current => ({ ...current, notes: event.target.value }))} /></label>
          <button type="submit" disabled={busy}>Создать черновик</button>
        </form>}
        {loading ? <p className="workspace-muted">Загрузка…</p> : rows.length ? <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Период</th><th>Ревизия</th><th>Статус</th><th>Источник</th><th></th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{row.period}</td><td>{row.revisionNumber}</td><td>{STATUS[row.status]}</td><td>{row.sourceUrl ? <a href={row.sourceUrl} target="_blank" rel="noreferrer">Открыть</a> : '—'}</td><td><button type="button" onClick={() => chooseVersion(row)}>Задания</button></td></tr>)}</tbody></table></div> : <p className="workspace-muted">Версий пока нет.</p>}
        <Pager page={page} total={total} pageSize={pageSize} onChange={setPage} />
        {selectedVersion && <section className="catalog-version-detail">
          <div className="catalog-section-head"><div><h2>{selectedVersion.period} · ревизия {selectedVersion.revisionNumber}</h2><span>{STATUS[selectedVersion.status]} · {taskTotal} заданий</span></div><button type="button" onClick={() => { setSelectedVersion(null); setEditingTask(undefined); }}>Закрыть</button></div>
          {selectedVersion.status === 'draft' && canManage && <div className="catalog-actions"><button type="button" onClick={() => setEditingTask(null)}>Добавить задание</button><button type="button" disabled={busy} onClick={() => { if (window.confirm('Опубликовать версию? После этого задания и критерии нельзя будет изменить.')) void run(() => api.publishVersion(context, selectedVersion), async () => { await reloadVersion(selectedVersion.id); setEditingTask(undefined); }); }}>Опубликовать</button></div>}
          {selectedVersion.status === 'published' && canManage && <div className="catalog-actions"><button type="button" disabled={busy} onClick={() => { if (window.confirm('Архивировать версию? Существующая история сохранится.')) void run(() => api.archiveVersion(context, selectedVersion), () => reloadVersion(selectedVersion.id)); }}>Архивировать</button></div>}
          {selectedVersion.status === 'draft' && canManage && <form className="workspace-invite-form" onSubmit={event => { event.preventDefault(); void run(() => api.updateVersion(context, selectedVersion, { sourceUrl: selectedVersion.sourceUrl || null, notes: selectedVersion.notes }), () => reloadVersion(selectedVersion.id)); }}><label>Источник<input type="url" value={selectedVersion.sourceUrl || ''} onChange={event => setSelectedVersion(current => ({ ...current, sourceUrl: event.target.value }))} /></label><label>Примечание<input maxLength="2000" value={selectedVersion.notes} onChange={event => setSelectedVersion(current => ({ ...current, notes: event.target.value }))} /></label><button type="submit" disabled={busy}>Сохранить версию</button></form>}
          <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>№</th><th>Код</th><th>Задание</th><th>Темы</th><th>Баллы</th><th></th></tr></thead><tbody>{taskRows.map(task => <tr key={task.id}><td>{task.position}</td><td>{task.code}</td><td>{task.title}</td><td>{task.topics.join(', ') || '—'}</td><td>{task.maxScore ?? '—'}</td><td>{selectedVersion.status === 'draft' && canManage && <><button type="button" onClick={() => setEditingTask(task)}>Изменить</button><button type="button" disabled={busy} onClick={() => { if (window.confirm('Удалить задание из черновика?')) void run(() => api.deleteCatalogTask(context, selectedVersion, task), result => reloadVersion(selectedVersion.id).then(() => { setTaskPage(1); setNotice(`Задание удалено; ревизия ${result.versionRevision}.`); })); }}>Удалить</button></>}</td></tr>)}</tbody></table></div>
          <Pager page={taskPage} total={taskTotal} pageSize={pageSize} onChange={setTaskPage} />
          {editingTask !== undefined && <TaskEditor key={editingTask?.id || 'new'} task={editingTask} version={selectedVersion} api={api} context={context} onCancel={() => setEditingTask(undefined)} onSaved={async () => { await reloadVersion(selectedVersion.id); setEditingTask(undefined); changed(); }} />}
          {selectedVersion.scoringRule && <p className="catalog-rule">Правило: {selectedVersion.scoringRule.description} ({selectedVersion.scoringRule.code})</p>}
          {selectedVersion.status === 'draft' && canManage && <form className="workspace-invite-form catalog-rule-form" onSubmit={event => { event.preventDefault(); void run(() => api.setScoringRule(context, selectedVersion, { ...scoringForm, ...(scoringForm.sourceUrl ? {} : { sourceUrl: undefined }) }), () => reloadVersion(selectedVersion.id)); }}>
            <label>Тип правила<select value={scoringForm.kind} onChange={event => setScoringForm(current => ({ ...current, kind: event.target.value }))}><option value="historical_heuristic">Историческая эвристика</option><option value="verified_reference">Подтверждённый источник</option></select></label>
            <label>Код<input required pattern="[a-z0-9][a-z0-9-]{1,63}" value={scoringForm.code} onChange={event => setScoringForm(current => ({ ...current, code: event.target.value }))} /></label>
            <label>Описание<input required minLength="10" maxLength="1000" value={scoringForm.description} onChange={event => setScoringForm(current => ({ ...current, description: event.target.value }))} /></label>
            <label>Источник<input type="url" required={scoringForm.kind === 'verified_reference'} value={scoringForm.sourceUrl} onChange={event => setScoringForm(current => ({ ...current, sourceUrl: event.target.value }))} /></label>
            <button type="submit" disabled={busy}>Сохранить правило</button>
          </form>}
        </section>}
      </>}
    </>}

    {tab === 'mappings' && <section className="catalog-mapping">
      <h1>Сопоставления заданий</h1>
      <ProgramPicker api={api} context={context} onSelect={program => { setSelectedProgram(program); setMappingRows([]); setMappingTotal(0); setMappingToRevoke(null); setMappingForm({ fromVersionId: '', toVersionId: '', fromCode: '', toCode: '', reason: '' }); }} onError={setError} />
      {selectedProgram && <><h2>{selectedProgram.name}</h2><VersionPair api={api} context={context} programId={selectedProgram.id} value={mappingForm} onChange={updater => { setMappingForm(updater); setMappingRows([]); setMappingTotal(0); setMappingToRevoke(null); }} onError={setError} />
        {mappingForm.fromVersionId && mappingForm.toVersionId && <div className="catalog-actions"><button type="button" onClick={() => loadMappings(1)}>Показать сопоставления</button>{canManage && <label className="catalog-checkbox"><input type="checkbox" checked={showRevoked} onChange={event => { setShowRevoked(event.target.checked); setMappingRows([]); setMappingTotal(0); }} />С отозванными</label>}</div>}
        {mappingRows.length > 0 && <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Исходное задание</th><th>Новое задание</th><th>Основание</th><th>Статус</th><th></th></tr></thead><tbody>{mappingRows.map(row => <tr key={row.id}><td>{row.fromTask?.code || row.fromTaskId}<small>{row.fromTask?.title}</small></td><td>{row.toTask?.code || row.toTaskId}<small>{row.toTask?.title}</small></td><td>{row.reason}</td><td>{row.revokedAt ? 'Отозвано' : 'Действует'}</td><td>{canManage && selectedProgram.workspaceId === (context?.workspaceId || null) && !row.revokedAt && <button type="button" onClick={() => { setMappingToRevoke(row); setRevocationReason(''); }}>Отозвать</button>}</td></tr>)}</tbody></table></div>}
        <Pager page={mappingPage} total={mappingTotal} pageSize={pageSize} onChange={next => loadMappings(next)} />
        {mappingToRevoke && <form className="workspace-invite-form" onSubmit={event => { event.preventDefault(); void run(() => api.revokeTaskMapping(context, mappingToRevoke, revocationReason.trim()), async () => { setMappingToRevoke(null); await loadMappings(mappingPage); }); }}><label>Причина отзыва<input required minLength="10" maxLength="500" value={revocationReason} onChange={event => setRevocationReason(event.target.value)} /></label><button type="submit" disabled={busy}>Подтвердить отзыв</button><button type="button" onClick={() => setMappingToRevoke(null)}>Отмена</button></form>}
        {canManage && selectedProgram.workspaceId === (context?.workspaceId || null) && <form className="workspace-invite-form" onSubmit={saveMapping}><label>Код исходного задания<input required value={mappingForm.fromCode} onChange={event => setMappingForm(current => ({ ...current, fromCode: event.target.value }))} /></label><label>Код нового задания<input required value={mappingForm.toCode} onChange={event => setMappingForm(current => ({ ...current, toCode: event.target.value }))} /></label><label>Основание<input required minLength="10" maxLength="500" value={mappingForm.reason} onChange={event => setMappingForm(current => ({ ...current, reason: event.target.value }))} /></label><button type="submit" disabled={busy || !mappingForm.fromVersionId || !mappingForm.toVersionId}>Сохранить связь</button></form>}
      </>}
    </section>}
  </main>;
}

function SubjectPicker({ api, context, value, onChange, onError }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  useEffect(() => { let alive = true; api.subjects(context, { q: query, status: 'active', pageSize: 50 }).then(result => { if (alive) setItems(result.items); }).catch(error => { if (alive) { setItems([]); onError(message(error)); } }); return () => { alive = false; }; }, [api, context, onError, query]);
  return <div className="catalog-picker"><label>Поиск предмета<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label><label>Предмет<select required value={value} onChange={event => onChange(event.target.value)}><option value="">Выберите предмет</option>{items.map(item => <option key={item.id} value={item.id}>{item.name} · {item.workspaceId ? 'локальный' : 'общий'}</option>)}</select></label></div>;
}

function ProgramPicker({ api, context, onSelect, onError }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  useEffect(() => { let alive = true; api.programs(context, { q: query, pageSize: 50 }).then(result => { if (alive) setItems(result.items); }).catch(error => { if (alive) { setItems([]); onError(message(error)); } }); return () => { alive = false; }; }, [api, context, onError, query]);
  return <div className="catalog-picker"><label>Поиск программы<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label><label>Программа<select defaultValue="" onChange={event => { const item = items.find(row => row.id === event.target.value); if (item) onSelect(item); }}><option value="">Выберите программу</option>{items.map(item => <option key={item.id} value={item.id}>{item.name} · {item.workspaceId ? 'локальная' : 'общая'}</option>)}</select></label></div>;
}

function VersionPair({ api, context, programId, value, onChange, onError }) {
  const [versions, setVersions] = useState([]);
  useEffect(() => { if (!programId) return; let alive = true; api.versions(context, programId, { pageSize: 100 }).then(result => { if (alive) setVersions(result.items.filter(item => item.status !== 'draft')); }).catch(error => { if (alive) { setVersions([]); onError(message(error)); } }); return () => { alive = false; }; }, [api, context, onError, programId]);
  return <div className="catalog-picker"><label>От версии<select value={value.fromVersionId} onChange={event => onChange(current => ({ ...current, fromVersionId: event.target.value }))}><option value="">Выберите</option>{versions.map(item => <option key={item.id} value={item.id}>{item.period} · {item.revisionNumber}</option>)}</select></label><label>К версии<select value={value.toVersionId} onChange={event => onChange(current => ({ ...current, toVersionId: event.target.value }))}><option value="">Выберите</option>{versions.map(item => <option key={item.id} value={item.id}>{item.period} · {item.revisionNumber}</option>)}</select></label></div>;
}
