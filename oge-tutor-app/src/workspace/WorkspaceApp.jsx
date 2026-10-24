import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createWorkspaceClient } from './workspaceClient.js';
import CatalogPanel from './CatalogPanel.jsx';
import CoursesPanel from './CoursesPanel.jsx';

const MODE_KEY = 'oge-tutor-workspace-context';
const ROLES = ['admin', 'teacher', 'student'];
const ROLE_LABELS = { admin: 'Администратор', teacher: 'Преподаватель', student: 'Ученик' };
const INVITATION_LABELS = { pending: 'Ожидает', accepted: 'Принято', revoked: 'Отозвано', expired: 'Истекло' };
const DELIVERY_LABELS = { queued: 'В очереди', sent: 'Отправлено', failed: 'Ошибка отправки' };

function showError(error) { return error?.message || 'Не удалось выполнить запрос.'; }

function Login({ onLogin, busy, error }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return <div className="workspace-auth-page"><form className="workspace-auth" onSubmit={event => { event.preventDefault(); onLogin(email, password); }}>
    <div className="workspace-mark">OGE Tutor</div>
    <h1>Вход в кабинет</h1>
    <label>Email<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
    <label>Пароль<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
    {error && <p className="workspace-error" role="alert">{error}</p>}
    <button type="submit" disabled={busy}>{busy ? 'Входим…' : 'Войти'}</button>
  </form></div>;
}

function InvitationAccept({ token, api, onAccepted, me, onLogin, busy, error }) {
  const [mode, setMode] = useState(me ? 'existing' : 'new');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  async function submit(event) {
    event.preventDefault();
    try {
      if (mode === 'new') return await onAccepted(() => api.acceptNew(token, displayName, password));
      if (!me) await onLogin(email, password, false);
      return await onAccepted(() => api.acceptExisting(token));
    } catch { /* Login reports the error in the form. */ }
  }
  return <div className="workspace-auth-page"><form className="workspace-auth" onSubmit={submit}>
    <div className="workspace-mark">OGE Tutor</div><h1>Приглашение</h1>
    <div className="workspace-segments" role="group" aria-label="Способ входа">
      <button type="button" aria-pressed={mode === 'new'} onClick={() => setMode('new')}>Новый аккаунт</button>
      <button type="button" aria-pressed={mode === 'existing'} onClick={() => setMode('existing')}>Уже есть аккаунт</button>
    </div>
    {mode === 'new' ? <label>Ваше имя<input required minLength="2" maxLength="100" value={displayName} onChange={event => setDisplayName(event.target.value)} /></label> : null}
    {mode === 'existing' && !me ? <label>Email<input type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label> : null}
    {(mode === 'new' || !me) ? <label>Пароль<input type="password" required minLength="6" autoComplete={mode === 'new' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} /></label> : null}
    {error && <p className="workspace-error" role="alert">{error}</p>}
    <button type="submit" disabled={busy}>{busy ? 'Подождите…' : 'Принять приглашение'}</button>
  </form></div>;
}

function MemberEditor({ member, api, context, onSaved, onClose, onAccessError }) {
  const [action, setAction] = useState('name');
  const [name, setName] = useState(member.displayName);
  const [role, setRole] = useState('teacher');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const applicableRoles = action === 'revoke' ? member.roles : ROLES.filter(item => !member.roles.includes(item));
  async function submit(event) {
    event.preventDefault();
    if ((action === 'suspend' || action === 'revoke') && !window.confirm(action === 'suspend' ? 'Приостановить доступ участника?' : 'Отозвать роль участника?')) return;
    setBusy(true); setError('');
    try {
      let result;
      if (action === 'name') result = await api.updateMember(context, member, { displayNameOverride: name.trim() || null });
      if (action === 'grant') result = await api.grantRole(context, member, role, reason.trim());
      if (action === 'revoke') result = await api.revokeRole(context, member, role, reason.trim());
      if (action === 'suspend') result = await api.setSuspended(context, member, true, reason.trim());
      if (action === 'resume') result = await api.setSuspended(context, member, false, reason.trim());
      onSaved(result.item);
      setAction('name'); setRole(''); setReason(''); setName(result.item.displayName);
    } catch (err) { setError(showError(err)); onAccessError(err); }
    finally { setBusy(false); }
  }
  return <section className="workspace-editor" aria-label="Действия с участником">
    <div className="workspace-editor-head"><div><h2>{member.displayName}</h2><span>{member.email}</span></div><button type="button" onClick={onClose} aria-label="Закрыть">×</button></div>
    <p>Роли: {member.roles.map(item => ROLE_LABELS[item]).join(', ') || 'нет'} · {member.status === 'active' ? 'Активен' : 'Приостановлен'}</p>
    <form onSubmit={submit}>
      <label>Действие<select value={action} onChange={event => {
        const next = event.target.value;
        setAction(next);
        if (next === 'revoke') setRole(member.roles[0] || '');
        if (next === 'grant') setRole(ROLES.find(item => !member.roles.includes(item)) || '');
      }}>
        <option value="name">Изменить имя</option><option value="grant">Назначить роль</option><option value="revoke">Отозвать роль</option>
        {member.status === 'active' ? <option value="suspend">Приостановить доступ</option> : <option value="resume">Восстановить доступ</option>}
      </select></label>
      {action === 'name' ? <label>Имя в этом пространстве<input minLength="2" maxLength="100" value={name} onChange={event => setName(event.target.value)} /></label> : null}
      {action === 'grant' || action === 'revoke' ? <label>Роль<select value={role} onChange={event => setRole(event.target.value)}>{applicableRoles.map(item => <option key={item} value={item}>{ROLE_LABELS[item]}</option>)}</select></label> : null}
      {action !== 'name' ? <label>Причина<textarea value={reason} onChange={event => setReason(event.target.value)} minLength={action === 'grant' ? undefined : 10} maxLength="500" required={action !== 'grant'} /></label> : null}
      {error && <p className="workspace-error" role="alert">{error}</p>}
      <button type="submit" disabled={busy || ((action === 'grant' || action === 'revoke') && !role)}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
    </form>
  </section>;
}

