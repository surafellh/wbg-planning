import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useData, byId, ROLE_NAME, type DB, type Row } from '../lib/data';
import { orgScore, orgScoreOwn, personResult, bandOf, pct, fmt, orgShare, objScore, objState, krsOf, krState, delivScore, subtreeIds, periodLabel, MONTHS, curMonth, workStats, weekStart, ymd, type Period } from '../lib/calc';
import { Page, Cmd, Ring, Bar, Pill, Empty, Drawer, PeriodPicker, usePeriod, LineChart, StatusStack, StatePill } from '../lib/ui';
import { statusCounts, KrDrawer } from './Goals';

const PERF_HELP = (db: DB) => { const w = db.settings.org_weights || {}; return <>
  <h3>Organisation first</h3><p>Every unit, department and division gets a score: the average of its own objectives, each scored against the <b>target for the period you choose</b> (month, quarter, half or year — not the annual total). A level with no objectives of its own takes the score of the level above.</p>
  <h3>A person's result</h3><p>Result = organisation share × the score of the organisation they lead or sit in + (1 − share) × their personal part.</p>
  <ul><li>Organisation share: unit head {w.unit}% · department head {w.department}% · division head {w.division}% · team member {w.employee}%. Change these in Settings → Rules.</li>
    <li>Personal part: deliverables due in the period, weighted, counted when accepted (quality rating adjusts the credit). Leaders with no deliverables are measured on the key results they own.</li>
    <li>Monthly view: mostly deliverables — they are planned and accepted month by month.</li></ul>
  <h3>Bands and HR</h3><p>Achieved ≥100% · Well performed 75–99% · Partially achieved 40–74% · Under performed below 40%. Shown out of 100% here, sent to HR out of {db.settings.hr_scale?.max ?? 70}%.</p></>; };
const LVL: Record<string, string> = { unit: 'Unit', department: 'Department', division: 'Division', group: 'Group' };

function OrgDrawer({ id, p, onClose, onPerson }: { id: string; p: Period; onClose: () => void; onPerson: (pos: Row) => void }) {
  const { db } = useData(); const [kr, setKr] = useState<string | null>(null); if (!db) return null;
  const u = byId(db.org_units, id)!; const objs = db.objectives.filter(o => o.org_unit_id === id); const kids = db.org_units.filter(c => c.parent_id === id);
  const ids = subtreeIds(db, id); const pos = db.positions.filter(x => ids.has(x.org_unit_id) && x.holder_name); const posIds = new Set(pos.map(x => x.id));
  const ds = delivScore(db, posIds, p); const krs = objs.flatMap(o => krsOf(db, o.id)); const ws = workStats(db, posIds, ymd(weekStart(new Date())));
  const trend = Array.from({ length: curMonth() }, (_, i) => orgScore(db, id, { t: 'M', n: i + 1 }));
  const qtrend = [1, 2, 3, 4].map(q => q <= Math.ceil(curMonth() / 3) ? orgScore(db, id, { t: 'Q', n: q }) : null);
  return <Drawer title={u.name} onClose={onClose}>
    <div className="row"><Ring p={orgScore(db, id, p)} size={64} /><div><b>{periodLabel(p)} score {pct(orgScore(db, id, p))}</b><div className="note">{LVL[u.kind]} · {objs.length ? `${objs.length} objectives of its own` : 'takes the score of the level above'}</div></div></div>
    <div className="g3"><div className="tile"><div className="tv">{ds.due ? `${ds.accepted}/${ds.due}` : '—'}</div><div className="tl">Deliverables accepted</div></div><div className="tile"><div className="tv">{pct(ws.completion)}</div><div className="tl">This week's work</div></div><div className="tile"><div className="tv">{pos.length}</div><div className="tl">People</div></div></div>
    {krs.length > 0 && <div><h4>Key results · {periodLabel(p)}</h4><StatusStack counts={statusCounts(db, krs, p)} /></div>}
    <div><h4>Trend</h4><LineChart labels={MONTHS.slice(0, curMonth())} series={[{ name: 'Monthly', values: trend.map(v => v == null ? null : v * 100), color: 'var(--accent)' }]} fmtY={v => Math.round(v) + '%'} height={140} />
      <div className="mini">Quarters: {qtrend.map((v, i) => `Q${i + 1} ${pct(v)}`).join(' · ')}</div></div>
    <div><h4>Objectives</h4>{objs.length ? objs.map(o => <div key={o.id} className="lg"><div className="row"><Ring p={objScore(db, o, p)} size={32} /><b style={{ flex: 1 }}>{o.text}</b><StatePill s={objState(db, o, p)} /></div>
      {krsOf(db, o.id).map(k => { const s = krState(db, k, p); return <div key={k.id} className="row click" style={{ paddingLeft: 40 }} onClick={() => setKr(k.id)}><span className="mini" style={{ flex: 1 }}>{k.title}</span><Bar p={s.progress} /><span className="mini">{pct(s.progress)}</span></div>; })}</div>) : <p className="note">None of its own.</p>}</div>
    {kids.length > 0 && <div><h4>Below</h4>{kids.map(c => <div key={c.id} className="lg row"><span style={{ flex: 1 }}>{c.name}</span><Bar p={orgScore(db, c.id, p)} /><span className="mini">{pct(orgScore(db, c.id, p))}</span></div>)}</div>}
    <div><h4>People</h4>{pos.slice(0, 40).map(x => { const r = personResult(db, x, p); return <div key={x.id} className="lg row click" onClick={() => onPerson(x)}><span style={{ flex: 1 }}>{x.holder_name}<div className="mini">{x.title}</div></span><Bar p={r.R} /><span className="mini">{pct(r.R)}</span></div>; })}</div>
    {kr && <KrDrawer id={kr} p={p} onClose={() => setKr(null)} />}
  </Drawer>;
}

