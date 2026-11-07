import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData, byId, moduleOn, type DB, type Row } from '../lib/data';
import { incomeStatement, cashFlow, MONTHS, money, pct, lastActualMonth, sum, periodMonths, periodLabel, orgScore, objScore, krsOf, krState, subtreeIds, workStats, delivScore, weekStart, ymd, weekLabel, personResult, bandOf, planBy, actualBy, linesOf, avg, curMonth, IS_KEY, lineVals, lineQty, lineActual, fmt, type Period } from '../lib/calc';
import { Page, Seg, UnitPicker, Empty, PeriodPicker, usePeriod, BarChart, LineChart, StatusStack, Bar, StatePill, Ring, Pill } from '../lib/ui';
import { statusCounts, unitKrs, unitGoalsTree, goalScore, pillarScore } from './Goals';
import { OrgRows, ExpandAll, useOpen, rowScore, subtreeKrs } from '../lib/orgtree';

function csv(name: string, rows: (string | number | null | undefined)[][]) {
  const s = rows.map(r => r.map(v => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([s], { type: 'text/csv' })); a.download = name + '.csv'; a.click();
}
const Export = ({ name, rows }: { name: string; rows: () => (string | number | null | undefined)[][] }) => <button className="btn sm" onClick={() => csv(name, rows())}>Export CSV</button>;

function Summary({ db, us, p }: { db: DB; us: string[]; p: Period }) {
  const { open, setOpen, tg } = useOpen();
  const rowOf = (id: string) => { const o = byId(db.org_units, id)!; const isU = o.kind === 'unit'; const ids = subtreeIds(db, id); const pos = new Set(db.positions.filter(x => ids.has(x.org_unit_id) && x.holder_name).map(x => x.id)); const u = o.unit_id || id;
    const last = lastActualMonth(db, u); const ms = periodMonths(p).filter(m => m <= Math.max(last, 0));
    const rp = isU && ms.length ? planBy(db, u, 'rev', ms) : 0, ra = isU && ms.length ? actualBy(db, u, 'rev', ms) : null; const op = isU && ms.length ? planBy(db, u, 'opex', ms) : 0, oa = isU && ms.length ? actualBy(db, u, 'opex', ms) : null;
    const results = db.positions.filter(x => pos.has(x.id)).map(x => personResult(db, x, p).R).filter(v => v != null) as number[];
    return { o, isU, score: rowScore(db, id, p), counts: statusCounts(db, isU ? unitKrs(db, id) : subtreeKrs(db, id), p), rev: rp ? (ra || 0) / rp : null, opex: op ? (oa || 0) / op : null, deliv: delivScore(db, pos, p), avgR: results.length ? sum(results) / results.length : null }; };
  const rows = us.map(rowOf);
  return <>
    <div className="kpis">{rows.map(r => <div key={r.o.id} className="tile"><div className="row"><Ring p={r.score} size={48} /><div><b>{r.o.name}</b><div className="mini">OKR score · {periodLabel(p)}</div></div></div></div>)}</div>
    <div className="row" style={{ marginBottom: 6 }}><h2 style={{ flex: 1 }}>Executive summary · {periodLabel(p)}</h2><ExpandAll db={db} ids={us} open={open} setOpen={setOpen} />
      <Export name="summary" rows={() => [['Organisation', 'Level', 'OKR score', 'Revenue achieved', 'Opex used', 'Deliverables accepted', 'Average person result'], ...us.flatMap(u => Array.from(subtreeIds(db, u))).map(rowOf).map(r => [r.o.name, r.o.kind, pct(r.score), pct(r.rev), pct(r.opex), `${r.deliv.accepted}/${r.deliv.due}`, pct(r.avgR)])]} /></div>
    <div className="tw"><table className="t"><thead><tr><th>Unit · department · division</th><th data-tip="Unit: its cascaded score. Department or division: the score of its own objectives.">OKR score</th><th>Key results</th><th>Revenue achieved</th><th>Opex vs budget</th><th>Deliverables</th><th>Avg. person result</th></tr></thead><tbody>
      <OrgRows db={db} ids={us} open={open} tg={tg} cells={o => { const r = rowOf(o.id); return <><td>{r.score == null ? <span className="mini">{r.isU ? '—' : 'no objectives of its own'}</span> : <><Bar p={r.score} /> {pct(r.score)}</>}</td><td style={{ minWidth: 220 }}>{r.counts.some(c => c.n) ? <StatusStack counts={r.counts} compact /> : <span className="mini">—</span>}</td>
        <td>{r.isU ? (r.rev == null ? '—' : pct(r.rev)) : <span className="mini">unit level</span>}</td><td>{r.isU ? (r.opex == null ? '—' : pct(r.opex)) : <span className="mini">unit level</span>}</td><td>{r.deliv.due ? `${r.deliv.accepted}/${r.deliv.due}` : '—'}</td><td>{pct(r.avgR)}</td></>; }} />
    </tbody></table></div>
    <p className="note">Open a unit (▸) to see its departments and divisions. Financial figures are kept per unit and cover only months with Finance actuals.</p>
  </>;
}

function OkrReport({ db, us, p }: { db: DB; us: string[]; p: Period }) {
  const [by, setBy] = useState<'goal' | 'obj' | 'kr'>('goal');
  const krs = us.flatMap(u => unitKrs(db, u)); const objs = db.objectives.filter(o => us.includes(o.unit_id));
  const qs = [1, 2, 3, 4].map(q => avg(us.map(u => orgScore(db, u, { t: 'Q', n: q }))));
  return <>
    <div className="kpis"><div className="tile"><div className="tv">{objs.length}</div><div className="tl">Objectives</div></div><div className="tile"><div className="tv">{krs.length}</div><div className="tl">Key results</div></div>
      <div className="tile" style={{ gridColumn: 'span 2' }}><div className="tl" style={{ marginBottom: 6 }}>Status · {periodLabel(p)} (pace-adjusted)</div><StatusStack counts={statusCounts(db, krs, p)} /></div></div>
    <div className="drill"><div className="card"><h3>Score by quarter</h3><BarChart labels={['Q1', 'Q2', 'Q3', 'Q4']} series={[{ name: 'OKR score', values: qs.map(v => v == null ? null : v * 100), color: 'var(--accent)' }]} fmtY={v => Math.round(v) + '%'} height={160} /></div>
      <div className="card"><h3>By pillar · {periodLabel(p)}</h3>{us.flatMap(u => unitGoalsTree(db, u).map(t => ({ u, t }))).map(({ u, t }) => <div key={t.p.id} className="lg row"><span style={{ flex: 1 }}>{t.p.code} {t.p.name}<div className="mini">{byId(db.org_units, u)?.name}</div></span><Bar p={pillarScore(db, t.p.id, p)} /><span className="mini">{pct(pillarScore(db, t.p.id, p))}</span></div>)}</div></div>
    <div className="row" style={{ margin: '14px 0 6px' }}><Seg value={by} options={[['goal', 'By goal'], ['obj', 'By objective'], ['kr', 'By key result']]} onChange={setBy} /><span className="sp" />
      <Export name="okr" rows={() => [['Unit', 'Objective', 'Key result', 'Owner', 'Target', 'Actual', 'Progress', 'Status'], ...krs.map(k => { const s = krState(db, k, p); const o = byId(db.objectives, k.objective_id); return [byId(db.org_units, o?.unit_id)?.name, o?.text, k.title, byId(db.positions, k.owner_position_id)?.holder_name, s.target, s.actual, pct(s.progress), s.label]; })]} /></div>
    {by === 'goal' && <div className="tw"><table className="t"><thead><tr><th>Goal</th><th>Unit</th><th>Objectives</th><th>Score</th></tr></thead><tbody>{us.flatMap(u => db.unit_goals.filter(g => g.unit_id === u)).map(g => <tr key={g.id}><td>{g.code} {g.name}</td><td>{byId(db.org_units, g.unit_id)?.name}</td><td>{db.objectives.filter(o => o.unit_goal_id === g.id).length}</td><td><Bar p={goalScore(db, g.id, p)} /> {pct(goalScore(db, g.id, p))}</td></tr>)}</tbody></table></div>}
    {by === 'obj' && <div className="tw"><table className="t"><thead><tr><th>Objective</th><th>Organisation</th><th>Score</th><th>Status</th></tr></thead><tbody>{objs.map(o => ({ o, s: objScore(db, o, p) })).sort((a, b) => (b.s ?? -1) - (a.s ?? -1)).map(({ o, s }) => <tr key={o.id}><td>{o.text}</td><td>{byId(db.org_units, o.org_unit_id)?.name}</td><td><Bar p={s} /> {pct(s)}</td><td><StatePill s={krsOf(db, o.id).length ? krState(db, krsOf(db, o.id)[0], p) : { label: '—', tone: 'none' }} /></td></tr>)}</tbody></table></div>}
    {by === 'kr' && <div className="tw"><table className="t"><thead><tr><th>Key result</th><th className="n">Target</th><th className="n">Actual</th><th>Progress</th><th>Status</th></tr></thead><tbody>{krs.map(k => ({ k, s: krState(db, k, p) })).sort((a, b) => (a.s.ratio ?? 9) - (b.s.ratio ?? 9)).map(({ k, s }) => <tr key={k.id}><td>{k.title}</td><td className="n">{s.target == null ? '—' : Math.round(s.target * 100) / 100}</td><td className="n">{s.actual ?? '—'}</td><td><Bar p={s.progress} /> {pct(s.progress)}</td><td><StatePill s={s} /></td></tr>)}</tbody></table></div>}
  </>;
}

function OrgReport({ db, us, p }: { db: DB; us: string[]; p: Period }) {
  const { open, setOpen, tg } = useOpen();
  const rowOf = (id: string) => { const o = byId(db.org_units, id)!; const ids = subtreeIds(db, id); const pos = db.positions.filter(x => ids.has(x.org_unit_id) && x.holder_name); const rs = pos.map(x => personResult(db, x, p).R).filter(v => v != null) as number[]; const d = delivScore(db, new Set(pos.map(x => x.id)), p);
    return { o, s: rowScore(db, id, p), q: [1, 2, 3, 4].map(q => rowScore(db, id, { t: 'Q', n: q })), people: pos.length, avgR: rs.length ? sum(rs) / rs.length : null, d }; };
  const people = us.flatMap(u => db.positions.filter(x => x.unit_id === u && x.holder_name)); const bands = ['Achieved', 'Well performed', 'Partially achieved', 'Under performed'].map(b => ({ label: b, n: people.filter(x => bandOf(personResult(db, x, p).R, db) === b).length, tone: b.startsWith('Ach') || b.startsWith('Well') ? 'good' : b.startsWith('Part') ? 'warn' : 'bad' }));
  return <>
    <div className="card" style={{ marginBottom: 12 }}><h3>People by band · {periodLabel(p)}</h3><StatusStack counts={bands} /></div>
    <div className="row" style={{ marginBottom: 6 }}><h2 style={{ flex: 1 }}>Units, departments and divisions</h2><ExpandAll db={db} ids={us} open={open} setOpen={setOpen} /><Export name="organisation" rows={() => [['Organisation', 'Level', 'Score', 'Q1', 'Q2', 'Q3', 'Q4', 'People', 'Avg result', 'Deliverables accepted'], ...us.flatMap(u => Array.from(subtreeIds(db, u))).map(rowOf).map(r => [r.o.name, r.o.kind, pct(r.s), ...r.q.map(v => pct(v)), r.people, pct(r.avgR), `${r.d.accepted}/${r.d.due}`])]} /></div>
    <div className="tw"><table className="t"><thead><tr><th>Organisation</th><th>{periodLabel(p)}</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th className="n">People</th><th>Avg. result</th><th>Deliverables</th></tr></thead><tbody>
      <OrgRows db={db} ids={us} open={open} tg={tg} cells={o => { const r = rowOf(o.id); return <><td>{r.s == null ? <span className="mini">{o.kind === 'unit' ? '—' : 'no objectives of its own'}</span> : <><Bar p={r.s} /> {pct(r.s)}</>}</td>{r.q.map((v, i) => <td key={i}>{pct(v)}</td>)}<td className="n">{r.people}</td><td>{pct(r.avgR)}</td><td>{r.d.due ? `${r.d.accepted}/${r.d.due}` : '—'}</td></>; }} />
    </tbody></table></div>
    <PeopleTable db={db} us={us} p={p} />
  </>;
}

/** Everyone in scope with their result: organisation part, personal part, band and HR score. */
function PeopleTable({ db, us, p }: { db: DB; us: string[]; p: Period }) {
  const [q, setQ] = useState(''); const [band, setBand] = useState(''); const [org, setOrg] = useState('');
  const all = us.flatMap(u => db.positions.filter(x => x.unit_id === u && x.holder_name)).map(x => { const r = personResult(db, x, p); return { x, r, band: bandOf(r.R, db), d: delivScore(db, new Set([x.id]), p), wk: workStats(db, new Set([x.id]), ymd(weekStart(new Date()))) }; });
  const orgs = Array.from(new Set(all.map(a => a.x.org_unit_id))).map(id => byId(db.org_units, id)).filter(Boolean).sort((a, b) => a!.name.localeCompare(b!.name));
  const rows = all.filter(a => (!q || (a.x.holder_name + ' ' + a.x.title).toLowerCase().includes(q.toLowerCase())) && (!band || a.band === band) && (!org || a.x.org_unit_id === org)).sort((a, b) => (b.r.R ?? -1) - (a.r.R ?? -1));
  const hrMax = Number(db.settings.hr_scale?.max ?? 70);
  return <><div className="row" style={{ margin: '16px 0 6px', gap: 6, flexWrap: 'wrap' }}><h2 style={{ flex: 1 }}>People · {rows.length}</h2>
    <input placeholder="Search name or position" value={q} onChange={e => setQ(e.target.value)} style={{ width: 200 }} />
    <select value={org} onChange={e => setOrg(e.target.value)} aria-label="Department"><option value="">All departments</option>{orgs.map(o => <option key={o!.id} value={o!.id}>{o!.name}</option>)}</select>
    <select value={band} onChange={e => setBand(e.target.value)} aria-label="Band"><option value="">All bands</option>{['Achieved', 'Well performed', 'Partially achieved', 'Under performed'].map(b => <option key={b}>{b}</option>)}</select>
    <Export name="people" rows={() => [['Name', 'Position', 'Organisation', 'Organisation part', 'Org weight', 'Org score', 'Personal', 'Result', 'Band', `HR score (/${hrMax})`, 'Basis', 'Deliverables accepted'], ...rows.map(a => [a.x.holder_name, a.x.title, byId(db.org_units, a.x.org_unit_id)?.name, a.r.orgLabel, pct(a.r.s), pct(a.r.org), pct(a.r.personal), pct(a.r.R), a.band, a.r.hr == null ? '' : a.r.hr.toFixed(1), a.r.basis, `${a.d.accepted}/${a.d.due}`])]} /></div>
    <div className="tw" style={{ maxHeight: 520 }}><table className="t"><thead><tr><th>Person</th><th>Organisation</th><th data-tip="For a leader: the organisation they lead (unit, department or division). For a team member: their department or division. The weight is set per level in Studio → Configuration → Scoring.">Organisation part</th><th data-tip="From the agreed quarter scorecard; if none, accepted deliverables; if none, own objectives or key results.">Personal part</th><th data-tip="Result = weight × organisation part + (100% − weight) × personal part.">Result</th><th>Band</th><th className="n" data-tip={`Result converted to the HR scale (out of ${hrMax}).`}>HR</th><th data-tip="Deliverables accepted of those due in the period.">Deliverables</th><th data-tip="Activities done this week.">This week</th></tr></thead><tbody>
      {rows.map(a => <tr key={a.x.id}><td><b>{a.x.holder_name}</b><div className="mini">{a.x.title}</div></td><td className="mini">{byId(db.org_units, a.x.org_unit_id)?.name}</td><td>{pct(a.r.org)}<div className="mini">{a.r.orgLabel.split(' · ')[0]} · weight {pct(a.r.s)}</div></td><td>{pct(a.r.personal)}<div className="mini">{a.r.basis}</div></td><td><Bar p={a.r.R} /> {pct(a.r.R)}</td><td className="mini">{a.band || '—'}</td><td className="n">{a.r.hr == null ? '—' : a.r.hr.toFixed(1)}</td><td>{a.d.due ? `${a.d.accepted}/${a.d.due}` : '—'}</td><td className="mini">{a.wk.total ? `${a.wk.done}/${a.wk.total}` : '—'}</td></tr>)}
    </tbody></table></div></>;
}

function WorkReport({ db, us }: { db: DB; us: string[] }) {
  const pos = new Set(db.positions.filter(x => us.includes(x.unit_id) && x.holder_name).map(x => x.id));
  const weeks = Array.from({ length: 8 }, (_, i) => new Date(weekStart(new Date()).getTime() - (7 - i) * 7 * 864e5));
  const ws = weeks.map(w => workStats(db, pos, ymd(w)));
  const months = Array.from({ length: curMonth() }, (_, i) => delivScore(db, pos, { t: 'M', n: i + 1 }));
  const reviews = weeks.map(w => db.week_reviews.filter(r => pos.has(r.position_id) && r.week_start === ymd(w) && r.submitted_at).length);
  const stuck = db.activities.filter(a => pos.has(a.owner_position_id) && a.status === 'Stuck');
  return <>
    <div className="drill"><div className="card"><h3>Weekly work — last 8 weeks</h3><LineChart labels={weeks.map(w => weekLabel(w))} series={[{ name: 'Work done %', values: ws.map(s => s.completion == null ? null : s.completion * 100), color: 'var(--accent)' }, { name: 'People updating', values: ws.map(s => s.people), color: 'var(--good)', dashed: true }]} fmtY={v => String(Math.round(v))} height={170} /></div>
      <div className="card"><h3>Monthly deliverables</h3><BarChart labels={MONTHS.slice(0, curMonth())} series={[{ name: 'Due', values: months.map(m => m.due), color: 'var(--line2)' }, { name: 'Accepted', values: months.map(m => m.accepted), color: 'var(--good)' }]} height={170} /></div></div>
    <div className="row" style={{ margin: '14px 0 6px' }}><h2 style={{ flex: 1 }}>Week by week</h2><Export name="weekly-work" rows={() => [['Week', 'People', 'Activities', 'Done', 'Stuck', 'Completion', 'Summaries submitted'], ...weeks.map((w, i) => [weekLabel(w), ws[i].people, ws[i].total, ws[i].done, ws[i].stuck, pct(ws[i].completion), reviews[i]])]} /></div>
    <div className="tw"><table className="t"><thead><tr><th>Week</th><th className="n">People</th><th className="n">Activities</th><th className="n">Done</th><th className="n">Stuck</th><th>Completion</th><th className="n">Summaries</th></tr></thead><tbody>
      {weeks.map((w, i) => <tr key={i}><td>{weekLabel(w)}</td><td className="n">{ws[i].people}</td><td className="n">{ws[i].total}</td><td className="n">{ws[i].done}</td><td className="n">{ws[i].stuck}</td><td><Bar p={ws[i].completion} /> {pct(ws[i].completion)}</td><td className="n">{reviews[i]}</td></tr>)}
    </tbody></table></div>
    <WorkByOrg db={db} us={us} weeks={weeks} />
    <h2 style={{ margin: '14px 0 6px' }}>Open blockers · {stuck.length}</h2>
    {stuck.length ? <div className="tw"><table className="t"><thead><tr><th>Activity</th><th>Blocker</th><th>Help needed from</th><th>Owner</th><th>Week</th></tr></thead><tbody>{stuck.map(a => <tr key={a.id}><td>{a.title}</td><td>{a.blocker}</td><td className="mini">{byId(db.org_units, a.help_from_unit)?.name || '—'}</td><td>{byId(db.positions, a.owner_position_id)?.holder_name}</td><td>{weekLabel(new Date(a.week_start + 'T00:00:00Z'))}</td></tr>)}</tbody></table></div> : <p className="note">None.</p>}
  </>;
}


const DST: Record<string, [string, string]> = { planned: ['Planned', 'none'], done: ['Submitted', 'warn'], accepted: ['Accepted', 'good'], returned: ['Returned', 'bad'] };
/** Monthly work: every deliverable of the chosen months, line by line, with totals. */
function MonthlyReport({ db, us, p, people: only }: { db: DB; us: string[]; p: Period; people?: Set<string> }) {
  const [q, setQ] = useState(''); const [st, setSt] = useState(''); const [by, setBy] = useState<'line' | 'person'>('line');
  const pos = new Set(db.positions.filter(x => us.includes(x.unit_id) && x.holder_name && (!only || only.has(x.id))).map(x => x.id)); const ms = periodMonths(p); const cm = curMonth();
  const all = db.deliverables.filter(d => pos.has(d.owner_position_id) && ms.includes(d.month) && !['removed', 'transferred'].includes(d.status));
  const list = all.filter(d => (!st || d.status === st) && (!q || (d.title + ' ' + (byId(db.positions, d.owner_position_id)?.holder_name || '')).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.month - b.month || (byId(db.positions, a.owner_position_id)?.holder_name || '').localeCompare(byId(db.positions, b.owner_position_id)?.holder_name || ''));
  const due = all.filter(d => p.full || d.month <= cm); const acc = due.filter(d => d.status === 'accepted'); const sc = delivScore(db, pos, p);
  const rated = all.filter(d => d.rating); const avgR = rated.length ? sum(rated.map(d => Number(d.rating))) / rated.length : null;
  const people = Array.from(new Set(all.map(d => d.owner_position_id))).map(id => { const ds = all.filter(d => d.owner_position_id === id); const dd = ds.filter(d => p.full || d.month <= cm); return { id, n: ds.length, due: dd.length, sub: ds.filter(d => d.status === 'done').length, acc: ds.filter(d => d.status === 'accepted').length, ret: ds.filter(d => d.status === 'returned').length, score: delivScore(db, new Set([id]), p).score }; }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const name = (id: string) => byId(db.positions, id)?.holder_name || '—';
  return <>
    <div className="kpis">
      <div className="tile"><div className="tv">{all.length}</div><div className="tl">Deliverables · {periodLabel(p)}</div><div className="ts">{due.length} due{p.full ? '' : ' so far'}</div></div>
      <div className="tile good"><div className="tv">{acc.length}</div><div className="tl">Accepted</div><div className="ts">{due.length ? pct(acc.length / due.length) : '—'} of due</div></div>
      <div className="tile warn"><div className="tv">{all.filter(d => d.status === 'done').length}</div><div className="tl">Submitted, waiting</div></div>
      <div className="tile bad"><div className="tv">{all.filter(d => d.status === 'returned').length}</div><div className="tl">Returned</div></div>
      <div className="tile"><div className="row"><Ring p={sc.score} size={46} /><div className="tl">Weighted result</div></div></div>
      <div className="tile"><div className="tv">{avgR ? avgR.toFixed(1) + '★' : '—'}</div><div className="tl">Average rating</div></div>
    </div>
    <div className="row" style={{ margin: '12px 0 6px' }}><Seg value={by} options={[['line', 'Line by line'], ['person', 'By person']]} onChange={setBy} />{by === 'line' && <><input type="text" placeholder="Search deliverable or person" value={q} onChange={e => setQ(e.target.value)} /><select value={st} onChange={e => setSt(e.target.value)}><option value="">All statuses</option>{Object.entries(DST).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></>}<span className="sp" />
      <Export name="monthly-deliverables" rows={() => [['Month', 'Deliverable', 'Owner', 'Unit', 'Key result', 'Weight', 'Target', 'Achieved', 'Status', 'Rating', 'Feedback'], ...list.map(d => [MONTHS[d.month - 1], d.title, name(d.owner_position_id), byId(db.org_units, d.unit_id)?.name, byId(db.key_results, d.key_result_id)?.title || '', d.weight ?? '', d.target ?? '', d.actual ?? '', DST[d.status]?.[0] || d.status, d.rating || '', d.feedback || ''])]} /></div>
    {by === 'line' ? <div className="tw"><table className="t"><thead><tr><th>Month</th><th>Deliverable</th><th>Owner</th><th>Key result</th><th className="n">Weight</th><th className="n">Target</th><th className="n">Achieved</th><th>Status</th><th>Rating</th></tr></thead><tbody>
      {list.map(d => { const [l, t] = DST[d.status] || [d.status, 'none']; const r = d.target != null && d.actual != null && Number(d.target) ? Number(d.actual) / Number(d.target) : null; return <tr key={d.id}><td>{MONTHS[d.month - 1]}</td><td>{d.title}{d.feedback && <div className="mini">Manager: {d.feedback}</div>}</td><td>{name(d.owner_position_id)}<div className="mini">{us.length > 1 ? byId(db.org_units, d.unit_id)?.name : byId(db.org_units, byId(db.positions, d.owner_position_id)?.org_unit_id)?.name}</div></td><td className="mini">{byId(db.key_results, d.key_result_id)?.title || '—'}</td><td className="n">{d.weight != null ? d.weight + '%' : ''}</td><td className="n">{d.target ?? ''}</td><td className="n">{d.actual ?? ''}{r != null && <div className="mini">{pct(r)}</div>}</td><td><Pill tone={t}>{l}</Pill></td><td>{d.rating ? '★'.repeat(d.rating) : ''}</td></tr>; })}
      {!list.length && <tr><td colSpan={9} className="note">No deliverables match.</td></tr>}
      <tr className="g"><td colSpan={7}><b>Total · {list.length} deliverables</b></td><td colSpan={2}><b>{list.filter(d => d.status === 'accepted').length} accepted</b> · {list.filter(d => d.status === 'done').length} submitted · {list.filter(d => d.status === 'returned').length} returned</td></tr>
    </tbody></table></div>
    : <div className="tw"><table className="t"><thead><tr><th>Person</th><th className="n">Deliverables</th><th className="n">Due</th><th className="n">Submitted</th><th className="n">Accepted</th><th className="n">Returned</th><th>Weighted result</th></tr></thead><tbody>
      {people.map(x => <tr key={x.id}><td>{name(x.id)}<div className="mini">{byId(db.org_units, byId(db.positions, x.id)?.org_unit_id)?.name}</div></td><td className="n">{x.n}</td><td className="n">{x.due}</td><td className="n">{x.sub}</td><td className="n">{x.acc}</td><td className="n">{x.ret}</td><td><Bar p={x.score} /> {pct(x.score)}</td></tr>)}
      <tr className="g"><td><b>Total</b></td><td className="n"><b>{all.length}</b></td><td className="n">{due.length}</td><td className="n">{all.filter(d => d.status === 'done').length}</td><td className="n">{acc.length}</td><td className="n">{all.filter(d => d.status === 'returned').length}</td><td><Bar p={sc.score} /> {pct(sc.score)}</td></tr>
    </tbody></table></div>}
    <div className="card" style={{ marginTop: 12 }}><h3>Deliverables by month</h3><BarChart labels={MONTHS.slice(0, Math.max(cm, ...ms))} series={[{ name: 'Due', values: MONTHS.slice(0, Math.max(cm, ...ms)).map((_, i) => delivScore(db, pos, { t: 'M', n: i + 1 }).due), color: 'var(--line2)' }, { name: 'Accepted', values: MONTHS.slice(0, Math.max(cm, ...ms)).map((_, i) => delivScore(db, pos, { t: 'M', n: i + 1 }).accepted), color: 'var(--good)' }]} height={170} /></div>
  </>;
}

const AST: Record<string, string> = { Done: 'good', 'In progress': 'warn', Stuck: 'bad', Delayed: 'bad', 'Not started': 'none' };
/** Weekly work: every activity of the chosen week, line by line, with totals and the 8-week trend. */
function WeeklyReport({ db, us, people: only }: { db: DB; us: string[]; people?: Set<string> }) {
  const [ws, setWs] = useState(ymd(weekStart(new Date()))); const [q, setQ] = useState(''); const [st, setSt] = useState(''); const [by, setBy] = useState<'line' | 'person'>('line');
  const pos = new Set(db.positions.filter(x => us.includes(x.unit_id) && x.holder_name && (!only || only.has(x.id))).map(x => x.id));
  const all = db.activities.filter(a => pos.has(a.owner_position_id) && a.week_start === ws);
  const list = all.filter(a => (!st || a.status === st) && (!q || (a.title + ' ' + (byId(db.positions, a.owner_position_id)?.holder_name || '')).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (byId(db.positions, a.owner_position_id)?.holder_name || '').localeCompare(byId(db.positions, b.owner_position_id)?.holder_name || ''));
  const s0 = workStats(db, pos, ws); const shift = (n: number) => setWs(ymd(new Date(new Date(ws + 'T00:00:00Z').getTime() + n * 7 * 864e5)));
  const name = (id: string) => byId(db.positions, id)?.holder_name || '—';
  const people = Array.from(new Set(all.map(a => a.owner_position_id))).map(id => { const s = workStats(db, new Set([id]), ws); return { id, ...s }; }).sort((a, b) => (b.completion ?? -1) - (a.completion ?? -1));
  return <>
    <div className="row" style={{ marginBottom: 10 }}><button className="btn sm" onClick={() => shift(-1)}>‹</button><b>{weekLabel(new Date(ws + 'T00:00:00Z'))}</b><button className="btn sm" onClick={() => shift(1)}>›</button><button className="btn sm" onClick={() => setWs(ymd(weekStart(new Date())))}>This week</button></div>
    <div className="kpis">
      <div className="tile"><div className="tv">{s0.total}</div><div className="tl">Activities</div><div className="ts">{s0.people} people</div></div>
      <div className="tile"><div className="row"><Ring p={s0.completion} size={46} /><div className="tl">Work done</div></div></div>
      <div className="tile good"><div className="tv">{s0.done}</div><div className="tl">Done</div></div>
      <div className="tile warn"><div className="tv">{all.filter(a => a.status === 'In progress').length}</div><div className="tl">In progress</div></div>
      <div className="tile bad"><div className="tv">{s0.stuck}</div><div className="tl">Stuck</div></div>
      <div className="tile"><div className="tv">{all.filter(a => a.unplanned).length}</div><div className="tl">Unplanned</div></div>
    </div>
    <div className="row" style={{ margin: '12px 0 6px' }}><Seg value={by} options={[['line', 'Line by line'], ['person', 'By person']]} onChange={setBy} />{by === 'line' && <><input type="text" placeholder="Search activity or person" value={q} onChange={e => setQ(e.target.value)} /><select value={st} onChange={e => setSt(e.target.value)}><option value="">All statuses</option>{Object.keys(AST).map(k => <option key={k}>{k}</option>)}</select></>}<span className="sp" />
      <Export name="weekly-activities" rows={() => [['Week', 'Activity', 'Owner', 'Deliverable', 'Status', '% done', 'Due', 'Blocker'], ...list.map(a => [weekLabel(new Date(ws + 'T00:00:00Z')), a.title, name(a.owner_position_id), byId(db.deliverables, a.deliverable_id)?.title || (a.unplanned ? 'Unplanned' : ''), a.status, a.status === 'Done' ? 100 : a.pct ?? 0, a.due_date || '', a.blocker || ''])]} /></div>
    {by === 'line' ? <div className="tw"><table className="t"><thead><tr><th>Activity</th><th>Owner</th><th>Deliverable</th><th>Due</th><th>Status</th><th>Progress</th><th>Blocker</th></tr></thead><tbody>
      {list.map(a => { const pc = a.status === 'Done' ? 1 : (Number(a.pct) || 0) / 100; return <tr key={a.id}><td>{a.top ? '★ ' : ''}{a.title}{a.carried_count ? <span className="mini"> · carried ×{a.carried_count}</span> : null}</td><td>{name(a.owner_position_id)}</td><td className="mini">{byId(db.deliverables, a.deliverable_id)?.title || (a.unplanned ? 'Unplanned' : '—')}</td><td className="mini">{a.due_date || ''}</td><td><Pill tone={AST[a.status] || 'none'}>{a.status}</Pill></td><td><Bar p={pc} /> {pct(pc)}</td><td className="mini">{a.blocker || ''}</td></tr>; })}
      {!list.length && <tr><td colSpan={7} className="note">No activities match.</td></tr>}
      <tr className="g"><td colSpan={4}><b>Total · {list.length} activities</b></td><td colSpan={3}><b>{list.filter(a => a.status === 'Done').length} done</b> · {list.filter(a => a.status === 'In progress').length} in progress · {list.filter(a => a.status === 'Stuck').length} stuck · average {pct(list.length ? sum(list.map(a => a.status === 'Done' ? 1 : (Number(a.pct) || 0) / 100)) / list.length : null)}</td></tr>
    </tbody></table></div>
    : <div className="tw"><table className="t"><thead><tr><th>Person</th><th className="n">Activities</th><th className="n">Done</th><th className="n">Stuck</th><th>Work done</th><th>Updated on time</th></tr></thead><tbody>
      {people.map(x => <tr key={x.id}><td>{name(x.id)}<div className="mini">{byId(db.org_units, byId(db.positions, x.id)?.org_unit_id)?.name}</div></td><td className="n">{x.total}</td><td className="n">{x.done}</td><td className="n">{x.stuck}</td><td><Bar p={x.completion} /> {pct(x.completion)}</td><td>{x.onTime ? <Pill tone="good">yes</Pill> : <Pill tone="warn">no</Pill>}</td></tr>)}
      <tr className="g"><td><b>Total</b></td><td className="n"><b>{s0.total}</b></td><td className="n">{s0.done}</td><td className="n">{s0.stuck}</td><td><Bar p={s0.completion} /> {pct(s0.completion)}</td><td>{s0.onTime}/{s0.people}</td></tr>
    </tbody></table></div>}
    {!only && <WorkReport db={db} us={us} />}
  </>;
}

/** Weekly and monthly work by department: completion this and last week, people updating on time, deliverables for the month. */
function WorkByOrg({ db, us, weeks }: { db: DB; us: string[]; weeks: Date[] }) {
  const [m, setM] = useState(curMonth()); const [open, setOpen] = useState<string | null>(null);
  const orgs = us.flatMap(u => Array.from(subtreeIds(db, u))).map(id => byId(db.org_units, id)!).filter(o => o && o.kind !== 'group' && db.positions.some(x => x.org_unit_id === o.id && x.holder_name));
  const thisW = ymd(weeks[weeks.length - 1]), prevW = ymd(weeks[weeks.length - 2]);
  const rows = orgs.map(o => { const pos = new Set(db.positions.filter(x => x.org_unit_id === o.id && x.holder_name).map(x => x.id)); const a = workStats(db, pos, thisW), b = workStats(db, pos, prevW);
    const dels = db.deliverables.filter(d => pos.has(d.owner_position_id) && d.month === m && !['removed', 'transferred'].includes(d.status)); return { o, pos, a, b, dels }; }).filter(r => r.a.total || r.b.total || r.dels.length);
  return <><div className="row" style={{ margin: '14px 0 6px' }}><h2 style={{ flex: 1 }}>By department</h2><select value={m} onChange={e => setM(Number(e.target.value))} aria-label="Month">{MONTHS.map((x, i) => <option key={x} value={i + 1}>{x} deliverables</option>)}</select>
    <Export name="work-by-department" rows={() => [['Organisation', 'People', 'This week completion', 'Last week completion', 'Updated on time', 'Stuck', 'Deliverables', 'Accepted', 'Done awaiting acceptance'], ...rows.map(r => [r.o.name, r.pos.size, pct(r.a.completion), pct(r.b.completion), `${r.a.onTime}/${r.a.people}`, r.a.stuck, r.dels.length, r.dels.filter(d => d.status === 'accepted').length, r.dels.filter(d => d.status === 'done').length])]} /></div>
    <div className="tw"><table className="t"><thead><tr><th>Organisation</th><th className="n">People</th><th>This week</th><th data-tip="Completion last week, for the week-on-week trend.">Last week</th><th data-tip="People whose plan was updated before the Saturday 2 PM cut-off.">On time</th><th className="n">Stuck</th><th data-tip="Deliverables planned for the chosen month: accepted / done awaiting acceptance / total.">Deliverables · {MONTHS[m - 1]}</th></tr></thead><tbody>
      {rows.map(r => [<tr key={r.o.id} className="click" onClick={() => setOpen(open === r.o.id ? null : r.o.id)}><td><b>{open === r.o.id ? '▾' : '▸'} {r.o.name}</b><div className="mini">{r.o.kind}</div></td><td className="n">{r.pos.size}</td><td><Bar p={r.a.completion} /> {pct(r.a.completion)}</td><td className="mini">{pct(r.b.completion)}</td><td className="mini">{r.a.people ? `${r.a.onTime}/${r.a.people}` : '—'}</td><td className={'n' + (r.a.stuck ? ' neg' : '')}>{r.a.stuck}</td><td>{r.dels.length ? `${r.dels.filter(d => d.status === 'accepted').length} / ${r.dels.filter(d => d.status === 'done').length} / ${r.dels.length}` : '—'}</td></tr>,
        ...(open === r.o.id ? r.dels.map(d => <tr key={d.id}><td className="ind mini" colSpan={3}>{d.title}<div className="mini">{byId(db.key_results, d.key_result_id)?.title || ''}</div></td><td className="mini" colSpan={2}>{byId(db.positions, d.owner_position_id)?.holder_name}</td><td className="mini" colSpan={2}>{d.status}{d.evidence ? ' · ' + d.evidence : ''}</td></tr>) : [])])}
    </tbody></table></div></>;
}

/** Lines of a group across the units in scope, with plan, baseline, actual and quantities for the months. */
function lineItems(db: DB, us: string[], sec: string, grp: string, months: number[]) {
  return us.flatMap(u => linesOf(db, u, sec).filter(l => (l.line_group || 'Other') === grp).map(l => { const isQ = l.kind === 'qty' || lineQty(l).some(x => x);
    return { l, u, base: sum(months.map(m => lineVals(l, true)[m - 1])), plan: sum(months.map(m => lineVals(l)[m - 1])), act: lineActual(db, l.id, months), qplan: isQ ? sum(months.map(m => lineQty(l)[m - 1])) : null, qact: isQ ? lineActual(db, l.id, months, 'quantity') : null }; }));
}
type Basis = 'ytd' | 'q1' | 'q2' | 'q3' | 'q4' | 'year' | 'month';
const TIP: Record<string, string> = { base: 'The original approved annual plan.', plan: 'Plan in force: the baseline plus approved rescopes.', act: 'Actuals recorded by Finance (Work → Record → Financial actuals).', var: 'Actual − plan. Red when it hurts profit (revenue below plan or cost above plan).', ach: 'Actual ÷ plan.' };
function Financial({ db, us, name }: { db: DB; us: string[]; name: string }) {
  const [tab, setTab] = useState<'is' | 'mis' | 'co' | 'cos' | 'cf' | 'wcf' | 'trend' | 'lines'>('is'); const [per, setPer] = useState<Basis>('ytd');
  const [cmp, setCmp] = useState<'plan' | 'mom' | 'qoq' | 'ytd'>('plan'); const [detail, setDetail] = useState(true); const [misKind, setMisKind] = useState<'act' | 'plan'>('act'); const [openG, setOpenG] = useState<Set<string>>(new Set());
  const tg = (k: string) => setOpenG(x => { const n = new Set(x); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const last = Math.max(1, ...us.map(u => lastActualMonth(db, u))); const [mon, setMon] = useState(last);
  const rng = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
  const months = per === 'ytd' ? rng(1, last) : per === 'year' ? rng(1, 12) : per === 'month' ? [mon] : periodMonths({ t: 'Q', n: Number(per[1]) });
  const unitName = (u: string) => byId(db.org_units, u)?.name || '';
  const vtone = (r: Row, v: number | null) => v != null && (r.cost ? v > 0 : v < 0) ? ' neg' : '';
  const dpct = (a: number | null, b: number | null) => a == null || b == null || !b ? '' : ((a - b) / Math.abs(b) * 100).toFixed(1) + '%';
  const tabs: [typeof tab, string][] = [['is', 'Income statement'], ['mis', 'Monthly income statement'], ['co', 'By company'], ['cos', 'Cost of sales'], ['cf', 'Cash flow'], ...(moduleOn(db, 'weekly_cash') ? [['wcf', 'Weekly cash'] as [any, string]] : []), ['trend', 'Trends'], ['lines', 'By product / budget line']];
  return <>
    <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 6 }}><select value={tab} onChange={e => setTab(e.target.value as any)} aria-label="Financial report">{tabs.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {tab === 'is' && <Seg value={cmp} options={[['plan', 'Plan vs actual'], ['mom', 'MoM'], ['qoq', 'QoQ'], ['ytd', 'YTD']]} onChange={setCmp} />}<span className="sp" />
      {((tab === 'is' && cmp === 'plan') || tab === 'lines' || tab === 'co' || tab === 'cos') && <Seg value={per} options={[['ytd', `YTD (${MONTHS[last - 1]})`], ['month', 'Month'], ['q1', 'Q1'], ['q2', 'Q2'], ['q3', 'Q3'], ['q4', 'Q4'], ['year', 'Year']]} onChange={setPer} />}
      {(per === 'month' || (tab === 'is' && cmp === 'mom')) && <select value={mon} onChange={e => setMon(Number(e.target.value))} aria-label="Month">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>}
      {(tab === 'is' || tab === 'mis') && <label className="mini row" style={{ gap: 4 }}><input type="checkbox" checked={detail} onChange={e => setDetail(e.target.checked)} />Group detail</label>}</div>
    {tab === 'is' && cmp === 'plan' && detail && <p className="note" style={{ marginTop: 0 }}>Click a product or budget group to see its lines.</p>}

    {tab === 'is' && (() => {
      if (cmp === 'plan') { const rows = incomeStatement(db, us, months, detail); const K = (k: string) => IS_KEY(rows, k); const rev = K('rev'), gp = K('gp'), ebit = K('ebit'), ni = K('ni');
        if (!rows.some(r => r.plan)) return <Empty>No plan lines for {name}.</Empty>;
        return <>
          <div className="kpis"><div className="tile"><div className="tv">{money(rev.act)}</div><div className="tl">Revenue</div><div className="ts">plan {money(rev.plan)} · {rev.plan ? pct((rev.act || 0) / rev.plan) : '—'}</div></div>
            <div className="tile"><div className="tv">{rev.act ? pct((gp.act || 0) / rev.act) : '—'}</div><div className="tl">Gross margin</div><div className="ts">plan {rev.plan ? pct(gp.plan / rev.plan) : '—'}</div></div>
            <div className={'tile ' + (ebit.act != null && ebit.act < 0 ? 'bad' : '')}><div className="tv">{money(ebit.act)}</div><div className="tl">Operating profit (EBIT)</div><div className="ts">plan {money(ebit.plan)}</div></div>
            <div className={'tile ' + (ni.act != null && ni.act < 0 ? 'bad' : 'good')}><div className="tv">{money(ni.act)}</div><div className="tl">Net income</div><div className="ts">plan {money(ni.plan)}</div></div></div>
          <div className="row" style={{ marginBottom: 6 }}><span className="sp" /><Export name="income-statement" rows={() => [['Line', 'Baseline', 'Plan in force', 'Actual', 'Variance'], ...rows.map(r => [r.label, r.base, r.plan, r.act, r.act == null ? null : r.act - r.plan])]} /></div>
          <div className="tw"><table className="t"><thead><tr><th>{name}</th><th className="n" data-tip={TIP.base}>Baseline</th><th className="n" data-tip={TIP.plan}>Plan in force</th><th className="n" data-tip={TIP.act}>Actual</th><th className="n" data-tip={TIP.var}>Variance</th><th className="n" data-tip={TIP.ach}>Achieved</th></tr></thead><tbody>
            {rows.map((r, i) => { const v = r.act == null ? null : r.act - r.plan; const gk = r.sec ? r.sec + '|' + r.grp : ''; const on = gk && openG.has(gk);
              return [<tr key={r.label + i} className={(r.bold ? 'b' : '') + (gk ? ' click' : '')} onClick={gk ? () => tg(gk) : undefined}><td className={r.indent ? 'ind' : ''}>{gk ? (on ? '▾ ' : '▸ ') : ''}{r.label}</td><td className="n">{money(r.base)}</td><td className="n">{money(r.plan)}</td><td className="n">{money(r.act)}</td><td className={'n' + vtone(r, v)}>{money(v)}</td><td className="n">{r.act != null && r.plan ? pct(r.act / r.plan) : ''}</td></tr>,
                ...(on ? lineItems(db, us, r.sec!, r.grp!, months).filter(x => x.plan || x.act).map(x => { const lv = x.act == null ? null : x.act - x.plan; return <tr key={x.l.id} className="mini"><td className="ind" style={{ paddingLeft: 40 }}>{x.l.name}{us.length > 1 ? ` · ${unitName(x.u)}` : ''}{x.qplan != null && <span className="mini"> — qty {fmt(x.qact, 0)} / {fmt(x.qplan, 0)} {x.l.uom || ''}</span>}</td><td className="n">{money(x.base)}</td><td className="n">{money(x.plan)}</td><td className="n">{x.act == null ? <span title="Finance recorded this group as one figure">group only</span> : money(x.act)}</td><td className={'n' + vtone(r, lv)}>{money(lv)}</td><td className="n">{x.act != null && x.plan ? pct(x.act / x.plan) : ''}</td></tr>; }) : [])]; })}
          </tbody></table></div></>; }
      // period-on-period analysis on actuals
      const qOf = (m: number) => Math.ceil(m / 3); const cq = qOf(last);
      const [aM, bM, aL, bL] = cmp === 'mom' ? [[mon], mon > 1 ? [mon - 1] : [], MONTHS[mon - 1], mon > 1 ? MONTHS[mon - 2] : '—']
        : cmp === 'qoq' ? [rng(cq * 3 - 2, last), cq > 1 ? periodMonths({ t: 'Q', n: cq - 1 }) : [], `Q${cq}${last % 3 ? ' to date' : ''}`, cq > 1 ? `Q${cq - 1}` : '—']
        : [rng(1, last), rng(1, last), `Actual YTD`, `Plan YTD`];
      const A = incomeStatement(db, us, aM as number[], detail), B = (bM as number[]).length ? incomeStatement(db, us, bM as number[], detail) : null, FY = incomeStatement(db, us, rng(1, 12), detail);
      return <><p className="note" style={{ marginTop: 0 }}>{cmp === 'mom' ? 'Month on month: actuals of the chosen month against the month before.' : cmp === 'qoq' ? 'Quarter on quarter: actuals of the current quarter (to date) against the previous quarter.' : 'Year to date: actuals against plan for the same months, and against the full-year plan.'}</p>
        <div className="tw"><table className="t"><thead><tr><th>{name}</th><th className="n">{aL}</th><th className="n">{bL}</th><th className="n">Change</th><th className="n">Change %</th>{cmp === 'ytd' && <><th className="n">Full-year plan</th><th className="n">% of year</th></>}</tr></thead><tbody>
          {A.map((r, i) => { const a = r.act; const b = cmp === 'ytd' ? r.plan : B ? B[i].act : null; const d = a == null || b == null ? null : a - b; const f = FY[i].plan;
            return <tr key={r.label + i} className={r.bold ? 'b' : ''}><td className={r.indent ? 'ind' : ''}>{r.label}</td><td className="n">{money(a)}</td><td className="n">{money(b)}</td><td className={'n' + vtone(r, d)}>{money(d)}</td><td className="n">{dpct(a, b)}</td>{cmp === 'ytd' && <><td className="n">{money(f)}</td><td className="n">{a != null && f ? pct(a / f) : ''}</td></>}</tr>; })}
        </tbody></table></div></>; })()}

    {tab === 'mis' && (() => { const per12 = rng(1, 12).map(m => incomeStatement(db, us, [m], detail)); const base = per12[0]; const yr = incomeStatement(db, us, rng(1, 12), detail);
      const cell = (m: number, i: number) => { const r = per12[m - 1][i]; return misKind === 'plan' ? r.plan : m <= last ? r.act : r.plan; };
      // year column: lines add up, but profit tax is worked out on the year's profit before tax (none when it is negative)
      const iPbt = base.findIndex(r => r.key === 'pbt'), rate = Number(db.settings.tax_rate?.rate ?? 30) / 100;
      const yearOf = (i: number) => { const k = base[i].key; const pbtY = sum(rng(1, 12).map(m => cell(m, iPbt) || 0)); if (k === 'tax') return Math.max(0, pbtY) * rate; if (k === 'ni') return pbtY - Math.max(0, pbtY) * rate; return sum(rng(1, 12).map(m => cell(m, i) || 0)); };
      return <><div className="row" style={{ marginBottom: 6 }}><Seg value={misKind} options={[['act', `Actuals to ${MONTHS[last - 1]}, plan after`], ['plan', 'Plan only']]} onChange={setMisKind} /><span className="sp" />
        <Export name="monthly-income-statement" rows={() => [['Line', ...MONTHS, 'Year'], ...base.map((r, i) => [r.label, ...rng(1, 12).map(m => cell(m, i)), yearOf(i)])]} /></div>
        <div className="tw"><table className="t"><thead><tr><th className="first">{name}</th>{MONTHS.map((m, i) => <th key={m} className="n" style={misKind === 'act' && i + 1 > last ? { fontStyle: 'italic', opacity: .7 } : undefined}>{m}{misKind === 'act' && i + 1 > last ? ' (plan)' : ''}</th>)}<th className="n">Year</th><th className="n">Year plan</th></tr></thead><tbody>
          {base.map((r, i) => <tr key={r.label + i} className={r.bold ? 'b' : ''}><td className={'first' + (r.indent ? ' ind' : '')}>{r.label}</td>{rng(1, 12).map(m => { const v = cell(m, i); return <td key={m} className={'n' + (v != null && v < 0 ? ' neg' : '')} style={misKind === 'act' && m > last ? { fontStyle: 'italic', opacity: .7 } : undefined}>{money(v)}</td>; })}<td className="n">{money(yearOf(i))}</td><td className="n">{money(yr[i].plan)}</td></tr>)}
        </tbody></table></div><p className="note">Italic months are still plan; they switch to actuals as Finance records them. Profit tax is only charged on a positive profit before tax — each month on its own, and the year on the year's total.</p></>; })()}

    {tab === 'co' && (() => { const cols = us.map(u => ({ u, r: incomeStatement(db, [u], months, false) })); const g = incomeStatement(db, us, months, false);
      return <><div className="row" style={{ marginBottom: 6 }}><span className="mini">Actual · plan underneath · {per === 'month' ? MONTHS[mon - 1] : per.toUpperCase()}</span><span className="sp" /><Export name="by-company" rows={() => [['Line', ...us.map(u => unitName(u) + ' actual'), ...us.map(u => unitName(u) + ' plan'), 'Group actual', 'Group plan'], ...g.map((r, i) => [r.label, ...cols.map(c => c.r[i].act), ...cols.map(c => c.r[i].plan), r.act, r.plan])]} /></div>
        <div className="tw"><table className="t"><thead><tr><th>Line</th>{cols.map(c => <th key={c.u} className="n">{unitName(c.u)}</th>)}{us.length > 1 && <th className="n">Group</th>}</tr></thead><tbody>
          {g.map((r, i) => <tr key={r.label} className={r.bold ? 'b' : ''}><td>{r.label}</td>{[...cols.map(c => c.r[i]), ...(us.length > 1 ? [r] : [])].map((x, j) => <td key={j} className={'n' + (x.act != null && x.act < 0 ? ' neg' : '')}>{money(x.act)}<div className="mini">{money(x.plan)}</div></td>)}</tr>)}
          <tr><td className="mini">Gross margin</td>{[...cols.map(c => c.r), ...(us.length > 1 ? [g] : [])].map((x, j) => { const rv = IS_KEY(x, 'rev'), gp = IS_KEY(x, 'gp'); return <td key={j} className="n mini">{rv.act ? pct((gp.act || 0) / rv.act) : '—'}</td>; })}</tr>
          <tr><td className="mini">Net margin</td>{[...cols.map(c => c.r), ...(us.length > 1 ? [g] : [])].map((x, j) => { const rv = IS_KEY(x, 'rev'), ni = IS_KEY(x, 'ni'); return <td key={j} className="n mini">{rv.act ? pct((ni.act || 0) / rv.act) : '—'}</td>; })}</tr>
        </tbody></table></div></>; })()}

    {tab === 'cos' && <CosBreakdown db={db} us={us} months={months} name={name} />}

    {tab === 'cf' && (() => { const cf = cashFlow(db, us); if (!cf.items.length && !cf.actualSource) return <Empty>No cash flow plan for {name}.</Empty>; const neg = cf.plan.close.findIndex((v: number | null) => v != null && v < 0);
      return <>{cf.items.length > 0 && <div className={'banner ' + (neg >= 0 ? 'bad' : 'good')}>{neg >= 0 ? `Planned closing cash goes below zero in ${MONTHS[neg]}: the plan is not cash positive from there.` : 'Planned closing cash stays positive all year.'}</div>}
        <LineChart labels={MONTHS} series={[{ name: 'Closing cash — plan', values: cf.plan.close, color: 'var(--accent)' }, { name: 'Closing cash — actual', values: cf.actual.close, color: 'var(--good)' }]} fmtY={v => money(v)} />
        {cf.actualSource && <p className="note">Actual cash: {cf.actualSource}.</p>}
        <div className="tw" style={{ marginTop: 10 }}><table className="t"><thead><tr><th className="first">{name}</th>{MONTHS.map(m => <th key={m} className="n">{m}</th>)}<th className="n">Year</th></tr></thead><tbody>
          <tr className="g"><td className="first">Opening cash</td><td className="n">{money(cf.opening.plan)}</td><td colSpan={12} className="note">actual opening {money(cf.opening.actual)}</td></tr>
          {(['in', 'out'] as const).map(dir => [<tr key={dir} className="g"><td className="first" colSpan={14}>{dir === 'in' ? 'Cash in (plan)' : 'Cash out (plan)'}</td></tr>,
            ...cf.items.filter((i: Row) => i.direction === dir).map((i: Row) => { const pl = MONTHS.map((_, m) => cf.val(i.id, m + 1, 'plan')); return <tr key={i.id}><td className="first ind">{i.item}</td>{pl.map((v, m) => <td key={m} className="n">{money(v)}</td>)}<td className="n">{money(sum(pl))}</td></tr>; })])}
          {(['inn', 'out'] as const).map(k => <tr key={k}><td className="first">{k === 'inn' ? 'Cash in — actual' : 'Cash out — actual'}</td>{cf.actual[k].map((v: number | null, m: number) => <td key={m} className="n">{money(v)}</td>)}<td className="n">{money(sum(cf.actual[k].map((v: number | null) => v || 0)))}</td></tr>)}
          {(['plan', 'actual'] as const).map(k => <tr key={k} className="b"><td className="first">Closing cash — {k}</td>{cf[k].close.map((v: number | null, m: number) => <td key={m} className={'n' + (v != null && v < 0 ? ' neg' : '')}>{money(v)}</td>)}<td /></tr>)}
        </tbody></table></div></>; })()}

    {tab === 'wcf' && (() => { const rows = db.cash_weekly.filter(w => us.includes(w.unit_id)); if (!rows.length) return <Empty>No weekly cash records for {name}. They come from the weekly tracker's cash section.</Empty>;
      const weeks = Array.from(new Set(rows.map(r => r.week_start))).sort(); const V = (w: string, d: string, k: string) => sum(rows.filter(r => r.week_start === w && r.direction === d).map(r => Number(r[k]) || 0));
      let cum = 0; const data = weeks.map(w => { const i = V(w, 'in', 'actual'), o = V(w, 'out', 'actual'); cum += i - o; return { w, i, o, pi: V(w, 'in', 'planned'), po: V(w, 'out', 'planned'), net: i - o, cum }; });
      return <><div className="card"><h3>Weekly cash in and out — actual</h3><BarChart labels={data.map(d => weekLabel(new Date(d.w + 'T00:00:00Z')))} series={[{ name: 'In', values: data.map(d => d.i), color: 'var(--good)' }, { name: 'Out', values: data.map(d => d.o), color: 'var(--bad)' }]} fmtY={money} height={180} /></div>
        <div className="row" style={{ margin: '10px 0 6px' }}><span className="sp" /><Export name="weekly-cash" rows={() => [['Week', 'Planned in', 'Actual in', 'Planned out', 'Actual out', 'Net', 'Cumulative net'], ...data.map(d => [d.w, d.pi, d.i, d.po, d.o, d.net, d.cum])]} /></div>
        <div className="tw"><table className="t"><thead><tr><th>Week</th><th className="n">Planned in</th><th className="n">Actual in</th><th className="n">Planned out</th><th className="n">Actual out</th><th className="n">Net</th><th className="n" data-tip="Running total of net cash since the first week recorded.">Cumulative net</th></tr></thead><tbody>
          {data.map(d => <tr key={d.w}><td>{weekLabel(new Date(d.w + 'T00:00:00Z'))}</td><td className="n">{money(d.pi)}</td><td className="n">{money(d.i)}</td><td className="n">{money(d.po)}</td><td className="n">{money(d.o)}</td><td className={'n' + (d.net < 0 ? ' neg' : '')}>{money(d.net)}</td><td className={'n' + (d.cum < 0 ? ' neg' : '')}>{money(d.cum)}</td></tr>)}
        </tbody></table></div></>; })()}

    {tab === 'trend' && (() => { const S = (k: string, a: boolean) => MONTHS.map((_, i) => { const r = IS_KEY(incomeStatement(db, us, [i + 1], false), k); return a ? (i + 1 <= last ? r.act : null) : r.plan; });
      return <div className="drill">{([['rev', 'Revenue', 'var(--accent)'], ['gp', 'Gross profit', 'var(--good)'], ['opex', 'Operating expenses', 'var(--bad)'], ['ni', 'Net income', 'var(--accent)']] as const).map(([k, l, c]) =>
        <div key={k} className="card"><h3>{l}</h3><BarChart labels={MONTHS} series={[{ name: 'Plan', values: S(k, false), color: 'var(--line2)' }, { name: 'Actual', values: S(k, true), color: c }]} fmtY={money} /></div>)}</div>; })()}

    {tab === 'lines' && (() => { const SN: Row = { rev: 'Revenue', cos: 'Cost of sales', opex: 'Opex', capex: 'Capex' };
      const rows = ['rev', 'cos', 'opex', 'capex'].flatMap(sec => Array.from(new Set(us.flatMap(u => linesOf(db, u, sec).map(l => l.line_group || 'Other')))).map(g => { const pl = sum(us.map(u => planBy(db, u, sec, months, [g]))); const av = us.map(u => actualBy(db, u, sec, months, [g])); const a = av.every(x => x == null) ? null : sum(av); return { sec, g, pl, a, items: lineItems(db, us, sec, g, months) }; })).filter(r => r.pl || r.a);
      const ach = (sec: string, a: number | null, pl: number) => a != null && pl ? <><Bar p={a / pl} tone={sec === 'rev' ? undefined : a > pl ? 'bad' : 'good'} /> {pct(a / pl)}</> : '';
      return <><div className="row" style={{ marginBottom: 6 }}><span className="mini">Click a group to see its lines. Quantities show for lines planned by quantity.</span><span className="sp" /><button className="btn sm" onClick={() => setOpenG(new Set(openG.size ? [] : rows.map(r => r.sec + '|' + r.g)))}>{openG.size ? 'Collapse all' : 'Expand all'}</button>
        <Export name="plan-vs-actual-by-line" rows={() => [['Section', 'Group', 'Line', 'Unit', 'Qty plan', 'Qty actual', 'Plan', 'Actual', 'Achieved'], ...rows.flatMap(r => [[r.sec, r.g, '', '', '', '', r.pl, r.a, r.a != null && r.pl ? pct(r.a / r.pl) : ''], ...r.items.map(x => [r.sec, r.g, x.l.name, x.l.uom || '', x.qplan, x.qact, x.plan, x.act, x.act != null && x.plan ? pct(x.act / x.plan) : ''])])]} /></div>
        <div className="tw"><table className="t"><thead><tr><th>Section</th><th>Product group / budget line</th><th className="n">Qty plan</th><th className="n">Qty actual</th><th className="n">Plan</th><th className="n">Actual</th><th>Achieved</th></tr></thead><tbody>{rows.map(r => { const k = r.sec + '|' + r.g; const on = openG.has(k); const qp = r.items.some(x => x.qplan != null) ? sum(r.items.map(x => x.qplan)) : null; const qa = r.items.some(x => x.qact != null) ? sum(r.items.map(x => x.qact)) : null;
          return [<tr key={k} className="click" onClick={() => tg(k)}><td>{SN[r.sec]}</td><td><b>{on ? '▾' : '▸'} {r.g}</b> <span className="mini">{r.items.length} lines</span></td><td className="n mini">{qp == null ? '' : fmt(qp, 0)}</td><td className="n mini">{qa == null ? '' : fmt(qa, 0)}</td><td className="n">{money(r.pl)}</td><td className="n">{money(r.a)}</td><td>{ach(r.sec, r.a, r.pl)}</td></tr>,
            ...(on ? r.items.filter(x => x.plan || x.act || x.qact).map(x => <tr key={x.l.id}><td /><td className="ind mini" style={{ paddingLeft: 28 }}>{x.l.name}{us.length > 1 ? ` · ${unitName(x.u)}` : ''}</td><td className="n mini">{x.qplan == null ? '' : `${fmt(x.qplan, 0)} ${x.l.uom || ''}`}</td><td className="n mini">{x.qact == null ? (x.qplan != null ? '—' : '') : fmt(x.qact, 0)}</td><td className="n mini">{money(x.plan)}</td><td className="n mini">{x.act == null ? <span title="Finance recorded this group as one figure">group only</span> : money(x.act)}</td><td className="mini">{ach(r.sec, x.act, x.plan)}</td></tr>) : [])]; })}</tbody></table></div></>; })()}
    <p className="note">Profit tax is applied at the rate set in Studio → Framework ({Number(db.settings.tax_rate?.rate ?? 30)}%) on positive profit before tax; depreciation and financial charges come from the budget lines named that way.</p>
  </>;
}

/** Cost of sales by product group, with each group's cost against its revenue and expandable to the planned items. */
function CosBreakdown({ db, us, months, name }: { db: DB; us: string[]; months: number[]; name: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const groups = Array.from(new Set(us.flatMap(u => linesOf(db, u, 'cos').map(l => l.line_group || 'Other'))));
  const A = (sec: string, g: string) => { const v = us.map(u => actualBy(db, u, sec, months, [g])); return v.every(x => x == null) ? null : sum(v); };
  const rows = groups.map(g => ({ g, pl: sum(us.map(u => planBy(db, u, 'cos', months, [g]))), a: A('cos', g), rp: sum(us.map(u => planBy(db, u, 'rev', months, [g]))), ra: A('rev', g) })).filter(r => r.pl || r.a).sort((a, b) => (b.a ?? b.pl) - (a.a ?? a.pl));
  const tot = { pl: sum(rows.map(r => r.pl)), a: rows.some(r => r.a != null) ? sum(rows.map(r => r.a || 0)) : null };
  if (!rows.length) return <Empty>No cost of sales lines for {name}.</Empty>;
  return <><div className="row" style={{ marginBottom: 6 }}><span className="mini">Click a group to see its cost lines (line actuals where Finance records them).</span><span className="sp" /><Export name="cost-of-sales" rows={() => [['Product group', 'Plan', 'Actual', 'Variance', 'Share of COS', 'Cost ÷ revenue (actual)'], ...rows.map(r => [r.g, r.pl, r.a, r.a == null ? null : r.a - r.pl, tot.a ? pct((r.a || 0) / tot.a) : '', r.ra ? pct((r.a || 0) / r.ra) : ''])]} /></div>
    <div className="tw"><table className="t"><thead><tr><th>Product group</th><th className="n">Plan</th><th className="n">Actual</th><th className="n" data-tip="Actual − plan; red when cost is above plan.">Variance</th><th className="n" data-tip="This group's share of total actual cost of sales.">Share</th><th className="n" data-tip="Cost of sales ÷ revenue for the same group: 100% − gross margin. Plan figure underneath.">Cost ÷ revenue</th></tr></thead><tbody>
      {rows.map(r => { const v = r.a == null ? null : r.a - r.pl; const items = us.flatMap(u => linesOf(db, u, 'cos').filter(l => (l.line_group || 'Other') === r.g));
        return [<tr key={r.g} className="click" onClick={() => setOpen(open === r.g ? null : r.g)}><td><b>{open === r.g ? '▾' : '▸'} {r.g}</b></td><td className="n">{money(r.pl)}</td><td className="n">{money(r.a)}</td><td className={'n' + (v != null && v > 0 ? ' neg' : '')}>{money(v)}</td><td className="n">{tot.a ? pct((r.a || 0) / tot.a) : ''}</td><td className="n">{r.ra ? pct((r.a || 0) / r.ra) : '—'}<div className="mini">{r.rp ? pct(r.pl / r.rp) : ''}</div></td></tr>,
          ...(open === r.g ? items.map(l => { const lp = sum(months.map(m => lineVals(l, false)[m - 1])); return <tr key={l.id}><td className="ind mini">{l.name}</td><td className="n mini">{money(lp)}</td>{(() => { const la = lineActual(db, l.id, months); return <><td className="n mini">{la == null ? 'group only' : money(la)}</td><td className="mini" colSpan={3}>{la != null ? <>{money(la - lp)} vs plan</> : ''}</td></>; })()}</tr>; }) : [])]; })}
      <tr className="b"><td>Total cost of sales</td><td className="n">{money(tot.pl)}</td><td className="n">{money(tot.a)}</td><td className="n">{money(tot.a == null ? null : tot.a - tot.pl)}</td><td /><td /></tr>
    </tbody></table></div></>;
}

export default function Reports() {
  const { db, unit, can, units, allUnits, setAllUnits, line, me } = useData(); const [sp, setSp] = useSearchParams(); const tab0 = sp.get('tab') || (line ? 'monthly' : 'summary'); const tab = line && !['monthly', 'weekly'].includes(tab0) ? 'monthly' : tab0; const [p, setP] = usePeriod();
  if (!db || !unit) return null;
  const scope = can('seeGroup') && allUnits ? 'group' : 'unit';
  const us = scope === 'group' ? units.map(u => u.id) : [unit]; const name = scope === 'group' ? 'All units combined' : byId(db.org_units, unit)?.name || '';
  const tabs: [string, string][] = line ? [['monthly', 'Monthly deliverables'], ['weekly', 'Weekly activities']] : [['summary', 'Summary'], ['okr', 'OKRs & goals'], ['org', 'Organisation & people'], ['monthly', 'Monthly deliverables'], ['weekly', 'Weekly activities'], ['fin', 'Financial']];
  return <Page title="Reports" desc="Operational, OKR, organisational, work and financial performance — for one unit or all units combined." help={<>
    <p><b>Summary</b> — each unit's OKR score, key-result status, revenue and budget use, deliverables and average person result for the period.</p>
    <p><b>OKRs & goals</b> — score by quarter and pillar, then every goal, objective or key result with target, actual and status (pace-adjusted while a period is running).</p>
    <p><b>Organisation & people</b> — every unit, department and division with its score per quarter, people and deliverables; people by performance band.</p>
    <p><b>Monthly deliverables</b> — every deliverable of the period line by line (owner, key result, weight, target, achieved, status, rating) or by person, with totals.</p><p><b>Weekly activities</b> — every activity of the chosen week line by line or by person, with totals, then the 8-week trend, departments and open blockers.</p>
    <p><b>Financial</b> — income statement (profitability), cash flow (cash positivity), monthly trends and plan vs actual by product group and budget line.</p>
    <p>Every table can be exported to CSV.</p></>}>
    <div className="cmdbar"><UnitPicker allowAll /><span className="sp" />{tab !== 'fin' && tab !== 'weekly' && <PeriodPicker value={p} onChange={setP} />}</div>
    <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" className={tab === k ? 'on' : ''} onClick={() => setSp({ tab: k })}>{l}</button>)}</div>
    {tab === 'summary' && <Summary db={db} us={us} p={p} />}
    {tab === 'okr' && <OkrReport db={db} us={us} p={p} />}
    {tab === 'org' && <OrgReport db={db} us={us} p={p} />}
    {line && <p className="note" style={{ marginBottom: 8 }}>Showing {byId(db.org_units, me?.org_unit_id)?.name} and the organisations below it.</p>}
    {(tab === 'monthly' || tab === 'work') && <MonthlyReport db={db} us={us} p={p} people={line?.people} />}
    {tab === 'weekly' && <WeeklyReport db={db} us={us} people={line?.people} />}
    {tab === 'fin' && (us.some(u => db.plan_lines.some(l => l.unit_id === u) || db.actuals.some(a => a.unit_id === u)) ? <Financial db={db} us={us} name={name} /> : <Empty>{name} has no revenue or budget plan, so there is no financial report for it.{can('seeGroup') && <> <button className="btn sm pri" onClick={() => setAllUnits(true)}>See all units combined</button></>}</Empty>)}
  </Page>;
}
