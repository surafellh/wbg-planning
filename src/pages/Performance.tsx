import { useState } from 'react';
import { useData, byId, ROLE_NAME, type DB, type Row } from '../lib/data';
import { orgScore, personResult, bandOf, pct, fmt, orgShare } from '../lib/calc';
import { Page, Cmd, Ring, Bar, Pill, Empty } from '../lib/ui';

const PERF_HELP = (db: DB) => { const w = db.settings.org_weights || {}; return <>
  <h3>Organisation first</h3><p>Performance is measured on the <b>organisation</b> first and the person second. Every unit, department and division gets a score: the average of its own objectives' scores. A level with no objectives of its own takes the score of the level above.</p>
  <h3>A person's result</h3><p>Result = <b>organisation share × the score of the organisation they lead or sit in</b> + <b>(1 − organisation share) × their personal part</b>.</p>
  <ul><li>Organisation share: unit head {w.unit}% · department head {w.department}% · division head {w.division}% · team member {w.employee}%. The more people you lead, the more of your result is your organisation's result. Group Strategy can change these in Settings → Rules.</li>
    <li>Personal part: the agreed deliverables, weighted (weights add up to 100%), counted when accepted. Leaders with no deliverables are measured on the key results they own.</li></ul>
  <h3>Bands and HR</h3><p>Achieved ≥100% · Well performed 75–99% · Partially achieved 40–74% · Under performed below 40%. Results are shown out of 100% here and converted to {db.settings.hr_scale?.max ?? 70}% when sent to HR (result × 0.{db.settings.hr_scale?.max ?? 70}).</p></>; };

function OrgNode({ db, id, depth }: { db: DB; id: string; depth: number }) {
  const u = byId(db.org_units, id); const [open, setOpen] = useState(depth < 1); if (!u) return null;
  const kids = db.org_units.filter(c => c.parent_id === id).sort((a, b) => a.sort - b.sort);
  const own = db.objectives.filter(o => o.org_unit_id === id).length;
  const head = db.positions.find(p => p.org_unit_id === id && p.level !== 'employee');
  return <div style={{ marginLeft: depth * 18 }}>
    <div className="orgn"><Ring p={orgScore(db, id)} size={38} /><div className="on">{u.name}<div className="note">{head ? (head.holder_name || 'Vacant') + ' · ' : ''}{own ? `${own} objective${own > 1 ? 's' : ''}` : 'no objectives of its own — takes the level above'}</div></div>
      {kids.length > 0 && <button className="btn sm" onClick={() => setOpen(!open)}>{open ? 'Hide' : `${kids.length} below`}</button>}</div>
    {open && kids.length > 0 && <div className="org" style={{ marginTop: 6 }}>{kids.map(k => <OrgNode key={k.id} db={db} id={k.id} depth={depth + 1} />)}</div>}
  </div>;
}

export function PerfOrg() {
  const { db, unit } = useData(); if (!db || !unit) return null;
  return <Page title="Organisation" desc="Scores for the unit, its departments and divisions — the first half of everyone's result." help={PERF_HELP(db)}>
    <Cmd /><div className="org"><OrgNode db={db} id={unit} depth={0} /></div>
  </Page>;
}

export function PerfPeople({ mine }: { mine?: boolean }) {
  const { db, unit, me } = useData(); const [q, setQ] = useState(''); if (!db || !unit || !me) return null;
  const list: Row[] = mine ? [me] : db.positions.filter(p => p.unit_id === unit && (p.holder_name || p.level !== 'employee')).filter(p => !q || (p.holder_name || '').toLowerCase().includes(q.toLowerCase()) || p.title.toLowerCase().includes(q.toLowerCase()));
  const rows = list.map(p => ({ p, r: personResult(db, p) })).sort((a, b) => (b.r.s - a.r.s) || ((b.r.R ?? -1) - (a.r.R ?? -1)));
  if (mine) { const { p, r } = rows[0]; const org = byId(db.org_units, p.org_unit_id);
    return <Page title="My performance" desc="Your result: your organisation's score plus your own deliverables." help={PERF_HELP(db)}>
      <div className="g3" style={{ marginBottom: 14 }}>
        <div className="tile"><div className="tv">{pct(r.R)}</div><div className="tl">My result</div><div className="ts">{bandOf(r.R, db)} · to HR {r.hr == null ? '—' : fmt(r.hr, 1) + '%'}</div></div>
        <div className="tile"><div className="tv">{pct(r.org)}</div><div className="tl">{org?.name} score × {Math.round(r.s * 100)}%</div></div>
        <div className="tile"><div className="tv">{pct(r.personal)}</div><div className="tl">My part × {Math.round((1 - r.s) * 100)}%</div><div className="ts">{r.basis}</div></div>
      </div><p className="note">Your deliverables are in Work → Month.</p></Page>; }
  return <Page title="People" desc="Each person's result: organisation share plus personal part." help={PERF_HELP(db)}>
    <Cmd right={<input type="text" placeholder="Find a person" value={q} onChange={e => setQ(e.target.value)} />} />
    {!rows.length ? <Empty>No people in this unit.</Empty> : <div className="tw"><table className="t"><thead><tr><th>Person</th><th>Organisation</th><th className="n">Org share</th><th className="n">Org score</th><th className="n">Personal</th><th>Result</th><th>Band</th><th className="n">To HR</th></tr></thead><tbody>
      {rows.map(({ p, r }) => <tr key={p.id}><td><b>{p.holder_name || 'Vacant'}</b><div className="note">{p.title} · {ROLE_NAME[p.role as keyof typeof ROLE_NAME]}</div></td><td>{byId(db.org_units, p.org_unit_id)?.name}</td><td className="n">{Math.round(orgShare(db, p.level) * 100)}%</td>
        <td className="n">{pct(r.org)}</td><td className="n" title={r.basis}>{pct(r.personal)}</td><td><Bar p={r.R} /> {pct(r.R)}</td><td><Pill tone={r.R == null ? 'none' : r.R >= .75 ? 'good' : r.R >= .4 ? 'warn' : 'bad'}>{bandOf(r.R, db)}</Pill></td><td className="n">{r.hr == null ? '—' : fmt(r.hr, 1) + '%'}</td></tr>)}
    </tbody></table></div>}
  </Page>;
}
