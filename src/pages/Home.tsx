import { Link, useNavigate } from 'react-router-dom';
import { useData, byId, type DB, type Row } from '../lib/data';
import { orgScore, personResult, krState, pct, money, planBy, actualBy, lastActualMonth, krsOf, weekStart, ymd, MONTHS, bandOf, currentPeriod, periodLabel, workStats, delivScore, subtreeIds, curMonth, incomeStatement, cashFlow, sum, type Period } from '../lib/calc';
import { Page, Pill, Bar, Ring, BarChart, LineChart, StatusStack, usePeriod, PeriodPicker, StatePill } from '../lib/ui';
import { planStatus } from './OkrPlan';
import { openRescope } from './AnnualPlan';
import { statusCounts, unitKrs } from './Goals';

function todosFor(db: DB, me: Row, unit: string, can: (c: string) => boolean): [string, string, string][] {
  const todos: [string, string, string][] = [];
  const wk = ymd(weekStart(new Date()));
  const myActs = db.activities.filter(a => a.owner_position_id === me.id && a.week_start === wk);
  if (!myActs.length) todos.push(["Plan this week's activities", 'Update before Saturday 2:00 PM.', '/week']);
  else if (myActs.some(a => a.status !== 'Done')) todos.push([`${myActs.filter(a => a.status !== 'Done').length} activities to update this week`, 'Status and % done before the cut-off.', '/week']);
  const m = curMonth();
  const toDeliver = db.deliverables.filter(d => d.owner_position_id === me.id && d.month <= m && ['planned', 'returned'].includes(d.status));
  if (toDeliver.length) todos.push([`${toDeliver.length} deliverable${toDeliver.length > 1 ? 's' : ''} to deliver`, 'Mark done with evidence in Work → Month.', '/deliverables']);
  if (can('managePeople')) { const acc = db.deliverables.filter(d => d.unit_id === unit && d.status === 'done' && d.owner_position_id !== me.id).length; if (acc) todos.push([`${acc} deliverable${acc > 1 ? 's' : ''} to accept`, 'Accept or return in Work → Team.', '/week']); }
  const stale = db.key_results.filter(k => k.owner_position_id === me.id && k.measure === 'manual' && !db.check_ins.some(c => c.kr_id === k.id && c.created_at > new Date(Date.now() - 30 * 864e5).toISOString()));
  if (stale.length) todos.push([`${stale.length} key result${stale.length > 1 ? 's' : ''} to check in`, 'No check-in in the last 30 days.', '/goals']);
  if (can('approve')) {
    const cl = db.position_claims.filter(c => c.status === 'Pending').length;
    if (cl) todos.push([`${cl} sign-in${cl > 1 ? 's' : ''} waiting to be linked to a position`, 'Confirm or reject in Settings → People & access.', '/studio/people']);
    db.plan_status.filter(s => s.status === 'Submitted' || (s.status === 'Endorsed' && can('finalApprove'))).forEach(s => todos.push([`${byId(db.org_units, s.unit_id)?.name}: ${s.plan_kind === 'okr' ? 'OKR plan' : 'annual plan'} to approve`, 'Approve or return with a note.', s.plan_kind === 'okr' ? '/studio/okr' : '/studio/revenue']));
    db.rescopes.filter(r => r.status === 'Submitted').forEach(r => todos.push([`${byId(db.org_units, r.unit_id)?.name}: rescope to decide`, r.trigger, '/studio/rescope']));
  }
  if (can('editOKR')) { const st = planStatus(db, unit, 'okr')?.status; if (!st || st === 'Draft' || st === 'Returned') todos.push(['OKR plan 2026/27 not submitted', st === 'Returned' ? 'Returned by Group Strategy — see the note.' : 'Review, weight and submit.', '/studio/okr']); }
  if (can('editPlan') && openRescope(db, unit)) todos.push(['A rescope is open', 'Finish the changes and submit it.', '/studio/rescope']);
  return todos;
}