function AdminPanel({ api, context, onAccessError }) {
  const [tab, setTab] = useState('members');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRoles, setInviteRoles] = useState(['student']);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const sequence = useRef(0);

  useEffect(() => {
    const current = ++sequence.current;
    let alive = true;
    setRows([]); setNextCursor(null); setSelected(null); setLoading(true); setError('');
    const filters = tab === 'members' ? { q: query, role: filter } : tab === 'invitations' ? { status: filter } : {};
    const operation = tab === 'members' ? api.members(context, filters) : tab === 'invitations' ? api.invitations(context, filters) : api.audit(context, filters);
    operation.then(result => { if (alive && sequence.current === current) { setRows(result.items); setNextCursor(result.pageInfo.nextCursor); } })
      .catch(err => { if (alive && sequence.current === current) { setError(showError(err)); onAccessError(err); } })
      .finally(() => { if (alive && sequence.current === current) setLoading(false); });
    return () => { alive = false; };
  }, [api, context, tab, query, filter, version, onAccessError]);

  async function loadMore() {
    if (!nextCursor || loading) return;
    const current = sequence.current;
    setLoading(true); setError('');
    try {
      const filters = tab === 'members' ? { q: query, role: filter } : tab === 'invitations' ? { status: filter } : {};
      const result = tab === 'members' ? await api.members(context, { ...filters, cursor: nextCursor }) : tab === 'invitations' ? await api.invitations(context, { ...filters, cursor: nextCursor }) : await api.audit(context, { cursor: nextCursor });
      if (sequence.current === current) { setRows(previous => [...previous, ...result.items]); setNextCursor(result.pageInfo.nextCursor); }
    } catch (err) { if (sequence.current === current) { setError(showError(err)); onAccessError(err); } }
    finally { if (sequence.current === current) setLoading(false); }
  }

  async function invite(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api.invite(context, inviteEmail, inviteRoles); setInviteEmail(''); setVersion(value => value + 1); }
    catch (err) { setError(showError(err)); onAccessError(err); }
    finally { setBusy(false); }
  }

  async function invitationAction(row, action) {
    if (action === 'revoke' && !window.confirm('Отозвать приглашение?')) return;
    setBusy(true); setError('');
    try { await (action === 'resend' ? api.resendInvitation(context, row) : api.revokeInvitation(context, row)); setVersion(value => value + 1); }
    catch (err) { setError(showError(err)); onAccessError(err); }
    finally { setBusy(false); }
  }

  return <div className="workspace-content">
    <div className="workspace-tabs" role="tablist" aria-label="Управление пространством">
      {[['members', 'Участники'], ['invitations', 'Приглашения'], ['audit', 'Аудит']].map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setFilter(''); setQuery(''); }}>{label}</button>)}
    </div>
    {tab === 'members' && <div className="workspace-toolbar">
      <label>Поиск<input type="search" placeholder="Имя или email" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label>Роль<select value={filter} onChange={event => setFilter(event.target.value)}><option value="">Все</option>{ROLES.map(item => <option key={item} value={item}>{ROLE_LABELS[item]}</option>)}</select></label>
    </div>}
    {tab === 'invitations' && <form className="workspace-invite-form" onSubmit={invite}>
      <label>Email<input type="email" required value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} /></label>
      <fieldset><legend>Роли</legend>{ROLES.map(item => <label key={item}><input type="checkbox" checked={inviteRoles.includes(item)} onChange={event => setInviteRoles(current => event.target.checked ? [...current, item] : current.filter(value => value !== item))} />{ROLE_LABELS[item]}</label>)}</fieldset>
      <button type="submit" disabled={busy || inviteRoles.length === 0}>Отправить приглашение</button>
    </form>}
    {error && <p className="workspace-error" role="alert">{error}</p>}
    {loading && rows.length === 0 && <p className="workspace-muted">Загрузка…</p>}
    {!loading && rows.length === 0 && !error && <p className="workspace-muted">Пока нет записей.</p>}
    {rows.length > 0 && <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr>
      {tab === 'members' ? <><th>Участник</th><th>Роли</th><th>Статус</th><th></th></> : tab === 'invitations' ? <><th>Email</th><th>Роли</th><th>Статус</th><th></th></> : <><th>Время</th><th>Действие</th><th>Объект</th><th>Причина</th></>}
    </tr></thead><tbody>{rows.map(row => <tr key={row.id}>
      {tab === 'members' ? <><td data-label="Участник"><span><strong>{row.displayName}</strong><small>{row.email}</small></span></td><td data-label="Роли">{row.roles.map(value => ROLE_LABELS[value]).join(', ') || 'Нет'}</td><td data-label="Статус">{row.status === 'active' ? 'Активен' : 'Приостановлен'}</td><td data-label="Действия"><button type="button" onClick={() => setSelected(row)}>Открыть</button></td></> : null}
      {tab === 'invitations' ? <><td data-label="Email">{row.email}</td><td data-label="Роли">{row.roles.map(value => ROLE_LABELS[value]).join(', ')}</td><td data-label="Статус">{INVITATION_LABELS[row.status]} · {DELIVERY_LABELS[row.deliveryStatus]}</td><td data-label="Действия">{row.status === 'pending' ? <span><button type="button" disabled={busy} onClick={() => invitationAction(row, 'resend')}>Повторить</button><button type="button" disabled={busy} onClick={() => invitationAction(row, 'revoke')}>Отозвать</button></span> : null}</td></> : null}
      {tab === 'audit' ? <><td data-label="Время">{new Date(row.occurredAt).toLocaleString('ru-RU')}</td><td data-label="Действие">{row.action}</td><td data-label="Объект">{row.targetType} · {row.targetId}</td><td data-label="Причина">{row.reason || '—'}</td></> : null}
    </tr>)}</tbody></table></div>}
    {nextCursor && <button type="button" className="workspace-more" disabled={loading} onClick={loadMore}>{loading ? 'Загрузка…' : 'Показать ещё'}</button>}
    {tab === 'members' && selected && <MemberEditor member={selected} api={api} context={context} onAccessError={onAccessError} onClose={() => setSelected(null)} onSaved={item => { setSelected(item); setRows(current => current.map(row => row.id === item.id ? item : row)); }} />}
  </div>;
}