export function PersonDrawer({ pos, p, onClose }: { pos: Row; p: Period; onClose: () => void }) {
  const { db } = useData(); const [kr, setKr] = useState<string | null>(null); if (!db) return null;
  const r = personResult(db, pos, p); const org = byId(db.org_units, pos.org_unit_id); const ms = p.t === 'M' ? [p.n] : undefined;
  const dels = db.deliverables.filter(d => d.owner_position_id === pos.id && d.status !== 'removed' && (ms ? ms.includes(d.month) : true)).sort((a, b) => a.month - b.month);
  const krs = db.key_results.filter(k => k.owner_position_id === pos.id);
  const trend = Array.from({ length: curMonth() }, (_, i) => personResult(db, pos, { t: 'M', n: i + 1 }).R);
  const acts = db.activities.filter(a => a.owner_position_id === pos.id); const done = acts.filter(a => a.status === 'Done').length;
  return <Drawer title={pos.holder_name || pos.title} onClose={onClose}>
    <div className="note">{pos.title} · {ROLE_NAME[pos.role as keyof typeof ROLE_NAME]} · {org?.name}</div>
    <div className="g3"><div className="tile"><div className="tv">{pct(r.R)}</div><div className="tl">{periodLabel(p)} result</div><div className="ts">{bandOf(r.R, db)} · HR {r.hr == null ? '—' : fmt(r.hr, 1) + '%'}</div></div>
      <div className="tile"><div className="tv">{pct(r.org)}</div><div className="tl">{org?.name} × {Math.round(r.s * 100)}%</div></div>
      <div className="tile"><div className="tv">{pct(r.personal)}</div><div className="tl">Personal × {Math.round((1 - r.s) * 100)}%</div><div className="ts">{r.basis}</div></div></div>
    <div><h4>Result by month</h4><LineChart labels={MONTHS.slice(0, curMonth())} series={[{ name: 'Result', values: trend.map(v => v == null ? null : v * 100), color: 'var(--accent)' }]} fmtY={v => Math.round(v) + '%'} height={130} /></div>
    <div><h4>Deliverables{ms ? ` · ${MONTHS[p.n - 1]}` : ''}</h4>{dels.length ? <div className="tw"><table className="t"><tbody>{dels.map(d => <tr key={d.id}><td>{MONTHS[d.month - 1]}</td><td>{d.title}</td><td className="n">{d.weight != null ? d.weight + '%' : ''}</td><td><Pill tone={d.status === 'accepted' ? 'good' : d.status === 'returned' ? 'bad' : d.status === 'done' ? 'warn' : 'none'}>{d.status}</Pill>{d.rating ? ' ' + '★'.repeat(d.rating) : ''}</td></tr>)}</tbody></table></div> : <p className="note">No deliverables.</p>}</div>
    {krs.length > 0 && <div><h4>Key results owned</h4>{krs.map(k => { const s = krState(db, k, p); return <div key={k.id} className="lg row click" onClick={() => setKr(k.id)}><span style={{ flex: 1 }}>{k.title}</span><Bar p={s.progress} /><StatePill s={s} /></div>; })}</div>}
    <div className="mini">Activities logged: {acts.length} · done {done}</div>
    {kr && <KrDrawer id={kr} p={p} onClose={() => setKr(null)} />}
  </Drawer>;
}

