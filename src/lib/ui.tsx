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

/** Unit selector for Group roles. With `allowAll` (pages that can show the whole group) it also offers "All units — Group view". */
export function UnitPicker({ allowAll }: { allowAll?: boolean } = {}) {
  const { can, units, unit, setUnit, allUnits, setAllUnits } = useData();
  if (!can('seeGroup')) return null;
  const v = allowAll && allUnits ? '__all' : unit || '';
  return <label className="scope"><span>{allowAll ? 'Viewing' : 'Unit'}</span><select value={v} onChange={e => { if (e.target.value === '__all') setAllUnits(true); else { setUnit(e.target.value); if (allowAll) setAllUnits(false); } }} aria-label="Unit">
    {allowAll && <option value="__all">All units — Group view</option>}{allowAll && <option disabled>──────────</option>}{[['business', 'Business units'], ['function', 'Corporate functions']].map(([k, l]) => { const us = units.filter(u => (u.unit_type === 'business' ? 'business' : 'function') === k); return us.length ? <optgroup key={k} label={l}>{us.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</optgroup> : null; })}</select></label>;
}

export function Cmd({ children, right }: { children?: ReactNode; right?: ReactNode }) { return <div className="cmdbar"><UnitPicker />{children}<span className="sp" />{right}</div>; }

export function Empty({ children }: { children: ReactNode }) { return <div className="empty">{children}</div>; }

export function NumIn({ value, onChange, w = 90, disabled }: { value: number | null | undefined; onChange: (v: number | null) => void; w?: number; disabled?: boolean }) {
  const [t, setT] = useState(value == null ? '' : String(value));
  useEffect(() => { setT(value == null ? '' : String(value)); }, [value]);
  return <input className="num" style={{ width: w }} inputMode="decimal" value={t} disabled={disabled} onChange={e => setT(e.target.value)} onBlur={() => { const v = t.trim() === '' ? null : Number(t.replace(/,/g, '')); if (v == null || !isNaN(v)) onChange(v); else setT(value == null ? '' : String(value)); }} />;
}

/** Floating, non-blocking help panel. */
export function HelpFloat({ title = 'How this works', children, onClose }: { title?: string; children: ReactNode; onClose: () => void }) {
  const [min, setMin] = useState(false);
  return <div className={'helpfloat' + (min ? ' min' : '')} role="complementary" aria-label={title}><div className="hh"><b>{title}</b><button className="btn sm" onClick={() => setMin(!min)}>{min ? 'Open' : 'Minimise'}</button><button className="x" onClick={onClose} aria-label="Close">×</button></div><div className="hb helpb">{children}</div></div>;
}
/** Page frame: title, one-line description, and a floating "How this works" panel. */
export function Page({ title, desc, help, children, actions }: { title: string; desc?: string; help?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { document.title = title + ' · WBG Planning'; }, [title]);
  return <>
    <header className="hdr"><div style={{ flex: 1 }}><h1>{title}</h1>{(desc || help) && <p>{desc}{help && <> <button className="linkbtn" onClick={() => setOpen(true)}>How this works</button></>}</p>}</div>{actions}</header>
    <main>{children}</main>
    {open && <HelpFloat onClose={() => setOpen(false)}>{help}</HelpFloat>}
  </>;
}
/** "How this works" link for pages that have their own header (Work and Insights pages). */
export function HowItWorks({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <> <button className="linkbtn" onClick={() => setOpen(true)}>How this works</button>{open && <HelpFloat onClose={() => setOpen(false)}>{children}</HelpFloat>}</>;
}
/** Department / division filter inside the selected unit. */
export function OrgFilter({ value, onChange, label = 'Whole unit' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const { db, unit } = useData(); if (!db || !unit) return null;
  const walk = (id: string, d: number, out: { id: string; name: string }[]) => { db.org_units.filter(o => o.parent_id === id).sort((a, b) => a.sort - b.sort).forEach(o => { out.push({ id: o.id, name: '\u00a0\u00a0'.repeat(d) + o.name }); walk(o.id, d + 1, out); }); return out; };
  const list = walk(unit, 0, []);
  return <select value={value} onChange={e => onChange(e.target.value)} aria-label="Department or division"><option value="">{label}</option>{list.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>;
}

/* ---------------- periods ---------------- */
import { currentPeriod, periodOptions, periodLabel, type Period, type PT } from './calc';
export function usePeriod(def: PT = 'Q'): [Period, (p: Period) => void] {
  const [p, setP] = useState<Period>(() => { try { const s = JSON.parse(localStorage.getItem('wbg.period') || 'null'); if (s && s.t && s.n) return s; } catch { /* ignore */ } return currentPeriod(def); });
  const set = (x: Period) => { setP(x); try { localStorage.setItem('wbg.period', JSON.stringify(x)); } catch { /* ignore */ } };
  return [p, set];
}
export function PeriodPicker({ value, onChange, types = ['M', 'Q', 'H', 'Y'] }: { value: Period; onChange: (p: Period) => void; types?: PT[] }) {
  const names: Record<PT, string> = { M: 'Month', Q: 'Quarter', H: 'Half', Y: 'Year' };
  return <div className="row" style={{ gap: 6 }}>
    <Seg value={value.t} options={types.map(t => [t, names[t]] as [PT, string])} onChange={t => onChange(currentPeriod(t))} />
    {value.t !== 'Y' && <select aria-label="Period" value={value.n} onChange={e => onChange({ t: value.t, n: Number(e.target.value) })}>{periodOptions(value.t).map(o => <option key={o.n} value={o.n}>{periodLabel(o)}{o.n === currentPeriod(value.t).n ? ' (now)' : ''}</option>)}</select>}
  </div>;
}

/* ---------------- charts (plain SVG; hover shows values) ---------------- */
export type Series = { name: string; values: (number | null)[]; color: string; dashed?: boolean };
export function LineChart({ labels, series, height = 180, fmtY = (v: number) => String(Math.round(v)), pctAxis }: { labels: string[]; series: Series[]; height?: number; fmtY?: (v: number) => string; pctAxis?: boolean }) {
  const [hi, setHi] = useState<number | null>(null);
  const W = 640, H = height, L = 52, R = 12, T = 12, B = 24;
  const all = series.flatMap(s => s.values.filter(v => v != null) as number[]);
  const max = pctAxis ? Math.max(1, ...all) : Math.max(1, ...all) * 1.08, min = 0;
  const x = (i: number) => L + (labels.length <= 1 ? 0 : i * (W - L - R) / (labels.length - 1));
  const y = (v: number) => T + (H - T - B) * (1 - (v - min) / (max - min || 1));
  const ticks = [0, .25, .5, .75, 1].map(f => min + f * (max - min));
  return <div className="chart"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map(s => s.name).join(', ')} onMouseLeave={() => setHi(null)}>
    {ticks.map((t, i) => <g key={i}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" /><text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{fmtY(t)}</text></g>)}
    {labels.map((l, i) => <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--muted)">{l}</text>)}
    {series.map(s => { const pts = s.values.map((v, i) => v == null ? null : [x(i), y(v)]).filter(Boolean) as number[][]; return <g key={s.name}>
      <polyline fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '5 4' : undefined} points={pts.map(p => p.join(',')).join(' ')} />
      {s.values.map((v, i) => v == null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={hi === i ? 4.5 : 3} fill={s.color} stroke="var(--panel)" strokeWidth="2" />)}</g>; })}
    {labels.map((_, i) => <rect key={i} x={x(i) - (W - L - R) / Math.max(1, labels.length - 1) / 2} y={T} width={(W - L - R) / Math.max(1, labels.length - 1)} height={H - T - B} fill="transparent" onMouseEnter={() => setHi(i)} />)}
    {hi != null && <line x1={x(hi)} x2={x(hi)} y1={T} y2={H - B} stroke="var(--line2)" />}
  </svg>
    <div className="legend">{series.map(s => <span key={s.name}><i style={{ background: s.color }} />{s.name}{hi != null && s.values[hi] != null ? ': ' + fmtY(s.values[hi] as number) : ''}</span>)}{hi != null && <b>{labels[hi]}</b>}</div></div>;
}
export function BarChart({ labels, series, height = 190, fmtY = (v: number) => String(Math.round(v)) }: { labels: string[]; series: Series[]; height?: number; fmtY?: (v: number) => string }) {
  const [hi, setHi] = useState<number | null>(null);
  const W = 640, H = height, L = 52, R = 8, T = 10, B = 24;
  const all = series.flatMap(s => s.values.filter(v => v != null) as number[]); const max = Math.max(1, ...all) * 1.08;
  const gw = (W - L - R) / Math.max(1, labels.length), bw = Math.max(3, Math.min(22, (gw - 6) / series.length - 2));
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  return <div className="chart"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map(s => s.name).join(', ')} onMouseLeave={() => setHi(null)}>
    {[0, .25, .5, .75, 1].map((f, i) => <g key={i}><line x1={L} x2={W - R} y1={y(f * max)} y2={y(f * max)} stroke="var(--line)" /><text x={L - 6} y={y(f * max) + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{fmtY(f * max)}</text></g>)}
    {labels.map((l, i) => { const x0 = L + i * gw + (gw - series.length * (bw + 2)) / 2; return <g key={i} onMouseEnter={() => setHi(i)}>
      <rect x={L + i * gw} y={T} width={gw} height={H - T - B} fill={hi === i ? 'var(--sunk)' : 'transparent'} />
      {series.map((s, j) => { const v = s.values[i]; if (v == null) return null; const h = Math.max(0, (H - B) - y(Math.max(0, v))); return <rect key={j} x={x0 + j * (bw + 2)} y={(H - B) - h} width={bw} height={h} rx={Math.min(4, bw / 2)} fill={s.color} opacity={s.dashed ? .45 : 1} />; })}
      <text x={L + i * gw + gw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--muted)">{l.length > 12 ? l.slice(0, 11) + '…' : l}</text></g>; })}
  </svg>
    <div className="legend">{series.map(s => <span key={s.name}><i style={{ background: s.color, opacity: s.dashed ? .45 : 1 }} />{s.name}{hi != null && s.values[hi] != null ? ': ' + fmtY(s.values[hi] as number) : ''}</span>)}{hi != null && <b>{labels[hi]}</b>}</div></div>;
}
/** Horizontal stacked bar of status counts. */
export function StatusStack({ counts, compact }: { counts: { label: string; n: number; tone: string }[]; compact?: boolean }) {
  const tot = counts.reduce((s, c) => s + c.n, 0) || 1;
  const bar = <div className="stack-bar">{counts.filter(c => c.n).map(c => <i key={c.label} className={c.tone} style={{ width: (c.n / tot * 100) + '%' }} title={`${c.label}: ${c.n}`} />)}</div>;
  if (compact) return <div title={counts.map(c => `${c.label}: ${c.n}`).join(' · ')}>{bar}<div className="mini" style={{ marginTop: 3 }}>{counts.slice(0, 3).map(c => `${c.n} ${c.label.toLowerCase()}`).join(' · ')}</div></div>;
  return <div>{bar}
    <div className="legend">{counts.map(c => <span key={c.label}><i className={c.tone} />{c.label} {c.n}</span>)}</div></div>;
}
export function StatePill({ s }: { s: { label: string; tone: string } }) { return <Pill tone={s.tone}>{s.label}</Pill>; }
