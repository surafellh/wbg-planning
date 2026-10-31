import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData, byId, type DB, type Row } from '../lib/data';
import { incomeStatement, cashFlow, MONTHS, money, pct, lastActualMonth, sum, periodMonths, periodLabel, orgScore, objScore, krsOf, krState, subtreeIds, workStats, delivScore, weekStart, ymd, weekLabel, personResult, bandOf, planBy, actualBy, linesOf, avg, curMonth, type Period } from '../lib/calc';
import { Page, Seg, UnitPicker, Empty, PeriodPicker, usePeriod, BarChart, LineChart, StatusStack, Bar, StatePill, Ring } from '../lib/ui';
import { statusCounts, unitKrs, unitGoalsTree, goalScore, pillarScore } from './Goals';

function csv(name: string, rows: (string | number | null | undefined)[][]) {
  const s = rows.map(r => r.map(v => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([s], { type: 'text/csv' })); a.download = name + '.csv'; a.click();
}
const Export = ({ name, rows }: { name: string; rows: () => (string | number | null | undefined)[][] }) => <button className="btn sm" onClick={() => csv(name, rows())}>Export CSV</button>;

function Summary({ db, us, p }: { db: DB; us: string[]; p: Period }) {
  const rows = us.map(u => { const ids = subtreeIds(db, u); const pos = new Set(db.positions.filter(x => ids.has(x.org_unit_id) && x.holder_name).map(x => x.id)); const last = lastActualMonth(db, u); const ms = periodMonths(p).filter(m => m <= Math.max(last, 0));
    const rp = ms.length ? planBy(db, u, 'rev', ms) : 0, ra = ms.length ? actualBy(db, u, 'rev', ms) : null; const op = ms.length ? planBy(db, u, 'opex', ms) : 0, oa = ms.length ? actualBy(db, u, 'opex', ms) : null;
    const people = db.positions.filter(x => pos.has(x.id)); const results = people.map(x => personResult(db, x, p).R).filter(v => v != null) as number[];
    return { u: byId(db.org_units, u)!, score: orgScore(db, u, p), counts: statusCounts(db, unitKrs(db, u), p), rev: rp ? (ra || 0) / rp : null, opex: op ? (oa || 0) / op : null, deliv: delivScore(db, pos, p), avgR: results.length ? sum(results) / results.length : null }; });
  return <>
    <div className="kpis">{rows.map(r => <div key={r.u.id} className="tile"><div className="row"><Ring p={r.score} size={48} /><div><b>{r.u.name}</b><div className="mini">OKR score · {periodLabel(p)}</div></div></div></div>)}</div>
    <div className="row" style={{ marginBottom: 6 }}><h2 style={{ flex: 1 }}>Executive summary · {periodLabel(p)}</h2><Export name="summary" rows={() => [['Unit', 'OKR score', 'Revenue achieved', 'Opex used', 'Deliverables accepted', 'Average person result'], ...rows.map(r => [r.u.name, pct(r.score), pct(r.rev), pct(r.opex), `${r.deliv.accepted}/${r.deliv.due}`, pct(r.avgR)])]} /></div>
    <div className="tw"><table className="t"><thead><tr><th>Unit</th><th>OKR score</th><th>Key results</th><th>Revenue achieved</th><th>Opex vs budget</th><th>Deliverables</th><th>Avg. person result</th></tr></thead><tbody>
      {rows.map(r => <tr key={r.u.id}><td><b>{r.u.name}</b></td><td><Bar p={r.score} /> {pct(r.score)}</td><td style={{ minWidth: 220 }}><StatusStack counts={r.counts} compact /></td><td>{r.rev == null ? '—' : pct(r.rev)}</td><td>{r.opex == null ? '—' : pct(r.opex)}</td><td>{r.deliv.due ? `${r.deliv.accepted}/${r.deliv.due}` : '—'}</td><td>{pct(r.avgR)}</td></tr>)}
    </tbody></table></div>
    <p className="note">Financial figures cover only months with Finance actuals.</p>
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
  const orgs = us.flatMap(u => Array.from(subtreeIds(db, u))).map(id => byId(db.org_units, id)!).filter(o => db.objectives.some(x => x.org_unit_id === o.id));
  const rows = orgs.map(o => { const ids = subtreeIds(db, o.id); const pos = db.positions.filter(x => ids.has(x.org_unit_id) && x.holder_name); const rs = pos.map(x => personResult(db, x, p).R).filter(v => v != null) as number[]; const d = delivScore(db, new Set(pos.map(x => x.id)), p);
    return { o, s: orgScore(db, o.id, p), q: [1, 2, 3, 4].map(q => orgScore(db, o.id, { t: 'Q', n: q })), people: pos.length, avgR: rs.length ? sum(rs) / rs.length : null, d }; }).sort((a, b) => (b.s ?? -1) - (a.s ?? -1));
  const people = us.flatMap(u => db.positions.filter(x => x.unit_id === u && x.holder_name)); const bands = ['Achieved', 'Well performed', 'Partially achieved', 'Under performed'].map(b => ({ label: b, n: people.filter(x => bandOf(personResult(db, x, p).R, db) === b).length, tone: b.startsWith('Ach') || b.startsWith('Well') ? 'good' : b.startsWith('Part') ? 'warn' : 'bad' }));
  return <>
    <div className="card" style={{ marginBottom: 12 }}><h3>People by band · {periodLabel(p)}</h3><StatusStack counts={bands} /></div>
    <div className="row" style={{ marginBottom: 6 }}><h2 style={{ flex: 1 }}>Units, departments and divisions</h2><Export name="organisation" rows={() => [['Organisation', 'Level', 'Score', 'Q1', 'Q2', 'Q3', 'Q4', 'People', 'Avg result', 'Deliverables accepted'], ...rows.map(r => [r.o.name, r.o.kind, pct(r.s), ...r.q.map(v => pct(v)), r.people, pct(r.avgR), `${r.d.accepted}/${r.d.due}`])]} /></div>
    <div className="tw"><table className="t"><thead><tr><th>Organisation</th><th>{periodLabel(p)}</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th className="n">People</th><th>Avg. result</th><th>Deliverables</th></tr></thead><tbody>
      {rows.map(r => <tr key={r.o.id}><td><b>{r.o.name}</b><div className="mini">{r.o.kind} · {byId(db.org_units, r.o.unit_id)?.name}</div></td><td><Bar p={r.s} /> {pct(r.s)}</td>{r.q.map((v, i) => <td key={i}>{pct(v)}</td>)}<td className="n">{r.people}</td><td>{pct(r.avgR)}</td><td>{r.d.due ? `${r.d.accepted}/${r.d.due}` : '—'}</td></tr>)}
    </tbody></table></div>
  </>;
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
    <h2 style={{ margin: '14px 0 6px' }}>Open blockers · {stuck.length}</h2>
    {stuck.length ? <div className="tw"><table className="t"><tbody>{stuck.map(a => <tr key={a.id}><td>{a.title}</td><td>{a.blocker}</td><td>{byId(db.positions, a.owner_position_id)?.holder_name}</td><td>{weekLabel(new Date(a.week_start + 'T00:00:00Z'))}</td></tr>)}</tbody></table></div> : <p className="note">None.</p>}
  </>;
}

function Financial({ db, us, name }: { db: DB; us: string[]; name: string }) {
  const [tab, setTab] = useState<'is' | 'cf' | 'trend' | 'lines'>('is'); const [per, setPer] = useState<'ytd' | 'q1' | 'q2' | 'q3' | 'q4' | 'year'>('ytd');
  const last = Math.max(1, ...us.map(u => lastActualMonth(db, u)));
  const months = per === 'ytd' ? Array.from({ length: last }, (_, i) => i + 1) : per === 'year' ? Array.from({ length: 12 }, (_, i) => i + 1) : periodMonths({ t: 'Q', n: Number(per[1]) });
  return <>
    <div className="row" style={{ marginBottom: 10 }}><Seg value={tab} options={[['is', 'Income statement'], ['cf', 'Cash flow'], ['trend', 'Monthly trend'], ['lines', 'By product / budget line']]} onChange={setTab} /><span className="sp" />
      {(tab === 'is' || tab === 'lines') && <Seg value={per} options={[['ytd', `To date (${MONTHS[last - 1]})`], ['q1', 'Q1'], ['q2', 'Q2'], ['q3', 'Q3'], ['q4', 'Q4'], ['year', 'Year']]} onChange={setPer} />}</div>
    {tab === 'is' && (() => { const rows = incomeStatement(db, us, months); const rev = rows.find(r => r.label === 'Revenue')!; const op = rows[rows.length - 1]; const gp = rows.find(r => r.label === 'Gross profit')!;
      if (!rows.some(r => r.plan)) return <Empty>No plan lines for {name}.</Empty>;
      return <>
        <div className="kpis"><div className="tile"><div className="tv">{money(rev.plan)}</div><div className="tl">Revenue — plan</div><div className="ts">actual {money(rev.act)}</div></div>
          <div className="tile"><div className="tv">{rev.plan ? pct(gp.plan / rev.plan) : '—'}</div><div className="tl">Gross margin — plan</div><div className="ts">actual {rev.act ? pct((gp.act || 0) / rev.act) : '—'}</div></div>
          <div className={'tile ' + (op.plan < 0 ? 'bad' : 'good')}><div className="tv">{money(op.plan)}</div><div className="tl">Operating profit — plan</div></div>
          <div className={'tile ' + (op.act != null && op.act < 0 ? 'bad' : '')}><div className="tv">{money(op.act)}</div><div className="tl">Operating profit — actual</div></div></div>
        <div className="row" style={{ marginBottom: 6 }}><span className="sp" /><Export name="income-statement" rows={() => [['Line', 'Baseline', 'Plan in force', 'Actual'], ...rows.map(r => [r.label, r.base, r.plan, r.act])]} /></div>
        <div className="tw"><table className="t"><thead><tr><th>{name}</th><th className="n">Baseline</th><th className="n">Plan in force</th><th className="n">Actual</th><th className="n">Variance</th><th className="n">Achieved</th></tr></thead><tbody>
          {rows.map((r, i) => { const cost = /cost|expense/i.test(r.label) || (r.indent && i > rows.findIndex(x => x.label === 'Gross profit')); const v = r.act == null ? null : r.act - r.plan;
            return <tr key={r.label + i} className={r.bold ? 'b' : ''}><td className={r.indent ? 'ind' : ''}>{r.label}</td><td className="n">{money(r.base)}</td><td className="n">{money(r.plan)}</td><td className="n">{money(r.act)}</td><td className={'n' + (v != null && (cost ? v > 0 : v < 0) ? ' neg' : '')}>{money(v)}</td><td className="n">{r.act != null && r.plan ? pct(r.act / r.plan) : ''}</td></tr>; })}
        </tbody></table></div><p className="note">Depreciation, interest and tax are not in the unit annual plan workbooks, so this stops at operating profit.</p></>; })()}
    {tab === 'cf' && (() => { const cf = cashFlow(db, us); if (!cf.items.length) return <Empty>No cash flow plan for {name}.</Empty>; const neg = cf.plan.close.findIndex((v: number | null) => v != null && v < 0);
      return <><div className={'banner ' + (neg >= 0 ? 'bad' : 'good')}>{neg >= 0 ? `Planned closing cash goes below zero in ${MONTHS[neg]}: the plan is not cash positive from there.` : 'Planned closing cash stays positive all year.'}</div>
        <LineChart labels={MONTHS} series={[{ name: 'Closing cash — plan', values: cf.plan.close, color: 'var(--accent)' }, { name: 'Closing cash — actual', values: cf.actual.close, color: 'var(--good)' }]} fmtY={v => money(v)} />
        <div className="tw" style={{ marginTop: 10 }}><table className="t"><thead><tr><th className="first">{name}</th>{MONTHS.map(m => <th key={m} className="n">{m}</th>)}<th className="n">Year</th></tr></thead><tbody>
          <tr className="g"><td className="first">Opening cash</td><td className="n">{money(cf.opening.plan)}</td><td colSpan={12} className="note">actual opening {money(cf.opening.actual)}</td></tr>
          {(['in', 'out'] as const).map(dir => [<tr key={dir} className="g"><td className="first" colSpan={14}>{dir === 'in' ? 'Cash in' : 'Cash out'}</td></tr>,
            ...cf.items.filter((i: Row) => i.direction === dir).map((i: Row) => { const pl = MONTHS.map((_, m) => cf.val(i.id, m + 1, 'plan')); return <tr key={i.id}><td className="first ind">{i.item}</td>{pl.map((v, m) => <td key={m} className="n">{money(v)}</td>)}<td className="n">{money(sum(pl))}</td></tr>; })])}
          {(['plan', 'actual'] as const).map(k => <tr key={k} className="b"><td className="first">Closing cash — {k}</td>{cf[k].close.map((v: number | null, m: number) => <td key={m} className={'n' + (v != null && v < 0 ? ' neg' : '')}>{money(v)}</td>)}<td /></tr>)}
        </tbody></table></div></>; })()}
    {tab === 'trend' && (() => { const S = (sec: string, a: boolean) => MONTHS.map((_, i) => { if (a) { const v = us.map(u => actualBy(db, u, sec, [i + 1])); return v.every(x => x == null) ? null : sum(v); } return sum(us.map(u => planBy(db, u, sec, [i + 1]))); });
      return <div className="drill"><div className="card"><h3>Revenue</h3><BarChart labels={MONTHS} series={[{ name: 'Plan', values: S('rev', false), color: 'var(--line2)' }, { name: 'Actual', values: S('rev', true), color: 'var(--accent)' }]} fmtY={money} /></div>
        <div className="card"><h3>Operating expenses</h3><BarChart labels={MONTHS} series={[{ name: 'Budget', values: S('opex', false), color: 'var(--line2)' }, { name: 'Actual', values: S('opex', true), color: 'var(--bad)' }]} fmtY={money} /></div>
        <div className="card"><h3>Cost of sales</h3><BarChart labels={MONTHS} series={[{ name: 'Plan', values: S('cos', false), color: 'var(--line2)' }, { name: 'Actual', values: S('cos', true), color: 'var(--warn)' }]} fmtY={money} /></div>
        <div className="card"><h3>Capital spending</h3><BarChart labels={MONTHS} series={[{ name: 'Plan', values: S('capex', false), color: 'var(--line2)' }, { name: 'Actual', values: S('capex', true), color: 'var(--good)' }]} fmtY={money} /></div></div>; })()}
    {tab === 'lines' && (() => { const rows = ['rev', 'cos', 'opex', 'capex'].flatMap(sec => Array.from(new Set(us.flatMap(u => linesOf(db, u, sec).map(l => l.line_group || 'Other')))).map(g => { const pl = sum(us.map(u => planBy(db, u, sec, months, [g]))); const av = us.map(u => actualBy(db, u, sec, months, [g])); const a = av.every(x => x == null) ? null : sum(av); return { sec, g, pl, a }; })).filter(r => r.pl || r.a);
      return <><div className="row" style={{ marginBottom: 6 }}><span className="sp" /><Export name="plan-vs-actual" rows={() => [['Section', 'Group', 'Plan', 'Actual', 'Achieved'], ...rows.map(r => [r.sec, r.g, r.pl, r.a, r.a != null && r.pl ? pct(r.a / r.pl) : ''])]} /></div>
        <div className="tw"><table className="t"><thead><tr><th>Section</th><th>Product group / budget line</th><th className="n">Plan</th><th className="n">Actual</th><th>Achieved</th></tr></thead><tbody>{rows.map(r => <tr key={r.sec + r.g}><td>{({ rev: 'Revenue', cos: 'Cost of sales', opex: 'Opex', capex: 'Capex' } as Row)[r.sec]}</td><td>{r.g}</td><td className="n">{money(r.pl)}</td><td className="n">{money(r.a)}</td><td>{r.a != null && r.pl ? <><Bar p={r.a / r.pl} tone={r.sec === 'rev' ? undefined : r.a > r.pl ? 'bad' : 'good'} /> {pct(r.a / r.pl)}</> : ''}</td></tr>)}</tbody></table></div></>; })()}
  </>;
}

export default function Reports() {
  const { db, unit, can, units } = useData(); const [sp, setSp] = useSearchParams(); const tab = sp.get('tab') || 'summary';
  const [scope, setScope] = useState<'unit' | 'group'>(can('seeGroup') ? 'group' : 'unit'); const [p, setP] = usePeriod();
  if (!db || !unit) return null;
  const us = scope === 'group' ? units.map(u => u.id) : [unit]; const name = scope === 'group' ? 'Pilot units combined' : byId(db.org_units, unit)?.name || '';
  const tabs: [string, string][] = [['summary', 'Summary'], ['okr', 'OKRs & goals'], ['org', 'Organisation & people'], ['work', 'Weekly & monthly work'], ['fin', 'Financial']];
  return <Page title="Reports" desc="Operational, OKR, organisational, work and financial performance — for one unit or the pilot units combined." help={<>
    <p><b>Summary</b> — each unit's OKR score, key-result status, revenue and budget use, deliverables and average person result for the period.</p>
    <p><b>OKRs & goals</b> — score by quarter and pillar, then every goal, objective or key result with target, actual and status (pace-adjusted while a period is running).</p>
    <p><b>Organisation & people</b> — every unit, department and division with its score per quarter, people and deliverables; people by performance band.</p>
    <p><b>Weekly & monthly work</b> — activity completion and how many people update each week, monthly deliverables due versus accepted, open blockers.</p>
    <p><b>Financial</b> — income statement (profitability), cash flow (cash positivity), monthly trends and plan vs actual by product group and budget line.</p>
    <p>Every table can be exported to CSV.</p></>}>
    <div className="cmdbar">{scope === 'unit' && <UnitPicker />}{can('seeGroup') && <Seg value={scope} options={[['group', 'All pilot units'], ['unit', 'One unit']]} onChange={setScope} />}<span className="sp" />{tab !== 'fin' && tab !== 'work' && <PeriodPicker value={p} onChange={setP} />}</div>
    <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" className={tab === k ? 'on' : ''} onClick={() => setSp({ tab: k })}>{l}</button>)}</div>
    {tab === 'summary' && <Summary db={db} us={us} p={p} />}
    {tab === 'okr' && <OkrReport db={db} us={us} p={p} />}
    {tab === 'org' && <OrgReport db={db} us={us} p={p} />}
    {tab === 'work' && <WorkReport db={db} us={us} />}
    {tab === 'fin' && <Financial db={db} us={us} name={name} />}
  </Page>;
}