function OrgNode({ db, id, depth, p, onOpen }: { db: DB; id: string; depth: number; p: Period; onOpen: (id: string) => void }) {
  const u = byId(db.org_units, id); const [open, setOpen] = useState(depth < 1); if (!u) return null;
  const kids = db.org_units.filter(c => c.parent_id === id).sort((a, b) => a.sort - b.sort);
  const own = db.objectives.filter(o => o.org_unit_id === id); const head = db.positions.find(x => x.org_unit_id === id && x.level !== 'employee');
  const ids = subtreeIds(db, id); const posIds = new Set(db.positions.filter(x => ids.has(x.org_unit_id)).map(x => x.id)); const ds = delivScore(db, posIds, p);
  const ownSc = orgScoreOwn(db, id, p); const sc = orgScore(db, id, p); const st = own.length ? statusCounts(db, own.flatMap(o => krsOf(db, o.id)), p) : null;
  return <div style={{ marginLeft: depth * 20 }}>
    <div className="orgn click" onClick={() => onOpen(id)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpen(id); }}>
      {kids.length > 0 ? <button className="btn sm" onClick={e => { e.stopPropagation(); setOpen(!open); }} aria-label={open ? 'Collapse' : 'Expand'}>{open ? '▾' : '▸'}</button> : <span style={{ width: 30 }} />}
      <Ring p={sc} size={40} /><div className="on">{u.name} <span className="lvl">{LVL[u.kind]}</span><div className="note">{head ? (head.holder_name || 'Vacant') + ' · ' : ''}{own.length ? `${own.length} objectives${ownSc == null ? ' · no progress recorded yet — shows the level above' : ''}` : 'no objectives of its own — shows the level above'}{ds.due ? ` · deliverables ${ds.accepted}/${ds.due}` : ''}</div></div>
      <div style={{ width: 220 }} className="hide-s">{st ? <StatusStack counts={st} compact /> : null}</div>
    </div>
    {open && kids.length > 0 && <div className="org" style={{ marginTop: 6 }}>{kids.map(k => <OrgNode key={k.id} db={db} id={k.id} depth={depth + 1} p={p} onOpen={onOpen} />)}</div>}
  </div>;
}

export function PerfOrg() {
  const { db, unit } = useData(); const [p, setP] = usePeriod(); const [open, setOpen] = useState<string | null>(null); const [person, setPerson] = useState<Row | null>(null);
  if (!db || !unit) return null;
  const all = Array.from(subtreeIds(db, unit)).map(id => byId(db.org_units, id)!).filter(u => u.kind !== 'unit');
  const ranked = all.map(u => ({ u, s: orgScoreOwn(db, u.id, p) })).filter(x => x.s != null).sort((a, b) => (b.s ?? -1) - (a.s ?? -1));
  return <Page title="Organisation" desc="Scores for the unit, its departments and divisions — click any one for its objectives, people and trend." help={PERF_HELP(db)}>
    <Cmd right={<PeriodPicker value={p} onChange={setP} />} />
    <div className="drill" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)' }}>
      <div className="org"><OrgNode db={db} id={unit} depth={0} p={p} onOpen={setOpen} /></div>
      <div className="card"><h3>Ranking · {periodLabel(p)}</h3><p className="mini">Departments and divisions scored on their own objectives (those with progress recorded).</p>{ranked.length ? ranked.map((x, i) => <div key={x.u.id} className="lg row click" onClick={() => setOpen(x.u.id)}><b style={{ width: 22 }}>{i + 1}</b><span style={{ flex: 1 }}>{x.u.name}</span><Bar p={x.s} /><span className="mini">{pct(x.s)}</span></div>) : <p className="note">No department objectives yet.</p>}</div>
    </div>
    {open && <OrgDrawer id={open} p={p} onClose={() => setOpen(null)} onPerson={pos => setPerson(pos)} />}
    {person && <PersonDrawer pos={person} p={p} onClose={() => setPerson(null)} />}
  </Page>;
}

