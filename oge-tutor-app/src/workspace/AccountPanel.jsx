import React, { useEffect, useState } from 'react';

const errorText = err => err?.message || 'Не удалось выполнить запрос.';
export function AccountRecovery({ api, token = '', onClose }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [info, setInfo] = useState(null);
  const [sent, setSent] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(Boolean(token));
  const [error, setError] = useState('');
  useEffect(() => {
    if (!token) return;
    let alive = true;
    api.verifyAccessToken(token).then(result => { if (alive) setInfo(result); }).catch(err => { if (alive) setError(errorText(err)); }).finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [api, token]);
  async function submit(event) {
    event.preventDefault(); setError('');
    if (token && password !== repeat) { setError('Пароли не совпадают.'); return; }
    setBusy(true);
    try {
      if (token) { await api.completeAccessToken(token, password); setDone(true); setPassword(''); setRepeat(''); }
      else setSent(await api.requestPasswordReset(email.trim()));
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }
  const previewLink = sent?.reset?.link && /^https?:\/\//.test(sent.reset.link) ? sent.reset.link : '';
  return <div className="workspace-auth-page"><form className="workspace-auth" aria-label="Восстановление доступа" onSubmit={submit}>
    <div className="workspace-mark">OGE Tutor</div><h1>{done ? 'Пароль сохранён' : token ? info?.type === 'invite' ? 'Установка пароля' : 'Новый пароль' : 'Восстановление доступа'}</h1>
    {!token && !sent && <label>Email<input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>}
    {token && info && !done && <><p>{info.account.email}</p><label>Новый пароль<input required type="password" minLength="6" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label><label>Повтор пароля<input required type="password" minLength="6" autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} /></label></>}
    {sent && <p role="status">Если аккаунт существует, ссылка восстановления отправлена.</p>}{previewLink && <a href={previewLink}>Открыть ссылку восстановления</a>}
    {error && <p role="alert" className="workspace-error">{error}</p>}
    {!sent && !done && (!token || info) && <button type="submit" disabled={busy}>{busy ? 'Подождите…' : token ? 'Сохранить пароль' : 'Восстановить доступ'}</button>}
    <button type="button" disabled={busy} onClick={onClose}>Ко входу</button>
  </form></div>;
}

export default function AccountPanel({ api, me, onSaved, onPasswordChanged, onAccessError }) {
  const [name, setName] = useState(me.displayName);
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function perform(operation) {
    setBusy(true); setError(''); setSaved(false);
    try { await operation(); }
    catch (err) { setError(errorText(err)); onAccessError(err); }
    finally { setBusy(false); }
  }
  return <main className="workspace-content account-panel"><h1>Аккаунт</h1><p>{me.email}</p>
    <form className="course-inline-form" onSubmit={e => { e.preventDefault(); perform(async () => { const result = await api.updateMe(me, name.trim()); onSaved(result.item); setSaved(true); }); }}>
      <label>Имя<input required minLength="2" maxLength="100" value={name} onChange={e => setName(e.target.value)} /></label><button type="submit" disabled={busy}>Сохранить имя</button>
    </form>{saved && <p role="status">Сохранено.</p>}
    <section className="course-section"><h2>Смена пароля</h2><form className="work-form" onSubmit={e => { e.preventDefault(); if (newPassword !== repeat) { setError('Пароли не совпадают.'); return; } perform(async () => { await api.changeAccountPassword({ currentPassword, newPassword }); setCurrent(''); setNew(''); setRepeat(''); onPasswordChanged(); }); }}>
      <label>Текущий пароль<input required type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrent(e.target.value)} /></label>
      <label>Новый пароль<input required type="password" minLength="6" maxLength="72" autoComplete="new-password" value={newPassword} onChange={e => setNew(e.target.value)} /></label>
      <label>Повтор пароля<input required type="password" minLength="6" maxLength="72" autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} /></label>
      <button type="submit" disabled={busy}>Сменить пароль и завершить сессии</button></form></section>
    {error && <p role="alert" className="workspace-error">{error}</p>}
  </main>;
}
