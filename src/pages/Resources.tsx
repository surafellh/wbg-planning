import { useState, type ReactNode } from 'react';
import { useData, useSave, byId, type Row } from '../lib/data';
import { sb } from '../lib/supabase';
import { needLines, lineActual, NEED_SECS, PAY_PATTERN, money, sum, lineVals, linesOf, currentQ, MONTHS, monthStart, ymd, qMonths, actualBy, type NeedGroup, type NeedLine } from '../lib/calc';
import { Page, Cmd, Seg, NumIn, Pill, Empty, Modal } from '../lib/ui';
import { openRescope } from './AnnualPlan';
import { planStatus } from './OkrPlan';

const SECN: Record<string, string> = { rev: 'Revenue', cos: 'Cost of sales', opex: 'Operating expenses', capex: 'Capital spending', proj: 'Projects' };

export function PlanCalendar() {
  const { db, unit } = useData(); if (!db || !unit) return null;
  const fy = '2026/27';
  const steps: [string, string, string, string][] = [
    ['Strategy refresh', 'May', 'Group Strategy', 'Group and unit goals confirmed for the coming year.'],
    ['OKR plan', 'May – June', 'Unit head, planning head', 'Objectives from goals, key results, cascade and weights. Submitted to Group Strategy.'],
    ['Annual plan', 'May – June', 'Planning head, Finance', 'Revenue (quantity × price, or projects), cost of sales, opex, capex, cash flow. Group Strategy first, then top management give final approval.'],
    ['Quarter plan', 'Last 2 weeks of each quarter', 'Unit and department heads', 'Quarter targets, deliverables by month, scorecards agreed.'],
    ['Month plan & close', 'Close on day 9', 'Department heads, Finance', 'Deliverables accepted, actuals entered, month closed.'],
    ['Week plan', 'Cut-off Saturday 2:00 PM', 'Everyone', 'Activities for the week (Saturday – Friday), updated before the cut-off.'],
    ['Quarterly review & rescope', 'After each quarter', 'Group Strategy', 'Review results, rescope or replan where needed.'],
  ];
  const st = (k: string) => planStatus(db, unit, k)?.status || 'Draft';
  return <Page title="Planning calendar" desc="When each plan is made, by whom, and where it stands." help={<p>The fiscal year starts on 8 July (Hamle 1). Months carry Gregorian names but start on the Ethiopian month; weeks run Saturday to Friday and are numbered from 1 in each month. The weekly update cut-off is Saturday 2:00 PM and the month closes on day 9 of the next month.</p>}>
    <Cmd />
    <div className="g3" style={{ marginBottom: 14 }}>
      <div className="tile"><div className="tv">{st('okr')}</div><div className="tl">OKR plan 2026/27</div></div>
      <div className="tile"><div className="tv">{st('annual')}</div><div className="tl">Annual plan 2026/27</div></div>
      <div className="tile"><div className="tv">Q{currentQ(db)}</div><div className="tl">Current quarter</div></div>
    </div>
    <div className="tw"><table className="t"><thead><tr><th>Step</th><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>{steps.map(s => <tr key={s[0]}><td><b>{s[0]}</b></td><td>{s[1]}</td><td>{s[2]}</td><td>{s[3]}</td></tr>)}</tbody></table></div>
    <h2 style={{ margin: '18px 0 8px' }}>Fiscal months {fy}</h2>
    <div className="tw"><table className="t"><thead><tr>{MONTHS.map(m => <th key={m}>{m}</th>)}</tr></thead><tbody><tr>{MONTHS.map((m, i) => <td key={m}>{ymd(monthStart(fy, i + 1)).slice(5)}</td>)}</tr></tbody></table></div>
  </Page>;
}

