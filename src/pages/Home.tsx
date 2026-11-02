import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData, byId, type DB, type Row } from '../lib/data';
import { orgScore, personResult, krState, pct, money, planBy, actualBy, lastActualMonth, krsOf, weekStart, ymd, MONTHS, bandOf, currentPeriod, periodLabel, workStats, delivScore, subtreeIds, curMonth, incomeStatement, cashFlow, sum, IS_KEY, type Period } from '../lib/calc';
import { Page, Pill, Bar, Ring, BarChart, LineChart, StatusStack, usePeriod, PeriodPicker, StatePill, Seg } from '../lib/ui';
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

const METRICS: [string, string][] = [['rev', 'Revenue'], ['gp', 'Gross profit'], ['gpm', 'Gross margin %'], ['opex', 'Operating expenses'], ['ebitda', 'EBITDA'], ['ebit', 'Operating profit'], ['ni', 'Net income'], ['cash', 'Closing cash']];
/** One financial block: pick a business unit or all combined, months or quarters, and the metric. */
export function Financial({ db, units, label }: { db: DB; units: string[]; label: string }) {
  const [scope, setScope] = useState<string>(units.length > 1 ? 'all' : units[0]); const [per, setPer] = useState<'M' | 'Q'>('M'); const [metric, setMetric] = useState('rev');
  const us = scope === 'all' || scope === 'compare' ? units : [scope];
  const last = Math.max(0, ...us.map(u => lastActualMonth(db, u))); const ms = Array.from({ length: Math.max(last, 1) }, (_, i) => i + 1);
  const is = incomeStatement(db, us, ms, false); const K = (k: string) => IS_KEY(is, k);
  const rev = K('rev'), gp = K('gp'), ni = K('ni'), opex = K('opex');
  const cols = per === 'M' ? MONTHS.map((_, i) => [i + 1]) : [1, 2, 3, 4].map(q => [q * 3 - 2, q * 3 - 1, q * 3]); const labels = per === 'M' ? MONTHS : ['Q1', 'Q2', 'Q3', 'Q4'];
  const val = (uu: string[], m: number[], kind: 'plan' | 'act') => { if (metric === 'cash') { const cf = cashFlow(db, uu); const v = cf[kind === 'plan' ? 'plan' : 'actual'].close[m[m.length - 1] - 1]; return v ?? null; }
    const r = incomeStatement(db, uu, m, false); if (metric === 'gpm') { const a = IS_KEY(r, 'gp'), b = IS_KEY(r, 'rev'); return kind === 'plan' ? (b.plan ? a.plan / b.plan * 100 : null) : (b.act ? (a.act || 0) / b.act * 100 : null); } const x = IS_KEY(r, metric); return kind === 'plan' ? x.plan : x.act; };
  const cf = cashFlow(db, us); const minCash = cf.items.length ? Math.min(...(cf.plan.close.filter((v: number | null) => v != null) as number[])) : null;
  const fmtY = metric === 'gpm' ? (v: number) => Math.round(v) + '%' : (v: number) => money(v);
  const name = (u: string) => byId(db.org_units, u)?.name || '';
  return <div className="card"><div className="row" style={{ gap: 8 }}><h2 style={{ flex: 1 }}>Financial performance</h2>
    {units.length > 1 && <select value={scope} onChange={e => setScope(e.target.value)} aria-label="Business unit"><option value="all">All units combined</option><option value="compare">Compare units</option>{units.map(u => <option key={u} value={u}>{name(u)}</option>)}</select>}
    <select value={metric} onChange={e => setMetric(e.target.value)} aria-label="Metric">{METRICS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><Seg value={per} options={[['M', 'Months'], ['Q', 'Quarters']]} onChange={setPer} /><Link to="/insights/reports?tab=fin">Reports →</Link></div>
    <p className="mini" style={{ margin: '4px 0 10px' }}>{scope === 'all' ? label : scope === 'compare' ? 'Each unit side by side' : name(scope)} · figures to the end of {last ? MONTHS[last - 1] : '—'} (latest Finance actuals)</p>
    <div className="kpis">
      <div className="tile" data-tip="Actual revenue ÷ planned revenue for the months with actuals."><div className="tv">{rev.plan ? pct((rev.act || 0) / rev.plan) : '—'}</div><div className="tl">Revenue achieved</div><div className="ts">{money(rev.act)} of {money(rev.plan)}</div></div>
      <div className="tile" data-tip="Gross profit ÷ revenue."><div className="tv">{rev.act ? pct((gp.act || 0) / rev.act) : '—'}</div><div className="tl">Gross margin</div><div className="ts">plan {rev.plan ? pct(gp.plan / rev.plan) : '—'}</div></div>
      <div className="tile" data-tip="Operating expenses (excluding depreciation and financial charges) actual ÷ budget."><div className="tv">{opex.plan ? pct((opex.act || 0) / opex.plan) : '—'}</div><div className="tl">Opex used</div><div className="ts">{money(opex.act)} of {money(opex.plan)}</div></div>
      <div className={'tile ' + (ni.act != null && ni.act < 0 ? 'bad' : '')} data-tip="Revenue − cost of sales − opex − depreciation − financial charges − profit tax."><div className="tv">{money(ni.act)}</div><div className="tl">Net income</div><div className="ts">plan {money(ni.plan)}</div></div>
      {minCash != null && <div className={'tile ' + (minCash < 0 ? 'bad' : 'good')} data-tip="Lowest month-end cash in the cash flow plan."><div className="tv">{money(minCash)}</div><div className="tl">Lowest planned cash</div></div>}
    </div>
    {scope === 'compare' ? <BarChart labels={units.map(name)} series={[{ name: 'Plan', values: units.map(u => val([u], ms, 'plan')), color: 'var(--line2)' }, { name: 'Actual', values: units.map(u => val([u], ms, 'act')), color: 'var(--accent)' }]} fmtY={fmtY} />
      : <BarChart labels={labels} series={[{ name: 'Plan', values: cols.map(m => val(us, m, 'plan')), color: 'var(--line2)' }, { name: 'Actual', values: cols.map(m => m[0] <= Math.max(last, metric === 'cash' ? 12 : 0) ? val(us, m, 'act') : null), color: 'var(--accent)' }]} fmtY={fmtY} />}
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
      <div className="tile click" onClick={() => nav('/insights/performance')}><div className="row"><Ring p={orgScore(db, unit, p)} size={50} /><div><div className="tl">OKR score · {periodLabel(p)}</div><div className="ts">{db.objectives.filter(o => o.unit_id === unit && o.status !== 'Archived').length} objectives</div></div></div></div>
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
    const man = unitKrs(db, u.id).filter(k => k.measure === 'manual'); const fresh = man.length ? man.filter(k => db.check_ins.some(c => c.kr_id === k.id && c.created_at > new Date(Date.now() - 30 * 864e5).toISOString())).length / man.length : null;
    return { u, score: orgScore(db, u.id, p), rev: rp ? (ra || 0) / rp : null, ws, counts: statusCounts(db, unitKrs(db, u.id), p), fresh }; });
  return <div className="card"><h2>Units at a glance · {periodLabel(p)}</h2><div className="tw" style={{ marginTop: 8 }}><table className="t"><thead><tr><th>Unit</th><th data-tip="Average score of the unit's own (unit-level) objectives for the period. Each objective's score combines its key results and, through the cascade, the department and division objectives below it.">OKR score</th><th data-tip="Status of all organisation key results (unit, department and division), judged on pace through the period. Personal ERP objectives are not counted.">Key results</th><th data-tip="Share of check-in key results updated in the last 30 days.">Updated</th><th>Revenue to date</th><th>This week's work</th></tr></thead><tbody>
    {rows.map(r => <tr key={r.u.id} className="click" onClick={() => { setUnit(r.u.id); nav('/insights/map'); }}><td><b>{r.u.name}</b><div className="mini">{r.u.unit_type === 'business' ? 'Business unit' : 'Function'}</div></td>
      <td><Bar p={r.score} /> {pct(r.score)}</td><td style={{ minWidth: 220 }}><StatusStack counts={r.counts} compact /></td><td>{pct(r.fresh)}</td><td>{r.rev == null ? <span className="note">no revenue plan</span> : <><Bar p={r.rev} /> {pct(r.rev)}</>}</td><td>{r.ws.total ? `${pct(r.ws.completion)} · ${r.ws.people} people` : <span className="note">none logged</span>}</td></tr>)}
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

