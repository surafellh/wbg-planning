import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData, useTerms, useWindows, byId } from './data';

/** Search everything: objectives, key results, departments, people, pages (Ctrl+K). */
export function Search() {
  const { db, setUnit } = useData(); const { t } = useTerms(); const W = useWindows(); const nav = useNavigate();
  const [open, setOpen] = useState(false); const [q, setQ] = useState(''); const [i, setI] = useState(0);
  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o); } if (e.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
  const items = useMemo(() => {
    if (!db) return [] as { k: string; label: string; sub: string; go: () => void }[];
    const out: { k: string; label: string; sub: string; go: () => void }[] = [];
    const pages: [string, string][] = [['Today', '/today'], ['Our strategy', '/strategy'], ['Plan', '/plan'], ['Record', '/record'], ['Inbox', '/inbox'], ['My performance', '/me'], ...(W.insights ? [['Overview', '/insights/overview'], ['Alignment', '/insights/alignment'], ['Reports', '/insights/reports'], ['Who is doing what', '/insights/people-work']] as [string, string][] : []), ...(W.studio ? [['Process monitor', '/studio/monitor'], ['Objective planner', '/studio/okr'], ['Revenue plan', '/studio/revenue'], ['Budget', '/studio/budget'], ['Resources', '/studio/resources'], ['Rescope', '/studio/rescope']] as [string, string][] : [])];
    pages.forEach(([l, to]) => out.push({ k: 'Page', label: l, sub: '', go: () => nav(to) }));
    db.objectives.filter(o => o.status !== 'Archived').forEach(o => out.push({ k: t('objective'), label: o.text, sub: byId(db.org_units, o.org_unit_id)?.name || '', go: () => { setUnit(o.unit_id); nav('/strategy?o=' + o.id); } }));
    db.key_results.forEach(k => { const o = byId(db.objectives, k.objective_id); if (!o || o.status === 'Archived') return; out.push({ k: t('key_result'), label: k.title, sub: o.text, go: () => { setUnit(o.unit_id); nav('/strategy?o=' + o.id); } }); });
    db.org_units.filter(u => u.kind !== 'group').forEach(u => out.push({ k: u.kind === 'unit' ? 'Unit' : u.kind === 'department' ? 'Department' : 'Division', label: u.name, sub: byId(db.org_units, u.unit_id)?.name || '', go: () => { setUnit(u.unit_id || u.id); nav(W.insights ? '/insights/performance?org=' + u.id : '/strategy'); } }));
    if (W.insights) db.positions.filter(p => p.holder_name).forEach(p => out.push({ k: 'Person', label: p.holder_name, sub: p.title, go: () => { if (p.unit_id) setUnit(p.unit_id); nav('/insights/people-work?q=' + encodeURIComponent(p.holder_name)); } }));
    return out;
  }, [db, t, W.insights, W.studio, nav, setUnit]);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const res = words.length ? items.filter(x => words.every(w => (x.label + ' ' + x.sub + ' ' + x.k).toLowerCase().includes(w))).slice(0, 40) : items.filter(x => x.k === 'Page');
  return <>
    <button className="searchbtn" onClick={() => setOpen(true)}>⌕ Search<kbd>Ctrl K</kbd></button>
    {open && <div className="spal" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}><div className="box" role="dialog" aria-label="Search">
      <input autoFocus placeholder={`Search ${t('objective', true).toLowerCase()}, ${t('key_result', true).toLowerCase()}, departments, people, pages`} value={q} onChange={e => { setQ(e.target.value); setI(0); }}
        onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(res.length - 1, i + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(0, i - 1)); } if (e.key === 'Enter' && res[i]) { res[i].go(); setOpen(false); setQ(''); } }} />
      <div className="res">{res.map((x, n) => <div key={n} className={'it' + (n === i ? ' on' : '')} onMouseEnter={() => setI(n)} onClick={() => { x.go(); setOpen(false); setQ(''); }}><span className="k">{x.k}</span><span>{x.label}{x.sub && <small> · {x.sub}</small>}</span></div>)}{!res.length && <p className="note" style={{ padding: 14 }}>Nothing found.</p>}</div>
    </div></div>}
  </>;
}