export default function WorkspaceApp({ onLegacy }) {
  const api = useMemo(() => createWorkspaceClient(), []);
  const [me, setMe] = useState(null);
  const [contexts, setContexts] = useState([]);
  const [selectedKey, setSelectedKey] = useState(() => window.sessionStorage.getItem(MODE_KEY) || '');
  const [loading, setLoading] = useState(api.hasToken());
  const [contextRefreshing, setContextRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState('home');
  const [inviteToken, setInviteToken] = useState(() => {
    if (window.location.pathname !== '/workspace-invite') return '';
    const token = new URLSearchParams(window.location.search).get('token') || '';
    window.history.replaceState({}, '', '/workspace-invite');
    return token;
  });

  const onAccessError = useCallback(async err => {
    if (err?.status !== 401 && err?.status !== 403) return;
    setContexts([]);
    setContextRefreshing(true);
    if (err.status === 401) {
      setMe(null);
      setSelectedKey('');
      window.sessionStorage.removeItem(MODE_KEY);
      setContextRefreshing(false);
      return;
    }
    try {
      const available = await api.contexts();
      setContexts(available.items);
    } catch (refreshError) {
      if (refreshError.status === 401) setMe(null);
      setError(showError(refreshError));
    } finally { setContextRefreshing(false); }
  }, [api]);

  useEffect(() => {
    if (!api.hasToken()) return;
    let alive = true;
    Promise.all([api.me(), api.contexts()]).then(([account, available]) => {
      if (alive) { setMe(account.item); setContexts(available.items); }
    }).catch(err => { if (alive) { setError(showError(err)); if (err.status === 401) { setMe(null); setContexts([]); } } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [api]);

  async function login(email, password, clearInvite = true) {
    setBusy(true); setError('');
    try {
      const result = await api.login(email, password);
      setMe(result.user); setContexts(result.contexts);
      if (clearInvite) setInviteToken('');
      return result;
    } catch (err) { setError(showError(err)); throw err; }
    finally { setBusy(false); }
  }

  async function accept(operation) {
    setBusy(true); setError('');
    try {
      const result = await operation();
      if (result.user) { setMe(result.user); setContexts(result.contexts); }
      else { const refreshed = await api.contexts(); setContexts(refreshed.items); }
      setInviteToken('');
      window.history.replaceState({}, '', '/');
    } catch (err) { setError(showError(err)); }
    finally { setBusy(false); }
  }

  async function logout() {
    try { await api.logout(); }
    catch (err) { setError(showError(err)); }
    finally { setMe(null); setContexts([]); setSelectedKey(''); window.sessionStorage.removeItem(MODE_KEY); }
  }

  function select(context) {
    const key = `${context.workspaceId}:${context.role}`;
    setSelectedKey(key); window.sessionStorage.setItem(MODE_KEY, key);
    setView('home');
    if (context.legacyRole === context.role) onLegacy();
  }

  const choices = contexts.flatMap(context => context.roles.map(role => ({ workspaceId: context.workspaceId, name: context.name, legacyRole: context.legacyRole, role })));
  const current = choices.find(choice => `${choice.workspaceId}:${choice.role}` === selectedKey) || choices[0];
  const context = current ? { workspaceId: current.workspaceId, role: current.role } : null;
  const activeView = !context && me?.catalogManage ? 'globalCatalog' : view;

  if (loading) return <div className="workspace-auth-page"><p>Загрузка…</p></div>;
  if (inviteToken) return <InvitationAccept token={inviteToken} api={api} onAccepted={accept} me={me} onLogin={login} busy={busy} error={error} />;
  if (!me) return <Login onLogin={(email, password) => { void login(email, password).catch(() => {}); }} busy={busy} error={error} />;
  return <div className="workspace-page">
    <header className="workspace-header"><div><span className="workspace-mark">OGE Tutor</span><strong>{activeView === 'globalCatalog' ? 'Общий каталог' : current?.name || 'Кабинет'}</strong></div><div className="workspace-header-actions">
      {context && <div className="workspace-view-nav">{context.role === 'admin' && <button type="button" aria-current={activeView === 'home' ? 'page' : undefined} onClick={() => setView('home')}>Кабинет</button>}<button type="button" aria-current={activeView === 'courses' || (activeView === 'home' && context.role !== 'admin') ? 'page' : undefined} onClick={() => setView('courses')}>Курсы</button><button type="button" aria-current={activeView === 'catalog' ? 'page' : undefined} onClick={() => setView('catalog')}>Каталог</button></div>}
      {me.catalogManage && <button type="button" aria-current={activeView === 'globalCatalog' ? 'page' : undefined} onClick={() => setView('globalCatalog')}>Общий каталог</button>}
      {choices.length > 0 && <label>Контекст<select aria-label="Рабочее пространство и роль" value={current ? `${current.workspaceId}:${current.role}` : ''} onChange={event => { const choice = choices.find(item => `${item.workspaceId}:${item.role}` === event.target.value); if (choice) select(choice); }}>
        {choices.map(choice => <option key={`${choice.workspaceId}:${choice.role}`} value={`${choice.workspaceId}:${choice.role}`}>{choice.name} · {ROLE_LABELS[choice.role]}</option>)}
      </select></label>}
      <button type="button" onClick={logout}>Выйти</button>
    </div></header>
    {contextRefreshing ? <main className="workspace-empty"><p>Обновляем доступ…</p></main> : activeView === 'globalCatalog' && me.catalogManage ? <CatalogPanel key="global" api={api} context={null} canManage onAccessError={onAccessError} /> : activeView === 'catalog' && context ? <CatalogPanel key={`${context.workspaceId}:${context.role}`} api={api} context={context} canManage={context.role === 'admin'} onAccessError={onAccessError} /> : context && (activeView === 'courses' || (activeView === 'home' && context.role !== 'admin')) ? <CoursesPanel key={`${context.workspaceId}:${context.role}`} api={api} context={context} onAccessError={onAccessError} legacyRole={current?.legacyRole} onLegacy={onLegacy} /> : context?.role === 'admin' ? <AdminPanel key={`${context.workspaceId}:${context.role}`} api={api} context={context} onAccessError={onAccessError} /> : <main className="workspace-empty"><h1>Нет доступных пространств</h1></main>}
  </div>;
}
