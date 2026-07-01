/*
 * OGE Tutor App — shared UI primitives.
 * These components keep the app visually consistent and mobile-like.
 */
import React from 'react';
import { getStoredApiToken } from '../api/authToken.js';
import { STUDENT_ROUTE_LABELS, TEACHER_ROUTE_LABELS, statusIcon, statusLabel, statusTone } from '../api/contracts.js';
import { getAvatarIcon } from './avatarCatalog.js';
import { materialDisplayTitle, materialIcon, materialSourceText } from './formatters.js';

export const NAV_ICONS = {
  'teacher.home': '🏠',
  'teacher.students': '👥',
  'teacher.lessons': '📅',
  'teacher.homework': '📝',
  'teacher.materials': '📚',
  'teacher.profile': '👤',
  'student.home': '🏠',
  'student.homework': '📝',
  'student.lessons': '📅',
  'student.materials': '📚',
  'student.progress': '▦',
  'student.profile': '👤',
};

export function navLabel(item) {
  return TEACHER_ROUTE_LABELS[item] || STUDENT_ROUTE_LABELS[item] || item;
}

export function cx(...items) {
  return items.filter(Boolean).join(' ');
}

export function MobileFrame({ children }) {
  return (
    <div className="mobile-frame">
      <div className="device-bar"><div className="device-speaker" /></div>
      {children}
    </div>
  );
}

export function AppShell({ navItems, active, onNavigate, children }) {
  return (
    <div className="app-shell">
      <main className="screen-scroll">{children}</main>
      <nav className="bottom-nav" aria-label="Основная навигация">
        {navItems.map((item) => (
          <button type="button" key={item} onClick={() => onNavigate(item)} className={cx('nav-btn', active === item && 'active')}>
            <span className="nav-icon" aria-hidden="true">{NAV_ICONS[item] || '•'}</span>
            <span className="nav-label">{navLabel(item)}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export function Header({ title, subtitle, onBack, right }) {
  return (
    <header className="header">
      {onBack ? <BackButton onClick={onBack} /> : null}
      <div className="header-row">
        <div className="header-main">
          <h1 className="title">{title}</h1>
          {subtitle ? <p className="subtitle">{subtitle}</p> : null}
        </div>
        {right ? <div className="header-right">{right}</div> : null}
      </div>
    </header>
  );
}

export function BackButton({ onClick }) {
  return (
    <button type="button" className="back-btn" onClick={onClick} aria-label="Назад">
      <svg width="25" height="25" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M19 12H7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M12 7L7 12L12 17" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export function Card({ children, className = '' }) {
  return <div className={cx('card', className)}>{children}</div>;
}

export function Section({ title, action, onAction }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {action ? <button type="button" className="link-btn" onClick={onAction}>{action}</button> : null}
    </div>
  );
}

export function Button({ children, variant = 'primary', onClick, type = 'button', disabled }) {
  return <button type={type} disabled={disabled} onClick={onClick} className={cx('btn', `btn-${variant}`)}>{children}</button>;
}

export function Field({ label, value, onChange, placeholder, type = 'text', disabled }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input className="input" type={type} value={value} onChange={(event) => onChange?.(event.target.value)} placeholder={placeholder} disabled={disabled} />
    </label>
  );
}

export function TextArea({ label, value, onChange, placeholder }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <textarea className="textarea" value={value} onChange={(event) => onChange?.(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

export function SelectField({ label, value, onChange, options }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select className="select" value={value} onChange={(event) => onChange?.(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

export function Badge({ children, tone = 'blue' }) {
  return <span className={cx('badge', `badge-${tone}`)} title={typeof children === 'string' ? children : undefined}>{children}</span>;
}

export function toneByStatus(status) {
  return statusTone(status);
}

export function iconByStatus(status) {
  return statusIcon(status);
}

export function toneClass(tone) {
  return {
    blue: 'soft-blue',
    green: 'soft-green',
    amber: 'soft-amber',
    red: 'soft-red',
    rose: 'soft-red',
    violet: 'soft-violet',
    emerald: 'soft-green',
    slate: 'soft-slate',
  }[tone] || 'soft-blue';
}

export function solidBg(bg) {
  return `bg-${bg || 'blue'}`;
}

export function Avatar({ avatarId = 'bear', bg = 'blue', size = 'md' }) {
  const avatar = getAvatarIcon(avatarId);
  return <div className={cx('avatar', `avatar-${size}`, toneClass(bg))}>{avatar?.icon || '👤'}</div>;
}

export function RowCard({ icon, iconTone = 'blue', title, subtitle, badge, badgeTone = 'blue', onClick }) {
  const content = (
    <>
      <div className={cx('row-icon', toneClass(iconTone))}>{icon}</div>
      <div className="row-main">
        <div className="row-title-line">
          <div className="row-title">{title}</div>
          {badge ? <Badge tone={badgeTone}>{statusLabel(badge)}</Badge> : null}
        </div>
        {subtitle ? <div className="row-subtitle">{subtitle}</div> : null}
      </div>
      <div className="row-arrow">›</div>
    </>
  );

  if (onClick) return <button type="button" className="row-card" onClick={onClick}>{content}</button>;
  return <div className="row-card">{content}</div>;
}

export function MaterialList({ items = [], onRemove, compact = false }) {
  if (!items.length) return <div className="empty-materials">Материалы пока не прикреплены.</div>;

  async function openMaterial(event, item) {
    const url = item?.url || '';
    if (!/\/files\/[^/]+\/download(?:$|\?)/.test(url)) return;
    event.preventDefault();
    const token = getStoredApiToken();
    const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) return;
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    window.open(objectUrl, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }

  return (
    <div className={cx('material-preview-list', compact && 'compact')}>
      {items.map((item, index) => (
        <div className="material-preview-row" key={item.localId || item.id || `${item.type}-${item.title}-${item.url || ''}-${index}`}>
          <div className={cx('material-preview-icon', `material-${item.type || 'file'}`)}>{materialIcon(item.type)}</div>
          <div className="material-preview-main">
            <div className="material-preview-title" title={materialDisplayTitle(item)}>{materialDisplayTitle(item)}</div>
            <div className="material-preview-source" title={`${materialSourceText(item)}${item.url ? ` · ${item.url}` : ''}`}>{materialSourceText(item)}{item.url ? ` · ${item.url}` : ''}</div>
          </div>
          {onRemove ? (
            <button type="button" className="material-remove-btn" onClick={() => onRemove(index)}>Убрать</button>
          ) : item.url ? (
            <a className="material-open-btn" href={item.url} target="_blank" rel="noreferrer" onClick={(event) => openMaterial(event, item)}>Открыть</a>
          ) : null}
        </div>
      ))}
    </div>
  );
}



export function EmptyState({ title, text }) {
  return (
    <Card>
      <strong>{title}</strong>
      <p className="subtitle">{text}</p>
    </Card>
  );
}