export function PerfPeople({ mine }: { mine?: boolean }) {
  const { db, unit, me } = useData(); const [q, setQ] = useState(''); const [p, setP] = usePeriod(); const [pick, setPick] = useState<Row | null>(null); const [org, setOrg] = useState('');
  if (!db || !unit || !me) return null;
  if (mine) { const r = personResult(db, me, p); const o = byId(db.org_units, me.org_unit_id);
    return <Page title="My performance" desc="Your result: your organisation's score plus your own deliverables, for the period you choose." help={PERF_HELP(db)}>
      <Cmd right={<PeriodPicker value={p} onChange={setP} />} />
      <div className="kpis"><div className="tile"><div className="tv">{pct(r.R)}</div><div className="tl">My result · {periodLabel(p)}</div><div className="ts">{bandOf(r.R, db)} · to HR {r.hr == null ? '—' : fmt(r.hr, 1) + '%'}</div></div>
        <div className="tile"><div className="tv">{pct(r.org)}</div><div className="tl">{o?.name} × {Math.round(r.s * 100)}%</div></div><div className="tile"><div className="tv">{pct(r.personal)}</div><div className="tl">My part × {Math.round((1 - r.s) * 100)}%</div><div className="ts">{r.basis}</div></div></div>
      <button className="btn" onClick={() => setPick(me)}>See the details</button> <Link to="/deliverables">My deliverables →</Link>
      {pick && <PersonDrawer pos={pick} p={p} onClose={() => setPick(null)} />}</Page>; }
  const ids = org ? subtreeIds(db, org) : null;
  const list: Row[] = db.positions.filter(x => x.unit_id === unit && x.holder_name && (!ids || ids.has(x.org_unit_id))).filter(x => !q || (x.holder_name || '').toLowerCase().includes(q.toLowerCase()) || x.title.toLowerCase().includes(q.toLowerCase()));
  const rows = list.map(x => ({ x, r: personResult(db, x, p) })).sort((a, b) => (b.r.s - a.r.s) || ((b.r.R ?? -1) - (a.r.R ?? -1)));
  const orgs = Array.from(subtreeIds(db, unit)).map(id => byId(db.org_units, id)!).filter(u => u.kind !== 'unit');
  const bands = ['Achieved', 'Well performed', 'Partially achieved', 'Under performed'].map(b => ({ label: b, n: rows.filter(r => bandOf(r.r.R, db) === b).length, tone: b === 'Achieved' || b === 'Well performed' ? 'good' : b === 'Partially achieved' ? 'warn' : 'bad' }));
  return <Page title="People" desc="Each person's result for the period — click a person for deliverables, key results and trend." help={PERF_HELP(db)}>
    <Cmd right={<><select value={org} onChange={e => setOrg(e.target.value)} aria-label="Department"><option value="">Whole unit</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select><input type="text" placeholder="Find a person" value={q} onChange={e => setQ(e.target.value)} /><PeriodPicker value={p} onChange={setP} /></>} />
    <div className="card" style={{ marginBottom: 12 }}><h4>Bands · {periodLabel(p)}</h4><StatusStack counts={bands} /></div>
    {!rows.length ? <Empty>No people here.</Empty> : <div className="tw"><table className="t"><thead><tr><th>Person</th><th>Organisation</th><th className="n">Org share</th><th className="n">Org score</th><th className="n">Personal</th><th>Result</th><th>Band</th><th className="n">To HR</th></tr></thead><tbody>
      {rows.map(({ x, r }) => <tr key={x.id} className="click" onClick={() => setPick(x)}><td><b>{x.holder_name}</b><div className="note">{x.title} · {ROLE_NAME[x.role as keyof typeof ROLE_NAME]}</div></td><td>{byId(db.org_units, x.org_unit_id)?.name}</td><td className="n">{Math.round(orgShare(db, x.level) * 100)}%</td>
        <td className="n">{pct(r.org)}</td><td className="n" title={r.basis}>{pct(r.personal)}</td><td><Bar p={r.R} /> {pct(r.R)}</td><td><Pill tone={r.R == null ? 'none' : r.R >= .75 ? 'good' : r.R >= .4 ? 'warn' : 'bad'}>{bandOf(r.R, db)}</Pill></td><td className="n">{r.hr == null ? '—' : fmt(r.hr, 1) + '%'}</td></tr>)}
    </tbody></table></div>}
    {pick && <PersonDrawer pos={pick} p={p} onClose={() => setPick(null)} />}
  </Page>;
}