/** How and when a line is paid in the quarter: as planned, monthly (same amount each month), one payment or two payments. */
function PayCell({ n, ms, edit, onSave }: { n: NeedLine; ms: number[]; edit: boolean; onSave: (pattern: string, months: number[], total: number) => void }) {
  const pat = n.plan?.pattern || 'planned'; const months: number[] = n.plan?.months || []; const total = n.amount;
  if (!edit) return <span className="mini">{PAY_PATTERN[pat]}{pat !== 'planned' && months.length ? ' · ' + months.map(m => MONTHS[m - 1]).join(', ') : ''}</span>;
  const planTotal = sum(ms.map(m => lineVals(n.line)[m - 1])) || n.base;
  const setPat = (p: string) => p === 'planned' ? onSave('planned', [], 0) : p === 'monthly' ? onSave('monthly', ms, total || planTotal) : p === 'once' ? onSave('once', [months[0] || ms[0]], total || planTotal) : onSave('twice', months.length === 2 ? months : [ms[0], ms[2]], total || planTotal);
  const toggle = (m: number) => { if (pat === 'once') onSave('once', [m], total); else if (pat === 'twice') { const cur = months.includes(m) ? months.filter(x => x !== m) : [...months, m].slice(-2); onSave('twice', cur.sort((a, b) => a - b), total); } };
  return <div className="paycell" onClick={e => e.stopPropagation()}>
    <select value={pat} onChange={e => setPat(e.target.value)} aria-label="How it is paid">{Object.entries(PAY_PATTERN).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
    {(pat === 'once' || pat === 'twice') && <span className="mchips">{ms.map(m => <button key={m} type="button" className={'mchip' + (months.includes(m) ? ' on' : '')} onClick={() => toggle(m)}>{MONTHS[m - 1]}</button>)}</span>}
    {pat !== 'planned' && <span className="mini">total <NumIn value={Math.round(total)} w={100} onChange={v => onSave(pat, pat === 'monthly' ? ms : months.length ? months : [ms[0]], v || 0)} /></span>}
  </div>;
}

export function Resources() {
  const { db, unit, can } = useData(); const save = useSave(); const [q, setQ] = useState<number>(() => (db ? currentQ(db) : 1)); const [open, setOpen] = useState<Set<string>>(new Set()); const [flt, setFlt] = useState('');
  if (!db || !unit) return null;
  const f = db.funds.find(x => x.unit_id === unit && x.quarter === q) || { confirmed: 0, expected: 0 }; const funds = { confirmed: Number(f.confirmed), expected: Number(f.expected) };
  const ms = qMonths(q); const { groups, order, rest, total, mode } = needLines(db, unit, ms, funds);
  const edit = can('editPlan');
  const toggle = (k: string) => setOpen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const rankAll = (keys: string[], prefix = '') => save(() => sb.from('need_priority').upsert(keys.map((key, r) => ({ unit_id: unit, fiscal_year: '2026/27', need_key: prefix + key, rank: r + 1 }))), ['need_priority']);
  const setMode = (m: 'group' | 'line') => save(() => sb.from('need_priority').upsert({ unit_id: unit, fiscal_year: '2026/27', need_key: '#mode', rank: m === 'line' ? 1 : 0 }), ['need_priority'], m === 'line' ? 'One priority list across groups' : 'Priority by group');
  const moveGroup = (i: number, d: number) => { const keys = groups.map(g => g.key); const t = i + d; if (t < 0 || t >= keys.length) return; [keys[i], keys[t]] = [keys[t], keys[i]]; rankAll(keys); };
  const moveLine = (g: NeedGroup, i: number, d: number) => { const keys = g.lines.map(n => n.key); const t = i + d; if (t < 0 || t >= keys.length) return; [keys[i], keys[t]] = [keys[t], keys[i]]; rankAll(keys); };
  /** across groups: put a line at position `to` (0-based) of the single list */
  const placeLine = (n: NeedLine, to: number) => { const keys = rest.map(x => x.key).filter(k => k !== n.key); keys.splice(Math.max(0, Math.min(keys.length, to)), 0, n.key); rankAll(keys, 'L|'); };
  const setMust = (n: NeedLine, v: boolean) => save(() => sb.from('plan_lines').update({ must_pay: v }).eq('id', n.line.id), ['plan_lines'], v ? 'Marked as committed' : 'No longer committed');
  const savePay = (n: NeedLine, pattern: string, months: number[], tot: number) => pattern === 'planned'
    ? save(() => sb.from('need_plan').delete().match({ unit_id: unit, fiscal_year: '2026/27', quarter: q, need_key: n.key }), ['need_plan'], 'Paid as in the plan')
    : save(() => sb.from('need_plan').upsert({ unit_id: unit, fiscal_year: '2026/27', quarter: q, need_key: n.key, pattern, months, amounts: months.map(() => Math.round(tot / Math.max(1, months.length) * 100) / 100), updated_at: new Date().toISOString() }), ['need_plan'], 'Payment plan saved');
  const setFund = (k: 'confirmed' | 'expected', v: number | null) => save(() => sb.from('funds').upsert({ unit_id: unit, fiscal_year: '2026/27', quarter: q, confirmed: k === 'confirmed' ? v || 0 : funds.confirmed, expected: k === 'expected' ? v || 0 : funds.expected }), ['funds'], 'Funds updated');
  const tot = (t: string) => sum(order.filter(n => n.tier === t).map(n => n.amount));
  const pending = db.rescopes.filter(r => r.unit_id === unit && r.status === 'Submitted' && r.kind !== 'okr_targets' && (r.changes || []).some((c: Row) => NEED_SECS.includes(c.section)));
  const tierPill = (t: string) => t === 'Not this period' ? <span className="mini">not this quarter</span> : <Pill tone={t === 'Funded' ? 'good' : t === 'Conditional' ? 'warn' : 'bad'}>{t}</Pill>;
  const groupTier = (ns: NeedLine[]) => { const ns2 = ns.filter(n => n.amount > 0); if (!ns2.length) return tierPill('Not this period'); const ts = new Set(ns2.map(n => n.tier)); return ts.size === 1 ? tierPill(ns2[0].tier) : <Pill tone="warn">{ns2.filter(n => n.tier === 'Funded').length} of {ns2.length} funded</Pill>; };
  const monthCells = (vals: number[]) => vals.map((v, i) => <td key={i} className="n mini">{v ? money(v) : '—'}</td>);
  const lineRow = (n: NeedLine, ctl: ReactNode, opts: { showGroup?: boolean; prio?: number } = {}) => { const a = lineActual(db, n.line.id, ms); const res = Math.abs(sum(ms.map(m => lineVals(n.line)[m - 1])) - n.base) > 0.5;
    return <tr key={n.key} className={'wl2 ' + (n.tier === 'Funded' ? 'fund' : n.tier === 'Conditional' ? 'cond' : n.tier === 'Backlog' ? 'back' : '')}>
      {mode === 'line' && <td className="n">{opts.prio != null ? (edit ? <NumIn value={opts.prio} w={52} onChange={v => v && placeLine(n, v - 1)} /> : opts.prio) : <span className="mini">—</span>}</td>}
      <td className={opts.showGroup ? '' : 'ind'} style={{ minWidth: 300 }}><span className="row" style={{ gap: 4, flexWrap: 'nowrap', alignItems: 'flex-start' }}>{ctl}<span>{n.line.name}{opts.showGroup && <div className="mini">{n.grp} · {SECN[n.sec]}</div>}{res && <div className="mini" data-tip="The plan in force after an approved rescope; the original approved amount is shown for reference.">rescoped · was {money(n.base)}</div>}</span></span></td>
      <td><PayCell n={n} ms={ms} edit={edit} onSave={(p, m, t) => savePay(n, p, m, t)} /></td>
      {monthCells(n.byMonth)}<td className="n">{money(n.amount)}</td><td className="n mini">{a == null ? '—' : money(a)}</td><td>{tierPill(n.tier)}</td><td className="n mini">{money(n.cum)}</td>
      <td>{edit ? <label className="mini row" style={{ gap: 4 }}><input type="checkbox" checked={n.must} onChange={e => setMust(n, e.target.checked)} />must pay</label> : n.must ? <Pill>committed</Pill> : ''}</td></tr>; };
  const allKeys = groups.map(g => g.key); const committed = groups.flatMap(g => g.committed);
  const grpRow = (key: string, label: ReactNode, ns: NeedLine[], ctl?: ReactNode, sub?: string) => { const on = open.has(key); const bym = ms.map((_, i) => sum(ns.map(n => n.byMonth[i])));
    return <tr key={key} className="g click" onClick={() => toggle(key)}>{mode === 'line' && <td />}<td style={{ minWidth: 300 }}><span className="row" style={{ gap: 4, flexWrap: 'nowrap', alignItems: 'flex-start' }}>{ctl}<span><b>{on ? '▾' : '▸'} {label}</b> <span className="mini">{sub}</span></span></span></td><td /> {monthCells(bym)}<td className="n">{money(sum(ns.map(n => n.amount)))}</td><td /><td>{groupTier(ns)}</td><td className="n mini">{ns.length ? money(Math.max(...ns.map(n => n.cum))) : ''}</td><td /></tr>; };
  const filtered = rest.filter(n => !flt || n.gkey === flt);
  return <Page title="Resources" desc="Which planned spending the quarter's money covers — line by line, month by month — and what was actually spent." help={<>
    <h3>The waterline</h3><p>For each quarter, the money the unit can count on is <b>confirmed</b> funds plus <b>expected</b> funds. Planned spending is paid in priority order and the running total is compared with the funds: <b>Funded</b> (within confirmed money), <b>Conditional</b> (only if expected money arrives), <b>Backlog</b> (not covered — move it up, cut it, push it to another quarter or rescope).</p>
    <h3>Two ways to set priorities</h3><ul><li><b>By group</b> — order the budget groups, then open a group and order its lines.</li><li><b>Across groups</b> — one list of lines, whatever group they belong to: for example two transformer lines first, then three hardware lines, then two protection lines, then two more transformer lines. Type a line's place in the <b>#</b> box or use the arrows.</li></ul><p><b>Committed lines</b> (ticked "must pay", such as salaries and rent) are always paid first.</p>
    <h3>When and how a line is paid</h3><p>For each line choose: <b>As in the plan</b> (the months of the annual plan), <b>Monthly (recurring)</b> (the same amount every month), <b>One payment</b> (pick the month) or <b>Two payments</b> (pick two months). Change the total if you will pay a different amount. The monthly view uses these amounts. Amounts are the plan in force — after an approved rescope, the rescoped amount.</p></>}>
    <Cmd right={<><Seg value={mode} options={[['group', 'By group'], ['line', 'Across groups']]} onChange={v => edit ? setMode(v) : undefined} />{mode === 'group' ? <button className="btn sm" onClick={() => setOpen(new Set(open.size ? [] : ['committed', ...allKeys]))}>{open.size ? 'Collapse all' : 'Expand all'}</button> : <select value={flt} onChange={e => setFlt(e.target.value)} aria-label="Show group"><option value="">All groups</option>{groups.filter(g => g.lines.length).map(g => <option key={g.key} value={g.key}>{g.grp}</option>)}</select>}<Seg value={q} options={[1, 2, 3, 4].map(x => [x, 'Q' + x] as [number, string])} onChange={setQ} /></>} />
    <div className="g4" style={{ marginBottom: 14 }}>
      <div className="tile good"><div className="tv">{money(funds.confirmed)}</div><div className="tl">Confirmed funds</div>{edit && <div className="ts">Change: <NumIn value={funds.confirmed} onChange={v => setFund('confirmed', v)} w={130} /></div>}</div>
      <div className="tile warn"><div className="tv">{money(funds.expected)}</div><div className="tl">Expected funds</div>{edit && <div className="ts">Change: <NumIn value={funds.expected} onChange={v => setFund('expected', v)} w={130} /></div>}</div>
      <div className="tile"><div className="tv">{money(total)}</div><div className="tl">Planned spending</div><div className="ts">{ms.map((m, i) => `${MONTHS[m - 1]} ${money(sum(order.map(n => n.byMonth[i])))}`).join(' · ')}</div></div>
      <div className={'tile ' + (tot('Backlog') ? 'bad' : 'good')}><div className="tv">{money(tot('Backlog'))}</div><div className="tl">Below the waterline</div><div className="ts">{order.filter(n => n.tier === 'Backlog').length} lines</div></div>
    </div>
    {pending.length > 0 && <div className="banner warn">A rescope is waiting for approval. The amounts here change to the rescoped figures once it is approved.</div>}
    {!order.length ? <Empty>No planned spending for Q{q}.</Empty> : <div className="tw"><table className="t"><thead><tr>{mode === 'line' && <th className="n" data-tip="Place in the single priority list. Type a number to move the line there.">#</th>}<th>{mode === 'line' ? 'Budget line' : 'Budget group / line'}</th><th data-tip="When and how the line is paid this quarter.">Payment</th>{ms.map(m => <th key={m} className="n">{MONTHS[m - 1]}</th>)}<th className="n">Quarter</th><th className="n">Actual</th><th>Waterline</th><th className="n">Running total</th><th>Committed</th></tr></thead><tbody>
      {committed.length > 0 && [grpRow('committed', 'Committed costs', committed, undefined, `${committed.length} lines · paid first`), ...(open.has('committed') ? committed.map(n => lineRow(n, null, { showGroup: true })) : [])]}
      {mode === 'group' && groups.filter(g => g.lines.length).map((g, gi) => { const idx = groups.indexOf(g);
        return [grpRow(g.key, g.grp, g.lines, edit ? <><button className="btn sm" aria-label="Move group up" disabled={gi === 0} onClick={e => { e.stopPropagation(); moveGroup(idx, -1); }}>↑</button><button className="btn sm" aria-label="Move group down" onClick={e => { e.stopPropagation(); moveGroup(idx, 1); }}>↓</button></> : undefined, `${SECN[g.sec]} · ${g.lines.length} line${g.lines.length > 1 ? 's' : ''}`),
          ...(open.has(g.key) ? g.lines.map((n, i) => lineRow(n, edit ? <><button className="btn sm" aria-label="Move up" disabled={i === 0} onClick={() => moveLine(g, i, -1)}>↑</button><button className="btn sm" aria-label="Move down" disabled={i === g.lines.length - 1} onClick={() => moveLine(g, i, 1)}>↓</button></> : null)) : [])]; })}
      {mode === 'line' && filtered.map(n => { const i = rest.indexOf(n);
        return lineRow(n, edit ? <><button className="btn sm" aria-label="Move to the top" title="Move to the top" disabled={i === 0} onClick={() => placeLine(n, 0)}>⤒</button><button className="btn sm" aria-label="Move up" disabled={i === 0} onClick={() => placeLine(n, i - 1)}>↑</button><button className="btn sm" aria-label="Move down" disabled={i === rest.length - 1} onClick={() => placeLine(n, i + 1)}>↓</button></> : null, { showGroup: true, prio: i + 1 }); })}
    </tbody></table></div>}
    {mode === 'line' && <p className="note">One priority list across groups: committed lines first, then every line in the order shown. Filter by group to find a line quickly — its number is still its place in the whole list.</p>}
  </Page>;
}

export function Rescope() {
  const { db, unit, can, user } = useData(); const save = useSave(); const [nm, setNm] = useState(false); const [f, setF] = useState<Row>({ trigger: 'Quarterly review', kind: 'rescope', note: '' });
  if (!db || !unit) return null;
  const open = openRescope(db, unit);
  const rs = db.rescopes.filter(r => r.unit_id === unit).sort((a, b) => b.at.localeCompare(a.at));
  const lines = linesOf(db, unit);
  const diff = (sec: string) => { const ls = lines.filter(l => l.section === sec); return { base: sum(ls.map(l => sum(lineVals(l, true)))), cur: sum(ls.map(l => sum(lineVals(l)))) }; };
  const changed = lines.filter(l => JSON.stringify(lineVals(l)) !== JSON.stringify(lineVals(l, true)));
  async function start() {
    const snap = lines.map(l => ({ id: l.id, qty: l.qty, val: l.val, price: l.price }));
    if (await save(() => sb.from('rescopes').insert({ unit_id: unit, trigger: f.trigger, kind: f.kind, note: f.note || null, status: 'Open', before_snapshot: snap, by_user: user.id }), ['rescopes'], 'Rescope started — change the revenue plan and budget, then submit')) setNm(false);
  }
  async function decide(r: Row, status: string) {
    if (status === 'Returned' && r.before_snapshot) {
      for (const s of r.before_snapshot as Row[]) await sb.from('plan_lines').update({ qty: s.qty, val: s.val, price: s.price }).eq('id', s.id);
    }
    const changes = status === 'Submitted' ? changed.map(l => ({ id: l.id, name: l.name, section: l.section, before: sum((r.before_snapshot || []).find((s: Row) => s.id === l.id)?.val || []), after: sum(lineVals(l)) })).filter(c => Math.abs(c.after - c.before) > 0.5) : r.changes;
    await save(() => sb.from('rescopes').update({ status, changes, ...(status === 'Approved' || status === 'Returned' ? { decided_by: user.id, decided_at: new Date().toISOString() } : {}) }).eq('id', r.id), ['rescopes', 'plan_lines'], 'Rescope ' + status.toLowerCase());
  }
  return <Page title="Rescope & versions" desc="Change the approved plan with a record of before and after." help={<>
    <h3>Rescope and replan</h3><p>Once the annual plan is approved it is the <b>baseline</b>. When something changes (a quarterly review, a funding gap, a market shift), the unit starts a <b>rescope</b> for a few lines or a <b>replan</b> for the whole year. While it is open, planners change the revenue plan and budget. On submit, the changes are listed and Group Strategy approves or returns them.</p>
    <p>A returned rescope is undone automatically: every line goes back to what it was when the rescope started. The baseline itself never changes, so plan-against-baseline is always available.</p></>}>
    <Cmd right={can('editPlan') && !open ? <button className="btn pri" onClick={() => setNm(true)}>Start a rescope</button> : undefined} />
    {open && <div className="banner warn"><b>Rescope open</b> ({open.trigger}) — change lines in Revenue plan and Budget. {changed.length} line(s) differ from the baseline.<span className="sp" />{can('editPlan') && <button className="btn sm pri" onClick={() => decide(open, 'Submitted')}>Submit for approval</button>}<button className="btn sm" onClick={() => decide(open, 'Returned')}>Cancel and undo</button></div>}
    <div className="g4" style={{ marginBottom: 14 }}>{(['rev', 'cos', 'opex', 'capex'] as const).map(s => { const d = diff(s); return <div key={s} className="tile"><div className="tv">{money(d.cur)}</div><div className="tl">{SECN[s]} — plan in force</div><div className="ts">baseline {money(d.base)} · change {money(d.cur - d.base)}</div></div>; })}</div>
    <h2 style={{ margin: '6px 0 8px' }}>History</h2>
    {!rs.length ? <Empty>No rescopes yet. The plan in force equals the approved baseline.</Empty> : <div className="tw"><table className="t"><thead><tr><th>Date</th><th>Kind</th><th>Why</th><th>Status</th><th>Changes</th><th /></tr></thead><tbody>
      {rs.map(r => <tr key={r.id}><td>{r.at.slice(0, 10)}</td><td>{r.kind === 'replan' ? 'Replan' : 'Rescope'}</td><td>{r.trigger}{r.note && <div className="note">{r.note}</div>}</td><td><Pill tone={r.status === 'Approved' ? 'good' : r.status === 'Returned' ? 'bad' : 'info'}>{r.status}</Pill></td>
        <td>{(r.changes || []).slice(0, 6).map((c: Row) => <div key={c.id} className="note">{c.name}: {money(c.before)} → {money(c.after)}</div>)}{(r.changes || []).length > 6 && <div className="note">+{r.changes.length - 6} more</div>}</td>
        <td>{r.status === 'Submitted' && can('approve') && <div className="row"><button className="btn sm pri" onClick={() => decide(r, 'Approved')}>Approve</button><button className="btn sm" onClick={() => decide(r, 'Returned')}>Return & undo</button></div>}</td></tr>)}
    </tbody></table></div>}
    {nm && <Modal title="Start a rescope" onClose={() => setNm(false)}>
      <label className="f">Kind<select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}><option value="rescope">Rescope — change some lines</option><option value="replan">Replan — redo the rest of the year</option></select></label>
      <label className="f">Why<select value={f.trigger} onChange={e => setF({ ...f, trigger: e.target.value })}>{['Quarterly review', 'Funding gap', 'Market change', 'Price change', 'Supply problem', 'New project', 'Other'].map(x => <option key={x}>{x}</option>)}</select></label>
      <label className="f">Note<textarea rows={3} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></label>
      <div className="row end"><button className="btn" onClick={() => setNm(false)}>Cancel</button><button className="btn pri" onClick={start}>Start</button></div></Modal>}
    <p className="note">Unit: {byId(db.org_units, unit)?.name}</p>
  </Page>;
}
