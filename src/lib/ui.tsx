import { useEffect, useState, type ReactNode } from 'react';
import { useData } from './data';
import { pct } from './calc';

export function Pill({ tone = 'none', children }: { tone?: string; children: ReactNode }) { return <span className={'pill ' + tone}>{children}</span>; }
export function Bar({ p, tone }: { p: number | null; tone?: string }) {
  const w = p == null ? 0 : Math.max(0, Math.min(1, p)) * 100;
  return <span className="bar" role="img" aria-label={pct(p)}><i style={{ width: w + '%' }} className={tone || (p == null ? '' : p >= .95 ? 'good' : p >= .7 ? 'warn' : 'bad')} /></span>;
}
export function Ring({ p, size = 44 }: { p: number | null; size?: number }) {
  const r = size / 2 - 4, c = 2 * Math.PI * r, v = p == null ? 0 : Math.max(0, Math.min(1, p));
  const tone = p == null ? 'var(--line2)' : p >= .95 ? 'var(--good)' : p >= .7 ? 'var(--warn)' : 'var(--bad)';
  return <svg width={size} height={size} className="ring" aria-label={pct(p)}><circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="4" />
    <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth="4" strokeDasharray={`${c * v} ${c}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    <text x="50%" y="54%" textAnchor="middle" dominantBaseline="middle" fontSize={size < 40 ? 9 : 11} fontWeight="700" fill="currentColor">{p == null ? '—' : Math.round(v * 100)}</text></svg>;
}
export function Tile({ v, label, tone, sub }: { v: ReactNode; label: string; tone?: string; sub?: ReactNode }) { return <div className={'tile ' + (tone || '')}><div className="tv">{v}</div><div className="tl">{label}</div>{sub && <div className="ts">{sub}</div>}</div>; }

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
    <div className="mh"><h3>{title}</h3><button className="x" onClick={onClose} aria-label="Close">×</button></div><div className="mb">{children}</div></div></div>;
}
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return <div className="overlay right" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><aside className="drawer" role="dialog" aria-label={title}>
    <div className="mh"><h3>{title}</h3><button className="x" onClick={onClose} aria-label="Close">×</button></div><div className="mb">{children}</div></aside></div>;
}

export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div className="seg" role="group">{options.map(([v, l]) => <button key={String(v)} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}</div>;
}

export function UnitPicker() {
  const { can, units, unit, setUnit } = useData();
  if (!can('seeGroup')) return null;
  return <label className="scope"><span>Unit</span><select value={unit || ''} onChange={e => setUnit(e.target.value)} aria-label="Unit">{units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>;
}

export function Cmd({ children, right }: { children?: ReactNode; right?: ReactNode }) { return <div className="cmdbar"><UnitPicker />{children}<span className="sp" />{right}</div>; }

export function Empty({ children }: { children: ReactNode }) { return <div className="empty">{children}</div>; }

export function NumIn({ value, onChange, w = 90, disabled }: { value: number | null | undefined; onChange: (v: number | null) => void; w?: number; disabled?: boolean }) {
  const [t, setT] = useState(value == null ? '' : String(value));
  useEffect(() => { setT(value == null ? '' : String(value)); }, [value]);
  return <input className="num" style={{ width: w }} inputMode="decimal" value={t} disabled={disabled} onChange={e => setT(e.target.value)} onBlur={() => { const v = t.trim() === '' ? null : Number(t.replace(/,/g, '')); if (v == null || !isNaN(v)) onChange(v); else setT(value == null ? '' : String(value)); }} />;
}

/** Page frame: title, one-line description, and a "How this works" panel. */
export function Page({ title, desc, help, children }: { title: string; desc?: string; help?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { document.title = title + ' · WBG Planning'; }, [title]);
  return <>
    <header className="hdr"><div><h1>{title}</h1>{desc && <p>{desc}{help && <> <button className="linkbtn" onClick={() => setOpen(true)}>How this works</button></>}</p>}</div></header>
    <main>{children}</main>
    {open && <Drawer title="How this works" onClose={() => setOpen(false)}><div className="helpb">{help}</div></Drawer>}
  </>;
}
