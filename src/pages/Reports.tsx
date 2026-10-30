import { useState } from 'react';
import { useData, byId } from '../lib/data';
import { incomeStatement, cashFlow, MONTHS, money, pct, lastActualMonth, qMonths, sum } from '../lib/calc';
import { Page, Seg, UnitPicker, Empty } from '../lib/ui';

type Period = 'ytd' | 'q1' | 'q2' | 'q3' | 'q4' | 'year';
export default function Reports() {
  const { db, unit, can, units } = useData(); const [tab, setTab] = useState<'is' | 'cf'>('is'); const [scope, setScope] = useState<'unit' | 'group'>('unit'); const [per, setPer] = useState<Period>('ytd');
  if (!db || !unit) return null;
  const us = scope === 'group' ? units.map(u => u.id) : [unit];
  const last = lastActualMonth(db, scope === 'group' ? undefined : unit) || 1;
  const months = per === 'ytd' ? Array.from({ length: last }, (_, i) => i + 1) : per === 'year' ? Array.from({ length: 12 }, (_, i) => i + 1) : qMonths(Number(per[1]));
  const name = scope === 'group' ? 'Pilot units combined' : byId(db.org_units, unit)?.name;
  return <Page title="Reports" desc="The annual plan as an income statement and a cash flow: is it profitable, does it stay cash positive?" help={<>
    <h3>Income statement</h3><p>Built from the annual plan: revenue by product group or service line, cost of sales, gross profit, operating expenses by budget group, and operating profit. Columns show the <b>baseline</b> (approved plan), the <b>plan in force</b> (after rescopes), the <b>actual</b> from Finance, and the variance. Choose year to date, a quarter or the full year.</p>
    <h3>Cash flow</h3><p>From the unit's cash flow plan: opening cash, cash in, cash out, and closing cash month by month, plan and actual. A month where closing cash goes below zero is flagged — that is where the plan stops being cash positive.</p>
    <h3>Group view</h3><p>Group Strategy can combine the pilot units into one statement.</p></>}>
    <div className="cmdbar">{scope === 'unit' && <UnitPicker />}<Seg value={tab} options={[['is', 'Income statement'], ['cf', 'Cash flow']]} onChange={setTab} />
      {can('seeGroup') && <Seg value={scope} options={[['unit', 'One unit'], ['group', 'Combined']]} onChange={setScope} />}<span className="sp" />
      {tab === 'is' && <Seg value={per} options={[['ytd', `To date (${MONTHS[last - 1]})`], ['q1', 'Q1'], ['q2', 'Q2'], ['q3', 'Q3'], ['q4', 'Q4'], ['year', 'Year']]} onChange={setPer} />}</div>
    {tab === 'is' ? (() => { const rows = incomeStatement(db, us, months); const rev = rows.find(r => r.label === 'Revenue')!; const op = rows[rows.length - 1]; const gp = rows.find(r => r.label === 'Gross profit')!;
      if (!rev.plan && !rows.some(r => r.plan)) return <Empty>No plan lines for {name}.</Empty>;
      return <>
        <div className="g4" style={{ marginBottom: 14 }}>
          <div className="tile"><div className="tv">{money(rev.plan)}</div><div className="tl">Revenue — plan</div><div className="ts">actual {money(rev.act)}</div></div>
          <div className="tile"><div className="tv">{rev.plan ? pct(gp.plan / rev.plan) : '—'}</div><div className="tl">Gross margin — plan</div><div className="ts">actual {rev.act ? pct((gp.act || 0) / rev.act) : '—'}</div></div>
          <div className={'tile ' + (op.plan < 0 ? 'bad' : 'good')}><div className="tv">{money(op.plan)}</div><div className="tl">Operating profit — plan</div></div>
          <div className={'tile ' + (op.act != null && op.act < 0 ? 'bad' : '')}><div className="tv">{money(op.act)}</div><div className="tl">Operating profit — actual</div></div>
        </div>
        <div className="tw"><table className="t"><thead><tr><th>{name}</th><th className="n">Baseline</th><th className="n">Plan in force</th><th className="n">Actual</th><th className="n">Variance</th><th className="n">Achieved</th></tr></thead><tbody>
          {rows.map(r => { const cost = /cost|expense/i.test(r.label) || (r.indent && rows.indexOf(r) > rows.findIndex(x => x.label === 'Gross profit')); const v = r.act == null ? null : r.act - r.plan;
            return <tr key={r.label + rows.indexOf(r)} className={r.bold ? 'b' : ''}><td className={r.indent ? 'ind' : ''}>{r.label}</td><td className="n">{money(r.base)}</td><td className="n">{money(r.plan)}</td><td className="n">{money(r.act)}</td>
              <td className={'n' + (v != null && (cost ? v > 0 : v < 0) ? ' neg' : '')}>{money(v)}</td><td className="n">{r.act != null && r.plan ? pct(r.act / r.plan) : ''}</td></tr>; })}
        </tbody></table></div>
        <p className="note">Depreciation, interest and tax are not part of the unit annual plan workbooks, so this stops at operating profit.</p></>; })()
      : (() => { const cf = cashFlow(db, us); if (!cf.items.length) return <Empty>No cash flow plan for {name}.</Empty>;
        const neg = cf.plan.close.findIndex((v: number | null) => v != null && v < 0);
        return <>
          <div className={'banner ' + (neg >= 0 ? 'bad' : 'good')}>{neg >= 0 ? `Planned closing cash goes below zero in ${MONTHS[neg]}: the plan is not cash positive from there.` : 'Planned closing cash stays positive all year.'}</div>
          <div className="tw"><table className="t"><thead><tr><th className="first">{name}</th>{MONTHS.map(m => <th key={m} className="n">{m}</th>)}<th className="n">Year</th></tr></thead><tbody>
            <tr className="g"><td className="first">Opening cash</td><td className="n">{money(cf.opening.plan)}</td><td colSpan={12} className="note">actual opening {money(cf.opening.actual)}</td></tr>
            {(['in', 'out'] as const).map(dir => [<tr key={dir} className="g"><td className="first" colSpan={14}>{dir === 'in' ? 'Cash in' : 'Cash out'}</td></tr>,
              ...cf.items.filter((i: any) => i.direction === dir).map((i: any) => { const p = MONTHS.map((_, m) => cf.val(i.id, m + 1, 'plan')); const a = MONTHS.map((_, m) => cf.val(i.id, m + 1, 'actual'));
                return <tr key={i.id}><td className="first ind">{i.item}</td>{p.map((v, m) => <td key={m} className="n">{money(v)}{a[m] != null && <div className="note">{money(a[m])}</div>}</td>)}<td className="n">{money(sum(p))}</td></tr>; })])}
            {(['plan', 'actual'] as const).map(k => <tr key={k} className="b"><td className="first">Closing cash — {k}</td>{cf[k].close.map((v: number | null, m: number) => <td key={m} className={'n' + (v != null && v < 0 ? ' neg' : '')}>{money(v)}</td>)}<td /></tr>)}
          </tbody></table></div><p className="note">Small grey figures under a plan figure are the actual for that month. Finance reports actual cash flow by the indirect method (profit, working capital, investing, financing); until those lines are mapped to the plan lines above, actual closing cash is shown only where actuals are entered here.</p></>; })()}
  </Page>;
}