export function Financial({ db, units, label }: { db: DB; units: string[]; label: string }) {
  const last = Math.max(0, ...units.map(u => lastActualMonth(db, u)));
  const ms = Array.from({ length: Math.max(last, 1) }, (_, i) => i + 1);
  const is = incomeStatement(db, units, ms); const R = (l: string) => is.find(r => r.label === l)!;
  const rev = R('Revenue'), gp = R('Gross profit'), op = is[is.length - 1], opex = R('Operating expenses');
  const rp = MONTHS.map((_, i) => sum(units.map(u => planBy(db, u, 'rev', [i + 1])))); const ra = MONTHS.map((_, i) => { const v = units.map(u => actualBy(db, u, 'rev', [i + 1])); return v.every(x => x == null) ? null : sum(v); });
  const cf = cashFlow(db, units); const hasCash = cf.items.length > 0; const minCash = hasCash ? Math.min(...(cf.plan.close.filter((v: number | null) => v != null) as number[])) : null;
  if (!rev.plan && !opex.plan) return <div className="card"><h2>Financial performance</h2><p className="note">{label} has no revenue plan; its budget use is shown under Plan → Budget.</p>
    <div className="kpis" style={{ marginTop: 10 }}><div className="tile"><div className="tv">{money(opex.act)}</div><div className="tl">Spent to {MONTHS[ms.length - 1]}</div><div className="ts">budget {money(opex.plan)}</div></div><div className="tile"><div className="tv">{opex.act != null && opex.plan ? pct(opex.act / opex.plan) : '—'}</div><div className="tl">Budget used</div></div></div></div>;
  return <div className="card"><div className="row"><h2 style={{ flex: 1 }}>Financial performance</h2><span className="note">to end of {last ? MONTHS[last - 1] : '—'} (latest Finance actuals)</span><Link to="/insights/reports?tab=fin">Reports →</Link></div>
    <div className="kpis" style={{ marginTop: 10 }}>
      <div className="tile"><div className="tv">{rev.plan ? pct((rev.act || 0) / rev.plan) : '—'}</div><div className="tl">Revenue achieved</div><div className="ts">{money(rev.act)} of {money(rev.plan)}</div></div>
      <div className="tile"><div className="tv">{rev.act ? pct((gp.act || 0) / rev.act) : '—'}</div><div className="tl">Gross margin</div><div className="ts">plan {rev.plan ? pct(gp.plan / rev.plan) : '—'}</div></div>
      <div className={'tile ' + (op.act != null && op.act < 0 ? 'bad' : '')}><div className="tv">{money(op.act)}</div><div className="tl">Operating profit</div><div className="ts">plan {money(op.plan)}</div></div>
      <div className="tile"><div className="tv">{opex.act != null && opex.plan ? pct(opex.act / opex.plan) : '—'}</div><div className="tl">Opex vs budget</div><div className="ts">{money(opex.act)} of {money(opex.plan)}</div></div>
      {hasCash && <div className={'tile ' + (minCash != null && minCash < 0 ? 'bad' : 'good')}><div className="tv">{money(minCash)}</div><div className="tl">Lowest planned cash</div><div className="ts">{minCash != null && minCash < 0 ? 'goes negative' : 'stays positive'}</div></div>}
    </div>
    <BarChart labels={MONTHS} series={[{ name: 'Revenue plan', values: rp, color: 'var(--line2)' }, { name: 'Revenue actual', values: ra, color: 'var(--accent)' }]} fmtY={v => money(v)} />
  </div>;
}

export function Operational({ db, unit, p }: { db: DB; unit: string; p: Period }) {
  const krs = unitKrs(db, unit); const ids = subtreeIds(db, unit); const pos = new Set(db.positions.filter(x => ids.has(x.org_unit_id)).map(x => x.id));
  const wk = ymd(weekStart(new Date())); const ws = workStats(db, pos, wk); const dm = delivScore(db, pos, { t: 'M', n: curMonth() });
  const trend = Array.from({ length: curMonth() }, (_, i) => orgScore(db, unit, { t: 'M', n: i + 1 }));
  const behind = krs.map(k => ({ k, s: krState(db, k, p) })).filter(x => x.s.tone === 'bad').sort((a, b) => (a.s.ratio ?? 0) - (b.s.ratio ?? 0)).slice(0, 6);
  const nav = useNavigate();
  return <div className="card"><div className="row"><h2 style={{ flex: 1 }}>Operational performance</h2><Link to="/insights/reports?tab=okr">Reports →</Link></div>
    <div className="kpis" style={{ marginTop: 10 }}>
      <div className="tile click" onClick={() => nav('/insights/performance')}><div className="row"><Ring p={orgScore(db, unit, p)} size={50} /><div><div className="tl">OKR score · {periodLabel(p)}</div><div className="ts">{db.objectives.filter(o => o.unit_id === unit).length} objectives</div></div></div></div>
      <div className="tile" style={{ gridColumn: 'span 2' }}><div className="tl" style={{ marginBottom: 6 }}>Key results · {periodLabel(p)} (pace-adjusted)</div><StatusStack counts={statusCounts(db, krs, p)} /></div>
      <div className="tile click" onClick={() => nav('/week')}><div className="tv">{pct(ws.completion)}</div><div className="tl">This week's work done</div><div className="ts">{ws.done}/{ws.total} activities · {ws.stuck} stuck</div></div>
      <div className="tile click" onClick={() => nav('/deliverables')}><div className="tv">{dm.due ? `${dm.accepted}/${dm.due}` : '—'}</div><div className="tl">{MONTHS[curMonth() - 1]} deliverables accepted</div><div className="ts">{dm.done} waiting for acceptance</div></div>
    </div>
    <div className="drill"><div><h4>OKR score by month</h4><LineChart labels={MONTHS.slice(0, curMonth())} series={[{ name: 'Score', values: trend.map(v => v == null ? null : v * 100), color: 'var(--accent)' }]} fmtY={v => Math.round(v) + '%'} height={150} /></div>
      <div><h4>Off track — {periodLabel(p)}</h4>{behind.length ? behind.map(({ k, s }) => <div key={k.id} className="lg row"><span style={{ flex: 1 }}>{k.title}<div className="mini">{byId(db.objectives, k.objective_id)?.text}</div></span><Bar p={s.progress} /><StatePill s={s} /></div>) : <p className="note">Nothing off track.</p>}</div></div>
  </div>;
}

