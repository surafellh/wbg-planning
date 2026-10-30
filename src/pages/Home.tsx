import { Link } from 'react-router-dom';
import { useData, byId, type Row } from '../lib/data';
import { orgScore, personResult, krProgress, statusOf, pct, money, planBy, actualBy, lastActualMonth, krsOf, weekStart, ymd, monthOf, MONTHS, bandOf } from '../lib/calc';
import { Page, Cmd, Pill, Bar, Ring } from '../lib/ui';
import { planStatus } from './OkrPlan';
import { openRescope } from './AnnualPlan';

export default function Home() {
  const { db, me, role, unit, can } = useData(); if (!db || !me || !unit) return null;
  const u = byId(db.org_units, unit)!;
  const todos: [string, string, string][] = [];
  const wk = ymd(weekStart(new Date()));
  const myActs = db.activities.filter(a => a.owner_position_id === me.id && a.week_start === wk);
  if (!myActs.length) todos.push(['Plan this week\'s activities', 'Update before Saturday 2:00 PM.', '/work']);
  else if (myActs.some(a => a.status !== 'Done')) todos.push([`${myActs.filter(a => a.status !== 'Done').length} activities to update this week`, 'Status and % done before the cut-off.', '/work']);
  const m = monthOf('2026/27', new Date());
  const toDeliver = db.deliverables.filter(d => d.owner_position_id === me.id && d.month <= m && ['planned', 'returned'].includes(d.status));
  if (toDeliver.length) todos.push([`${toDeliver.length} deliverable${toDeliver.length > 1 ? 's' : ''} to deliver`, 'Mark done with evidence in Work → Month.', '/work']);
  if (can('managePeople')) { const acc = db.deliverables.filter(d => d.unit_id === unit && d.status === 'done' && d.owner_position_id !== me.id).length; if (acc) todos.push([`${acc} deliverable${acc > 1 ? 's' : ''} to accept`, 'Accept or return in Work → Month (Team).', '/work']); }
  const myKrs = db.key_results.filter(k => k.owner_position_id === me.id && k.measure === 'manual');
  const stale = myKrs.filter(k => !db.check_ins.some(c => c.kr_id === k.id && c.created_at > new Date(Date.now() - 30 * 864e5).toISOString()));
  if (stale.length) todos.push([`${stale.length} key result${stale.length > 1 ? 's' : ''} to check in`, 'No check-in in the last 30 days.', '/goals/map']);
  if (can('approve')) {
    const sub = db.plan_status.filter(s => s.status === 'Submitted' || (s.status === 'Endorsed' && can('finalApprove')));
    sub.forEach(s => todos.push([`${byId(db.org_units, s.unit_id)?.name}: ${s.plan_kind === 'okr' ? 'OKR plan' : 'annual plan'} to approve`, 'Approve or return with a note.', s.plan_kind === 'okr' ? '/plan/okr' : '/plan/revenue']));
    db.rescopes.filter(r => r.status === 'Submitted').forEach(r => todos.push([`${byId(db.org_units, r.unit_id)?.name}: rescope to decide`, r.trigger, '/plan/rescope']));
  }
  if (can('editOKR')) { const st = planStatus(db, unit, 'okr')?.status; if (!st || st === 'Draft' || st === 'Returned') todos.push(['OKR plan 2026/27 not submitted', st === 'Returned' ? 'Returned by Group Strategy — see the note.' : 'Review, weight and submit.', '/plan/okr']); }
  if (can('editPlan') && openRescope(db, unit)) todos.push(['A rescope is open', 'Finish the changes and submit it.', '/plan/rescope']);
  const r = personResult(db, me);
  const last = lastActualMonth(db, unit);
  const ms = Array.from({ length: last }, (_, i) => i + 1);
  const revP = planBy(db, unit, 'rev', ms), revA = actualBy(db, unit, 'rev', ms);
  const objs = db.objectives.filter(o => o.unit_id === unit);
  const behind = objs.flatMap(o => krsOf(db, o.id)).map(k => ({ k, p: krProgress(db, k) })).filter(x => x.p != null && x.p < 0.7).sort((a, b) => (a.p as number) - (b.p as number)).slice(0, 6);
  return <Page title={`Hello, ${(me.holder_name || '').split(' ')[0] || 'there'}`} desc="What needs you, and how the unit is doing.">
    <Cmd />
    <div className="g2">
      <div className="card"><h2>What needs you</h2>{todos.length ? todos.map((t, i) => <Link key={i} to={t[2]} className="lg" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}><b>{t[0]}</b><div className="note">{t[1]}</div></Link>) : <p className="note">Nothing waiting. Well done.</p>}</div>
      <div className="card"><h2>My result so far</h2><div className="row"><Ring p={r.R} size={64} /><div><div><b>{pct(r.R)}</b> · {bandOf(r.R, db)}</div><div className="note">{byId(db.org_units, me.org_unit_id)?.name} {pct(r.org)} × {Math.round(r.s * 100)}% + my part {pct(r.personal)} × {Math.round((1 - r.s) * 100)}%</div><Link to="/performance">Details</Link></div></div></div>
    </div>
    {role !== 'employee' && <div className="g3" style={{ marginTop: 12 }}>
      <div className="tile"><div className="row"><Ring p={orgScore(db, unit)} size={48} /><div><div className="tl">{u.name} — objectives achieved (weighted)</div><div className="ts">{objs.length} objectives</div></div></div></div>
      <div className="tile"><div className="tv">{revP ? pct((revA || 0) / revP) : '—'}</div><div className="tl">Revenue against plan to {last ? MONTHS[last - 1] : '—'}</div><div className="ts">{money(revA)} of {money(revP)}</div></div>
      <div className="tile"><div className="tv">{planStatus(db, unit, 'annual')?.status || 'Draft'}</div><div className="tl">Annual plan · OKR plan {planStatus(db, unit, 'okr')?.status || 'Draft'}</div></div>
    </div>}
    {role !== 'employee' && behind.length > 0 && <div className="card" style={{ marginTop: 12 }}><h2>Key results furthest behind</h2>
      {behind.map(({ k, p }) => { const [s, t] = statusOf(p, k.confidence, db); const o: Row | undefined = byId(db.objectives, k.objective_id); return <div key={k.id} className="lg row"><span style={{ flex: 1 }}>{k.title}<div className="note">{o?.text}</div></span><Bar p={p} /><Pill tone={t}>{s}</Pill></div>; })}</div>}
  </Page>;
}