export function GroupBoard({ db, p }: { db: DB; p: Period }) {
  const { units, setUnit } = useData(); const nav = useNavigate(); const wk = ymd(weekStart(new Date()));
  const rows = units.map(u => { const ids = subtreeIds(db, u.id); const pos = new Set(db.positions.filter(x => ids.has(x.org_unit_id)).map(x => x.id)); const last = lastActualMonth(db, u.id); const ms = Array.from({ length: Math.max(last, 1) }, (_, i) => i + 1);
    const rp = planBy(db, u.id, 'rev', ms), ra = actualBy(db, u.id, 'rev', ms); const ws = workStats(db, pos, wk);
    return { u, score: orgScore(db, u.id, p), rev: rp ? (ra || 0) / rp : null, ws, counts: statusCounts(db, unitKrs(db, u.id), p) }; });
  return <div className="card"><h2>Units at a glance · {periodLabel(p)}</h2><div className="tw" style={{ marginTop: 8 }}><table className="t"><thead><tr><th>Unit</th><th>OKR score</th><th>Key results</th><th>Revenue to date</th><th>This week's work</th></tr></thead><tbody>
    {rows.map(r => <tr key={r.u.id} className="click" onClick={() => { setUnit(r.u.id); nav('/insights/map'); }}><td><b>{r.u.name}</b><div className="mini">{r.u.unit_type === 'business' ? 'Business unit' : 'Function'}</div></td>
      <td><Bar p={r.score} /> {pct(r.score)}</td><td style={{ minWidth: 220 }}><StatusStack counts={r.counts} compact /></td><td>{r.rev == null ? <span className="note">no revenue plan</span> : <><Bar p={r.rev} /> {pct(r.rev)}</>}</td><td>{r.ws.total ? `${pct(r.ws.completion)} · ${r.ws.people} people` : <span className="note">none logged</span>}</td></tr>)}
  </tbody></table></div></div>;
}

export default function Home() {
  const { db, me, role, unit, can, units } = useData(); const [p, setP] = usePeriod(); if (!db || !me || !unit) return null;
  const u = byId(db.org_units, unit)!; const todos = todosFor(db, me, unit, can); const r = personResult(db, me, p); const group = can('seeGroup');
  return <Page title={`Hello, ${(me.holder_name || '').split(' ')[0] || 'there'}`} desc={group ? 'Group operational and financial performance, and what needs you.' : `${u.name}: how we are doing, and what needs you.`}>
    <div className="cmdbar">{group && <label className="scope"><span>Unit</span><UnitSel /></label>}<span className="sp" /><PeriodPicker value={p} onChange={setP} types={['M', 'Q', 'H', 'Y']} /></div>
    <div className="g2">
      <div className="card"><h2>What needs you</h2>{todos.length ? todos.slice(0, 8).map((t, i) => <Link key={i} to={t[2]} className="lg" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}><b>{t[0]}</b><div className="note">{t[1]}</div></Link>) : <p className="note">Nothing waiting. Well done.</p>}</div>
      <div className="card"><h2>My result · {periodLabel(p)}</h2><div className="row"><Ring p={r.R} size={64} /><div><div><b>{pct(r.R)}</b> · {bandOf(r.R, db)}</div><div className="note">{byId(db.org_units, me.org_unit_id)?.name} {pct(r.org)} × {Math.round(r.s * 100)}% + my part {pct(r.personal)} × {Math.round((1 - r.s) * 100)}%</div><div className="mini">{r.basis}</div><Link to="/me">Details →</Link></div></div></div>
    </div>
    {group && <div style={{ marginTop: 12 }}><GroupBoard db={db} p={p} /></div>}
    {group && <div style={{ marginTop: 12 }}><Financial db={db} units={units.map(x => x.id)} label="Pilot units combined" /></div>}
    {role !== 'employee' && <div style={{ marginTop: 12 }}><Operational db={db} unit={unit} p={p} /></div>}
    {role !== 'employee' && <div style={{ marginTop: 12 }}><Financial db={db} units={[unit]} label={u.name} /></div>}
    {role === 'employee' && <div style={{ marginTop: 12 }}><Operational db={db} unit={unit} p={p} /></div>}
  </Page>;
}
function UnitSel() { const { units, unit, setUnit } = useData(); return <select value={unit || ''} onChange={e => setUnit(e.target.value)}>{units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>; }

