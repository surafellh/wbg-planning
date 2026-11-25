/* STUDIO — rescope editor, monthly resources & payment scheduling, project portfolio, backup & restore. */
import { useMemo, useState } from 'react';
import { useData, useSave, byId, posName, TABLES, type DB, type Row } from '../../lib/data';
import { sb } from '../../lib/supabase';
import { MONTHS, qMonths, qOfMonth, curMonth, linesOf, lineVals, lineQty, sum, money, pct, fmt, needLines, PAY_PATTERN, type NeedLine } from '../../lib/calc';
import { Page, Cmd, Seg, Pill, Empty, Modal, NumIn, LineChart } from '../../lib/ui';
import { Sheet, useDraft, type Col } from '../../lib/sheet';
import { SaveBar, applyTargetChanges } from '../work/Plan';
import { planStatus } from '../OkrPlan';

const SECN: Record<string, string> = { rev: 'Revenue', cos: 'Cost of sales', opex: 'Operating expenses', capex: 'Capital spending', proj: 'Projects' };

/* ---------- Rescope: propose new figures for a quarter next to the approved ones ---------- */
export async function applyRescope(db: DB, r: Row) {
  if (r.kind === 'okr_targets') { await applyTargetChanges(r.changes || []); return; }
  const byLine = new Map<string, Row[]>(); (r.changes || []).forEach((c: Row) => byLine.set(c.id, [...(byLine.get(c.id) || []), c]));
  for (const [id, cs] of byLine) { const l = byId(db.plan_lines, id); if (!l) continue; const val = lineVals(l), qty = lineQty(l);
    cs.forEach(c => { if (c.field === 'qty') { qty[c.month - 1] = Number(c.new) || 0; val[c.month - 1] = (Number(c.new) || 0) * Number(l.price || 0); } else val[c.month - 1] = Number(c.new) || 0; });
    await sb.from('plan_lines').update(l.kind === 'qty' ? { qty, val } : { val }).eq('id', id); }
}
export function RescopeEditor() {
  const { db, unit, can, user } = useData(); const save = useSave(); const [sec, setSec] = useState('rev'); const [q, setQ] = useState(Math.min(4, qOfMonth(curMonth()) + (curMonth() % 3 === 0 ? 1 : 0))); const [why, setWhy] = useState('Quarterly review'); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [view, setView] = useState<Row | null>(null); const [flt, setFlt] = useState('');
  const ms = qMonths(q);
  const lines = useMemo(() => db && unit ? linesOf(db, unit, sec).filter(l => !flt || (l.name + ' ' + l.line_group).toLowerCase().includes(flt.toLowerCase())).sort((a, b) => (a.line_group || '').localeCompare(b.line_group || '') || a.sort - b.sort) : [], [db, unit, sec, flt]);
  const source = useMemo(() => lines.map(l => { const isQ = l.kind === 'qty'; const cur = isQ ? lineQty(l) : lineVals(l); const r: Row = { id: l.id, grp: l.line_group, name: l.name, kind: isQ ? 'qty' : 'value', uom: isQ ? l.uom : 'ETB' }; ms.forEach(m => { r['a' + m] = cur[m - 1]; r['n' + m] = cur[m - 1]; }); return r; }), [lines, q]);
  const d = useDraft(source, [source]);
  if (!db || !unit) return null;
  const secs = (['rev', 'cos', 'opex', 'capex', 'proj'] as const).filter(s => linesOf(db, unit, s).length);
  const rs = db.rescopes.filter(r => r.unit_id === unit).sort((a, b) => b.at.localeCompare(a.at));
  const cols: Col[] = [{ key: 'grp', label: 'Group', type: 'ro', width: 160 }, { key: 'name', label: 'Line', type: 'ro', width: 220 }, { key: 'uom', label: 'Unit', type: 'ro', width: 60 },
    ...ms.flatMap(m => [{ key: 'a' + m, label: `${MONTHS[m - 1]} approved`, type: 'ro' as const, width: 110, tip: 'The plan in force now (approved baseline plus approved rescopes).' }, { key: 'n' + m, label: `${MONTHS[m - 1]} new`, type: 'number' as const, width: 110 }]),
    { key: 'chg', label: 'Change', type: 'ro', width: 110, fmt: (_, r) => { const a = sum(ms.map(m => r['a' + m])), n = sum(ms.map(m => r['n' + m])); return n === a ? '' : (n > a ? '+' : '') + fmt(n - a, 0); } }];
  const changed = d.rows.filter(r => ms.some(m => r['n' + m] !== r['a' + m]));
  async function submit() {
    setBusy(true);
    const changes = changed.flatMap(r => ms.filter(m => r['n' + m] !== r['a' + m]).map(m => ({ id: r.id, field: r.kind === 'qty' ? 'qty' : 'val', month: m, old: r['a' + m], new: r['n' + m], name: `${r.name} · ${MONTHS[m - 1]}`, section: sec, before: r['a' + m], after: r['n' + m] })));
    const ok = await save(() => sb.from('rescopes').insert({ unit_id: unit, kind: 'rescope', trigger: why, note: note || null, status: 'Submitted', changes, by_user: user.id }), ['rescopes'], 'Rescope sent for approval');
    if (ok) { d.reset(); setNote(''); } setBusy(false);
  }
  async function decide(r: Row, ok: boolean) {
    if (ok) await applyRescope(db!, r);
    await save(() => sb.from('rescopes').update({ status: ok ? 'Approved' : 'Returned', decided_by: user.id, decided_at: new Date().toISOString() }).eq('id', r.id), ['rescopes', 'plan_lines', 'kr_targets', 'kr_month_targets', 'key_results'], ok ? 'Approved and applied' : 'Returned');
  }
  const annual = planStatus(db, unit, 'annual')?.status;
  return <Page title="Rescope & versions" desc="Propose new figures for a quarter next to the approved plan; Group Strategy approves before anything changes." help={<>
    <p>Pick a section and a quarter. Each month shows the <b>approved</b> figure (the plan in force) and a <b>new</b> column you fill in, like a spreadsheet — paste from Excel if you like. Submit with a reason; nothing in the plan changes until Group Strategy approves. Approved rescopes are applied automatically and kept in the history below, so every version can be traced.</p>
    <p>Target changes to {annual === 'Approved' ? 'approved ' : ''}OKRs made in Work → Plan → Targets arrive here too, as "Target change" requests.</p></>}>
    <Cmd right={<><input type="text" placeholder="Filter lines" value={flt} onChange={e => setFlt(e.target.value)} />{secs.length > 0 && <Seg value={secs.includes(sec as any) ? sec : secs[0]} options={secs.map(s => [s, SECN[s]] as [string, string])} onChange={setSec} />}<Seg value={q} options={[1, 2, 3, 4].map(n => [n, 'Q' + n] as [number, string])} onChange={setQ} /></>} />
    {!lines.length ? <Empty>No lines in this section.</Empty> : <Sheet cols={cols} rows={d.rows} onChange={d.change} />}
    {changed.length > 0 && <div className="card stack" style={{ marginTop: 12 }}><div className="g2"><label className="f">Why<select value={why} onChange={e => setWhy(e.target.value)}>{['Quarterly review', 'Funding gap', 'Market change', 'Price change', 'Supply problem', 'New project', 'Other'].map(x => <option key={x}>{x}</option>)}</select></label><label className="f">Note<input type="text" value={note} onChange={e => setNote(e.target.value)} /></label></div>
      <div className="row"><span className="note" style={{ flex: 1 }}>{changed.length} line(s) changed in Q{q} · total change {money(sum(changed.map(r => sum(ms.map(m => r['n' + m])) - sum(ms.map(m => r['a' + m])))))}</span><button className="btn" onClick={d.reset}>Discard</button><button className="btn pri" disabled={busy} onClick={submit}>Submit for approval</button></div></div>}
    <h2 style={{ margin: '18px 0 8px' }}>Versions and requests</h2>
    {!rs.length ? <Empty>No rescopes yet — the plan in force equals the approved baseline.</Empty> : <div className="tw"><table className="t"><thead><tr><th>Date</th><th>Kind</th><th>Why</th><th>Status</th><th className="n">Changes</th><th /></tr></thead><tbody>
      {rs.map(r => <tr key={r.id}><td>{r.at.slice(0, 10)}</td><td>{r.kind === 'okr_targets' ? 'Target change' : r.kind === 'replan' ? 'Replan' : 'Rescope'}</td><td>{r.trigger}{r.note && <div className="mini">{r.note}</div>}</td><td><Pill tone={r.status === 'Approved' ? 'good' : r.status === 'Returned' ? 'bad' : 'info'}>{r.status}</Pill></td><td className="n">{(r.changes || []).length}</td>
        <td><div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn sm" onClick={() => setView(r)}>View</button>{r.status === 'Submitted' && can('approve') && <><button className="btn sm pri" onClick={() => decide(r, true)}>Approve</button><button className="btn sm" onClick={() => decide(r, false)}>Return</button></>}</div></td></tr>)}
    </tbody></table></div>}
    {view && <Modal title="Rescope detail" onClose={() => setView(null)} wide><div className="tw"><table className="t"><thead><tr><th>Item</th><th className="n">Before</th><th className="n">After</th><th className="n">Change</th></tr></thead><tbody>{(view.changes || []).map((c: Row, i: number) => <tr key={i}><td>{c.name || c.label}</td><td className="n">{fmt(c.old ?? c.before, 2)}</td><td className="n">{fmt(c.new ?? c.after, 2)}</td><td className="n">{fmt((c.new ?? c.after ?? 0) - (c.old ?? c.before ?? 0), 2)}</td></tr>)}</tbody></table></div></Modal>}
  </Page>;
}

/* ---------- Resources: month-by-month funds, payment scheduling and priorities ---------- */
export function ResourcesMonthly() {
  const { db, unit, can } = useData(); const save = useSave(); const [m, setM] = useState(curMonth()); const [busy, setBusy] = useState(false); const [open, setOpen] = useState<Set<string>>(new Set());
  const fm = db && unit ? db.fund_months.find(f => f.unit_id === unit && f.month === m) : null;
  const qf = db && unit ? db.funds.find(f => f.unit_id === unit && f.quarter === qOfMonth(m)) : null;
  const funds = { confirmed: fm ? Number(fm.confirmed) : qf ? Number(qf.confirmed) / 3 : 0, expected: fm ? Number(fm.expected) : qf ? Number(qf.expected) / 3 : 0 };
  const source = useMemo(() => {
    if (!db || !unit) return [];
    const { order, mode } = needLines(db, unit, [m], { confirmed: 0, expected: 0 });
    const row = (n: NeedLine, pos: number): Row => { const s = db.need_schedule.find(x => x.unit_id === unit && x.need_key === n.key && x.plan_month === m);
      return { id: s?.id, key: n.key, gkey: mode === 'line' ? 'all' : n.must ? 'committed' : n.gkey, grank: n.must ? -1 : pos, plan_month: m, need: n.line.name, grp: n.grp, sec: SECN[n.sec], planned: n.amount, base: Math.abs(lineVals(n.line)[m - 1] - lineVals(n.line, true)[m - 1]) > 0.5 ? lineVals(n.line, true)[m - 1] : n.amount, how: PAY_PATTERN[n.plan?.pattern || 'planned'], pay_month: String(s?.pay_month ?? m), amount: s?.amount ?? n.amount, rank: s?.rank ?? (mode === 'line' ? pos : n.rank), status: s?.status || 'Scheduled', must: n.must ? 'committed' : '', carried: '' }; };
    const groupsPos = new Map<string, number>(); order.forEach((n, i) => { if (!groupsPos.has(n.gkey)) groupsPos.set(n.gkey, i); });
    const rows: Row[] = order.filter(n => n.amount > 0 || db.need_schedule.some(x => x.unit_id === unit && x.need_key === n.key && x.plan_month === m)).map((n, i) => row(n, mode === 'line' ? i : groupsPos.get(n.gkey)!));
    // amounts deferred from earlier months into this one
    db.need_schedule.filter(x => x.unit_id === unit && x.plan_month < m && x.pay_month === m && x.status !== 'Cancelled').forEach(x => { const [sec, grp, lid] = x.need_key.split('|'); const l = lid ? byId(db.plan_lines, lid) : null; const gi = order.findIndex(n => n.gkey === `${sec}|${grp}`);
      rows.push({ id: x.id, key: x.need_key, gkey: `${sec}|${grp}`, grank: gi < 0 ? 999 : gi, how: '', plan_month: x.plan_month, need: l?.name || grp, grp, sec: SECN[sec], planned: Number(x.amount), base: Number(x.amount), pay_month: String(m), amount: Number(x.amount), rank: x.rank ?? 50, status: x.status, must: '', carried: `from ${MONTHS[x.plan_month - 1]}` }); });
    return rows.sort((a, b) => a.grank - b.grank || (Number(a.rank) || 0) - (Number(b.rank) || 0));
  }, [db, unit, m]);
  const d = useDraft(source, [source]);
  if (!db || !unit) return null;
  // waterline over what is paid THIS month: committed lines first, then groups in priority order, lines in their order
  const paying = d.rows.filter(r => Number(r.pay_month) === m && !['Deferred', 'Cancelled'].includes(r.status)).sort((a, b) => a.grank - b.grank || (Number(a.rank) || 0) - (Number(b.rank) || 0));
  let run = 0; const tier = new Map<Row, string>(); paying.forEach(r => { run += Number(r.amount) || 0; tier.set(r, run <= funds.confirmed ? 'Funded' : run <= funds.confirmed + funds.expected ? 'Conditional' : 'Backlog'); });
  const tot = (t: string) => sum(paying.filter(r => tier.get(r) === t).map(r => Number(r.amount)));
  const deferred = sum(d.rows.filter(r => Number(r.pay_month) > m || r.status === 'Deferred').map(r => Number(r.amount)));
  // grouped, collapsible view: a header per budget group, its lines when open
  const toggle = (k: string) => setOpen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const view: Row[] = []; const idx: number[] = []; let last = '';
  const flat = d.rows.length > 0 && d.rows.every(r => r.gkey === 'all' || r.carried);
  d.rows.forEach((r, i) => { if (flat) { view.push(r); idx.push(i); return; } if (r.gkey !== last) { last = r.gkey; const mem = d.rows.filter(x => x.gkey === r.gkey); const on = open.has(r.gkey); const fundedN = mem.filter(x => tier.get(x) === 'Funded').length;
      view.push({ _header: <button className="hbtn" onClick={() => toggle(r.gkey)}>{on ? '▾' : '▸'} {r.gkey === 'committed' ? 'Committed costs (paid first)' : `${r.grp} · ${r.sec}`} <span className="mini" style={{ fontWeight: 400 }}>— {mem.length} line{mem.length > 1 ? 's' : ''} · {money(sum(mem.map(x => Number(x.amount) || 0)))} · {fundedN} funded</span></button> }); idx.push(-1); }
    if (open.has(r.gkey)) { view.push(r); idx.push(i); } });
  const cols: Col[] = [{ key: 'need', label: 'Budget line', type: 'ro', width: 230, fmt: (v, r) => <span>{v}{r.gkey === 'committed' && <span className="mini"> · {r.grp}</span>}</span> }, { key: 'grp', label: 'Group', type: 'ro', width: 150 }, { key: 'how', label: 'Paid', type: 'ro', width: 130, tip: 'How the line is paid this quarter — set on the Quarter waterline view.' }, { key: 'carried', label: 'Carried', type: 'ro', width: 90 },
    { key: 'planned', label: `${MONTHS[m - 1]} planned`, type: 'ro', width: 120, fmt: (v, r) => <span title={Math.abs(v - r.base) > 0.5 ? `Rescoped · original ${money(r.base)}` : undefined}>{money(v)}{Math.abs(v - r.base) > 0.5 ? ' ✎' : ''}</span>, tip: 'The plan in force: after an approved rescope this is the rescoped amount (✎).' },
    { key: 'pay_month', label: 'Pay in', type: 'select', options: MONTHS.map((x, i) => [String(i + 1), x] as [string, string]).filter(([k]) => Number(k) >= m), width: 90, tip: 'Schedule the payment for this month or push it to a later month.' },
    { key: 'amount', label: 'Amount to pay', type: 'number', width: 120 }, { key: 'rank', label: flat ? 'Order' : 'Order in group', type: 'number', width: 100, tip: flat ? 'Lower number = paid first. The list across groups is set on the Quarter waterline view.' : 'Lower number = paid first inside its budget group. The order of the groups is set on the Quarter waterline view.' },
    { key: 'status', label: 'Status', type: 'select', options: [['Scheduled', 'Scheduled'], ['Paid', 'Paid'], ['Deferred', 'Deferred'], ['Cancelled', 'Cancelled']], width: 110 },
    { key: 'tier', label: 'Waterline', type: 'ro', width: 100, fmt: (_, r) => { const t = tier.get(r); return t ? <Pill tone={t === 'Funded' ? 'good' : t === 'Conditional' ? 'warn' : 'bad'}>{t}</Pill> : Number(r.pay_month) > m ? `→ ${MONTHS[Number(r.pay_month) - 1]}` : ''; } }];
  async function doSave() {
    setBusy(true); let err: string | null = null;
    for (const r of d.all.filter(r => r._dirty)) { const row = { unit_id: unit, fiscal_year: '2026/27', need_key: r.key, plan_month: r.plan_month, pay_month: Number(r.pay_month), amount: r.amount, rank: r.rank, status: Number(r.pay_month) > r.plan_month && r.status === 'Scheduled' ? 'Deferred' : r.status };
      const x = await sb.from('need_schedule').upsert(row, { onConflict: 'unit_id,fiscal_year,need_key,plan_month,space' }); err = err || x.error?.message || null; }
    await save(() => Promise.resolve({ error: err }) as any, ['need_schedule'], 'Schedule saved'); setBusy(false);
  }
  const setFund = (k: 'confirmed' | 'expected', v: number | null) => save(() => sb.from('fund_months').upsert({ unit_id: unit, fiscal_year: '2026/27', month: m, confirmed: k === 'confirmed' ? v || 0 : funds.confirmed, expected: k === 'expected' ? v || 0 : funds.expected }), ['fund_months'], 'Funds updated');
  const keys = Array.from(new Set(d.rows.map(r => r.gkey)));
  return <Page title="Resources" desc="Month by month: the money available, which lines get paid, in what order, and what is pushed to a later month." help={<>
    <p>Each month lists the planned spending line by line, grouped by budget group, plus anything deferred from earlier months. Open a group to work on its lines; not every line in a group has to be paid. <b>Committed lines</b> (marked "must pay") are paid first; then the groups in the order set on the Quarter waterline view, and inside each group the lines by <b>Order in group</b>. Use <b>Pay in</b> to push a payment to a later month.</p>
    <p>Amounts are the plan in force — after an approved rescope, the rescoped amount (marked ✎). The <b>waterline</b> compares the running total with the month's funds: <b>Funded</b>, <b>Conditional</b> (only if expected money arrives), <b>Backlog</b> (not covered — defer, cut or rescope). Funds default to a third of the quarter's funds until you set the month's own figures.</p></>}>
    <Cmd right={<><button className="btn sm" onClick={() => setOpen(new Set(open.size ? [] : keys))}>{open.size ? 'Collapse all' : 'Expand all'}</button><select value={m} onChange={e => setM(Number(e.target.value))}>{MONTHS.map((x, i) => <option key={x} value={i + 1}>{x}{i + 1 === curMonth() ? ' (now)' : ''}</option>)}</select></>} />
    <div className="kpis">
      <div className="tile good"><div className="tv">{money(funds.confirmed)}</div><div className="tl">Confirmed funds</div>{can('editPlan') && <div className="ts">Set: <NumIn value={Math.round(funds.confirmed)} onChange={v => setFund('confirmed', v)} w={120} /></div>}</div>
      <div className="tile warn"><div className="tv">{money(funds.expected)}</div><div className="tl">Expected funds</div>{can('editPlan') && <div className="ts">Set: <NumIn value={Math.round(funds.expected)} onChange={v => setFund('expected', v)} w={120} /></div>}</div>
      <div className="tile"><div className="tv">{money(sum(paying.map(r => Number(r.amount))))}</div><div className="tl">To pay this month</div><div className="ts">Funded {money(tot('Funded'))} · Conditional {money(tot('Conditional'))}</div></div>
      <div className={'tile ' + (tot('Backlog') ? 'bad' : 'good')}><div className="tv">{money(tot('Backlog'))}</div><div className="tl">Below the waterline</div></div>
      <div className="tile"><div className="tv">{money(deferred)}</div><div className="tl">Pushed to later months</div></div></div>
    {!d.rows.length ? <Empty>No planned spending in {MONTHS[m - 1]}.</Empty> : <Sheet cols={cols} rows={view} onChange={(i, k, v) => idx[i] >= 0 && d.change(idx[i], k, v)} readOnly={!can('editPlan')} />}
    <SaveBar dirty={d.dirty} onSave={doSave} onDiscard={d.reset} busy={busy} />
    <p className="note">{pct(tot('Funded') / Math.max(1, sum(paying.map(r => Number(r.amount)))))} of this month's payments are funded.</p>
  </Page>;
}

/* ---------- Project portfolio (PMO module) ---------- */
const STATUS: [string, string][] = ['Not started', 'In progress', 'On hold', 'Completed', 'Cancelled'].map(s => [s, s]);
const RAG: [string, string][] = [['Green', 'Green'], ['Amber', 'Amber'], ['Red', 'Red']];
export function Portfolio({ edit }: { edit?: boolean }) {
  const { db, can, unit } = useData(); const save = useSave(); const [scope, setScope] = useState<'all' | 'unit'>(edit || can('seeGroup') ? 'all' : 'unit'); const [busy, setBusy] = useState(false); const [st, setSt] = useState(''); const [pv, setPv] = useState<'register' | 'monthly' | 'phases'>('register');
  const source = useMemo(() => db ? db.pmo_projects.filter(p => (scope === 'all' || p.unit_id === unit) && (!st || p.status === st)).sort((a, b) => (a.unit_code || '').localeCompare(b.unit_code || '') || (a.code || '').localeCompare(b.code || '', undefined, { numeric: true })).map(p => ({ ...p, unit_id: p.unit_id || '' })) : [], [db, scope, unit, st]);
  const d = useDraft(source, [source]);
  if (!db) return null;
  const units = db.org_units.filter(u => u.kind === 'unit' && u.code !== 'pmo').map(u => [u.id, u.name] as [string, string]);
  const goals = db.unit_goals.map(g => [g.id, `${byId(db.org_units, g.unit_id)?.name}: ${g.name}`.slice(0, 70)] as [string, string]);
  const today = new Date().toISOString().slice(0, 10);
  const late = (r: Row) => r.status !== 'Completed' && (r.revised_end || r.end_date) && (r.revised_end || r.end_date) < today;
  const cols: Col[] = [{ key: 'code', label: 'Code', type: 'text', width: 70 }, { key: 'name', label: 'Project', type: 'text', width: 260 }, { key: 'unit_id', label: 'Company', type: 'select', options: units, width: 150 }, { key: 'type', label: 'Type', type: 'select', options: [['Capital (physical)', 'Capital'], ['Business', 'Business'], ['Digital', 'Digital']], width: 100 },
    { key: 'manager', label: 'Manager', type: 'text', width: 140 }, { key: 'budget', label: 'Budget (ETB)', type: 'number', width: 120 }, { key: 'spent', label: 'Spent', type: 'number', width: 110 },
    { key: 'start_date', label: 'Start', type: 'text', width: 95 }, { key: 'end_date', label: 'End', type: 'text', width: 95 }, { key: 'revised_end', label: 'Revised end', type: 'text', width: 100, tip: 'New end date after a change; overdue projects are flagged.' },
    { key: 'progress_pct', label: '% done', type: 'number', width: 70 }, { key: 'status', label: 'Status', type: 'select', options: STATUS, width: 110 }, { key: 'rag', label: 'RAG', type: 'select', options: RAG, width: 80, tip: 'Green on track · Amber at risk · Red off track.' },
    { key: 'unit_goal_id', label: 'Strategic goal', type: 'select', options: goals, width: 220, tip: 'The strategic goal this project serves — shows the project in the strategy.' }, { key: 'note', label: 'Latest update', type: 'text', width: 220 }];
  async function doSave() {
    setBusy(true); let err: string | null = null;
    for (const r of d.all.filter(r => r._dirty)) { if (r._deleted) { if (r.id) await sb.from('pmo_projects').delete().eq('id', r.id); continue; } if (!r.name?.trim()) continue;
      const row = { code: r.code || null, name: r.name.trim(), unit_id: r.unit_id || null, unit_code: byId(db!.org_units, r.unit_id)?.code || null, type: r.type || null, manager: r.manager || null, budget: r.budget ?? null, spent: r.spent ?? null, start_date: r.start_date || null, end_date: r.end_date || null, revised_end: r.revised_end || null, progress_pct: r.progress_pct ?? null, status: r.status || null, rag: r.rag || null, unit_goal_id: r.unit_goal_id || null, note: r.note || null, updated_at: new Date().toISOString() };
      const x = r._new ? await sb.from('pmo_projects').insert(row) : await sb.from('pmo_projects').update(row).eq('id', r.id); err = err || x.error?.message || null; }
    await save(() => Promise.resolve({ error: err }) as any, ['pmo_projects'], 'Portfolio saved'); setBusy(false);
  }
  const all = d.rows; const cnt = (k: string, v: string) => all.filter(r => r[k] === v).length;
  return <Page title="Project portfolio" desc={edit ? 'Capital, business and digital projects across the Group — maintained by the PMO.' : 'Projects, their status and whether they are on time and on budget.'} help={<p>The portfolio comes from the weekly tracker's project register. The PMO keeps it up to date here (Studio); unit leaders see their own projects in Insights. Link each project to the strategic goal it serves so it shows in the strategy. Overdue = past its (revised) end date and not completed.</p>}>
    <Cmd right={<><Seg value={pv} options={[['register', 'Register'], ['monthly', 'Monthly progress'], ['phases', 'Phases & plan']]} onChange={setPv} />{(edit || can('seeGroup')) && <Seg value={scope} options={[['all', 'All companies'], ['unit', 'Selected unit']]} onChange={setScope} />}<select value={st} onChange={e => setSt(e.target.value)} aria-label="Status"><option value="">All statuses</option>{STATUS.map(([s]) => <option key={s}>{s}</option>)}</select></>} />
    <div className="kpis"><div className="tile"><div className="tv">{all.length}</div><div className="tl">Projects</div></div><div className="tile good"><div className="tv">{cnt('rag', 'Green')}</div><div className="tl">Green</div></div><div className="tile warn"><div className="tv">{cnt('rag', 'Amber')}</div><div className="tl">Amber</div></div><div className="tile bad"><div className="tv">{cnt('rag', 'Red')}</div><div className="tl">Red</div></div><div className="tile bad"><div className="tv">{all.filter(late).length}</div><div className="tl">Overdue</div></div><div className="tile"><div className="tv">{money(sum(all.map(r => Number(r.budget) || 0)))}</div><div className="tl">Total budget</div></div></div>
    {pv === 'phases' ? <PhasePlanner projects={source} /> : pv === 'monthly' ? <ProjectProgress projects={source} /> : <><Sheet cols={cols} rows={all} onChange={d.change} readOnly={!edit} onAdd={edit ? () => d.add({ name: '', status: 'Not started', rag: 'Green', unit_id: unit } as Row) : undefined} onDelete={edit ? d.remove : undefined} />
    <SaveBar dirty={d.dirty} onSave={doSave} onDiscard={d.reset} busy={busy} /></>}
  </Page>;
}


/** Monthly progress per project: record each month's % done, spend and RAG, and see the trend. */
function ProjectProgress({ projects }: { projects: Row[] }) {
  const { db, me, role, can } = useData(); const save = useSave(); const cm = curMonth(); const [m, setM] = useState(cm); if (!db || !me) return null;
  const months = Array.from({ length: cm }, (_, i) => i + 1);
  const pmo = byId(db.org_units, me.org_unit_id)?.code === 'pmo';
  const canEdit = (p: Row) => can('approve') || pmo || (['unit_head', 'planning_head', 'finance'].includes(role) && p.unit_id === me.unit_id);
  const rec = (pid: string, mm: number) => db.pmo_progress.find(r => r.project_id === pid && r.month === mm && r.fiscal_year === '2026/27');
  const last = (pid: string, mm: number) => { for (let k = mm - 1; k >= 1; k--) { const r = rec(pid, k); if (r) return r; } return null; };
  async function put(p: Row, field: string, v: any) {
    const ex = rec(p.id, m); const row = { project_id: p.id, fiscal_year: '2026/27', month: m, [field]: v, updated_at: new Date().toISOString() };
    const ok = await save(() => ex ? sb.from('pmo_progress').update({ [field]: v, updated_at: row.updated_at }).eq('id', ex.id) : sb.from('pmo_progress').insert(row), ['pmo_progress']);
    // the latest month also updates the project's current status
    if (ok && m >= Math.max(0, ...db!.pmo_progress.filter(r => r.project_id === p.id).map(r => r.month))) { const map: Record<string, string> = { progress_pct: 'progress_pct', spent: 'spent', rag: 'rag', note: 'note', status: 'status' }; await sb.from('pmo_projects').update({ [map[field]]: v, updated_at: new Date().toISOString() }).eq('id', p.id); }
  }
  const avgBy = months.map(mm => { const xs = projects.map(p => rec(p.id, mm)?.progress_pct).filter(v => v != null).map(Number); return xs.length ? sum(xs) / xs.length : null; });
  const ragBy = (rg: string) => months.map(mm => projects.some(p => rec(p.id, mm)) ? projects.filter(p => rec(p.id, mm)?.rag === rg).length : null);
  const tone = (rg?: string) => rg === 'Green' ? 'var(--good-soft)' : rg === 'Amber' ? 'var(--warn-soft)' : rg === 'Red' ? 'var(--bad-soft)' : undefined;
  return <>
    <div className="g2" style={{ marginBottom: 12 }}>
      <div className="card"><h4>Average % done by month</h4><LineChart labels={months.map(x => MONTHS[x - 1])} series={[{ name: '% done', values: avgBy.map(v => v == null ? null : v / 100), color: 'var(--accent, #c9a227)' }]} pctAxis fmtY={v => Math.round(v * 100) + '%'} height={150} /></div>
      <div className="card"><h4>RAG by month</h4><LineChart labels={months.map(x => MONTHS[x - 1])} series={[{ name: 'Green', values: ragBy('Green'), color: 'var(--good)' }, { name: 'Amber', values: ragBy('Amber'), color: 'var(--warn)' }, { name: 'Red', values: ragBy('Red'), color: 'var(--bad)' }]} height={150} /></div>
    </div>
    <div className="row" style={{ marginBottom: 8 }}><b>Record for</b><Seg value={String(m)} options={months.map(x => [String(x), MONTHS[x - 1]] as [string, string])} onChange={v => setM(Number(v))} /><span className="sp" /><span className="note">Type and leave the box — it saves. The latest month also updates the project's current status in the register.</span></div>
    <div className="tw"><table className="t"><thead><tr><th className="first">Project</th>{months.map(x => <th key={x} className="n" style={x === m ? { background: 'var(--info-soft)' } : undefined}>{MONTHS[x - 1]}</th>)}<th className="n">{MONTHS[m - 1]} % done</th><th className="n">Spent to date</th><th>RAG</th><th>Update</th></tr></thead><tbody>
      {projects.map(p => { const r = rec(p.id, m); const prev = last(p.id, m); const ed = canEdit(p);
        return <tr key={p.id}><td className="first">{p.code ? p.code + ' · ' : ''}{p.name}<div className="mini">{byId(db.org_units, p.unit_id)?.name}{p.manager ? ' · ' + p.manager : ''}</div></td>
          {months.map(x => { const q = rec(p.id, x); return <td key={x} className="n" style={{ background: tone(q?.rag) }} data-tip={q?.note || undefined}>{q?.progress_pct != null ? fmt(Number(q.progress_pct)) + '%' : ''}</td>; })}
          <td className="n">{ed ? <NumIn w={64} value={r?.progress_pct ?? null} onChange={v => put(p, 'progress_pct', v)} /> : r?.progress_pct ?? ''}{!r && prev?.progress_pct != null && <div className="mini">last {fmt(Number(prev.progress_pct))}%</div>}</td>
          <td className="n">{ed ? <NumIn w={100} value={r?.spent ?? null} onChange={v => put(p, 'spent', v)} /> : money(r?.spent)}</td>
          <td>{ed ? <select value={r?.rag || ''} onChange={e => put(p, 'rag', e.target.value || null)}><option value="">—</option>{RAG.map(([v]) => <option key={v}>{v}</option>)}</select> : r?.rag}</td>
          <td>{ed ? <input type="text" defaultValue={r?.note || ''} placeholder={prev?.note ? 'last: ' + prev.note.slice(0, 40) : 'What moved this month'} onBlur={e => { if ((e.target.value || null) !== (r?.note || null)) put(p, 'note', e.target.value || null); }} /> : <span className="mini">{r?.note}</span>}</td></tr>; })}
    </tbody></table></div>
    {!projects.length && <Empty>No projects in this view.</Empty>}
  </>;
}


const monthOfDate = (d: string) => { const m = new Date(d + 'T00:00:00Z').getUTCMonth() + 1; return ((m - 7 + 12) % 12) + 1; };
/** Project phases by month: a phase runs from one month to another; each month of it can become a monthly deliverable
    for the phase owner, which is then broken into weekly activities in Plan → Weekly activities. */
function PhasePlanner({ projects }: { projects: Row[] }) {
  const { db, me, role, can, unit, user } = useData(); const save = useSave(); const [pid, setPid] = useState(''); const [nm, setNm] = useState(''); if (!db || !me) return null;
  const engagements = db.projects.filter(p => (can('seeGroup') || p.unit_id === me.unit_id) && (!unit || p.unit_id === unit));
  const all: [string, string, Row][] = [...projects.map(p => ['pmo:' + p.id, (p.code ? p.code + ' · ' : '') + p.name, p] as [string, string, Row]), ...engagements.map(p => ['eng:' + p.id, p.name, p] as [string, string, Row])];
  const cur = all.find(x => x[0] === pid) || all[0]; if (!cur) return <Empty>No projects in this view.</Empty>;
  const [kind, id] = cur[0].split(':'); const proj = cur[2]; const punit = proj.unit_id;
  const phases = db.project_phases.filter(f => (kind === 'pmo' ? f.pmo_project_id === id : f.project_id === id)).sort((a, b) => a.start_month - b.start_month || a.sort - b.sort);
  const pmo = byId(db.org_units, me.org_unit_id)?.code === 'pmo';
  const ed = can('approve') || pmo || (['unit_head', 'planning_head', 'dept_head', 'div_head'].includes(role) && punit === me.unit_id);
  const people = db.positions.filter(x => x.unit_id === punit && x.holder_name).map(x => [x.id, x.holder_name] as [string, string]);
  const delsOf = (f: Row) => db.deliverables.filter(d => d.phase_id === f.id && d.status !== 'removed');
  const upd = (f: Row, patch: Row) => save(() => sb.from('project_phases').update(patch).eq('id', f.id), ['project_phases']);
  async function add() { if (!nm.trim()) return; const cm = curMonth();
    await save(() => sb.from('project_phases').insert({ unit_id: punit, [kind === 'pmo' ? 'pmo_project_id' : 'project_id']: id, name: nm.trim(), start_month: cm, end_month: Math.min(12, cm + 1), sort: phases.length + 1 }), ['project_phases'], 'Phase added'); setNm(''); }
  async function makeDels(f: Row) {
    if (!f.owner_position_id) { alert('Choose the phase owner first — the monthly deliverables go to them.'); return; }
    const have = new Set(delsOf(f).map(d => d.month)); const months = Array.from({ length: f.end_month - f.start_month + 1 }, (_, i) => f.start_month + i).filter(x => !have.has(x));
    if (!months.length) return; const n = months.length; const w = f.weight != null ? Math.round(Number(f.weight) / n * 100) / 100 : null;
    await save(() => sb.from('deliverables').insert(months.map(mm => ({ unit_id: punit, owner_position_id: f.owner_position_id, fiscal_year: '2026/27', month: mm, quarter: qOfMonth(mm), title: `${f.name} — ${MONTHS[mm - 1]}`, phase_id: f.id, status: 'planned', source: 'plan', created_by: user.id, weight: w }))), ['deliverables'], `${n} monthly deliverable${n > 1 ? 's' : ''} created — rename them to what each month must produce, then plan the weeks`);
  }
  const Q = [1, 2, 3, 4];
  return <>
    <div className="row" style={{ marginBottom: 8 }}><b>Project</b><select value={cur[0]} onChange={e => setPid(e.target.value)} style={{ maxWidth: 420 }}>{projects.length > 0 && <optgroup label="Project portfolio">{all.filter(x => x[0].startsWith('pmo')).map(x => <option key={x[0]} value={x[0]}>{x[1]}</option>)}</optgroup>}{engagements.length > 0 && <optgroup label="Engagements (revenue projects)">{all.filter(x => x[0].startsWith('eng')).map(x => <option key={x[0]} value={x[0]}>{x[1]}</option>)}</optgroup>}</select>
      <span className="note">{byId(db.org_units, punit)?.name}</span><span className="sp" /></div>
    <p className="note" style={{ marginBottom: 8 }}>Break the project into phases and set the months each one runs. <b>Make monthly deliverables</b> turns every month of a phase into a deliverable for the phase owner; in Plan → Weekly activities they appear with the weekly steps that deliver them. Progress of a phase = its monthly deliverables accepted. Set what a phase waits for (<b>Starts after</b>) and its planned and actual finish dates to see what is late.</p>
    <div className="tw"><table className="phases"><thead><tr><th className="first">Phase</th><th>Owner</th><th className="n">From</th><th className="n">To</th><th className="n" data-tip="Share of the project (optional)">Weight %</th><th data-tip="A phase that must finish before this one starts">Starts after</th><th data-tip="The date this phase should finish">Planned finish</th><th data-tip="The date it actually finished">Actual finish</th>
      {Q.map(q => <th key={q} colSpan={3} className="qh">Q{q}</th>)}<th>Monthly deliverables</th></tr>
      <tr><th /><th /><th /><th /><th /><th /><th /><th />{MONTHS.map(x => <th key={x} className="pmh">{x}</th>)}<th /></tr></thead><tbody>
      {phases.map(f => { const ds = delsOf(f); const acc = ds.filter(d => d.status === 'accepted').length; const span = f.end_month - f.start_month + 1;
        return <tr key={f.id}><td className="first">{ed ? <input className="stepin" defaultValue={f.name} onBlur={e => e.target.value.trim() && e.target.value !== f.name && upd(f, { name: e.target.value.trim() })} /> : f.name}</td>
          <td>{ed ? <select value={f.owner_position_id || ''} onChange={e => upd(f, { owner_position_id: e.target.value || null })}><option value="">—</option>{people.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select> : posName(db, f.owner_position_id)}</td>
          <td className="n">{ed ? <select value={f.start_month} onChange={e => { const v = Number(e.target.value); upd(f, { start_month: v, end_month: Math.max(v, f.end_month) }); }}>{MONTHS.map((x, i) => <option key={x} value={i + 1}>{x}</option>)}</select> : MONTHS[f.start_month - 1]}</td>
          <td className="n">{ed ? <select value={f.end_month} onChange={e => upd(f, { end_month: Math.max(Number(e.target.value), f.start_month) })}>{MONTHS.map((x, i) => i + 1 >= f.start_month && <option key={x} value={i + 1}>{x}</option>)}</select> : MONTHS[f.end_month - 1]}</td>
          <td className="n">{ed ? <NumIn w={56} value={f.weight} onChange={v => upd(f, { weight: v })} /> : f.weight ?? ''}</td>
          <td>{(() => { const dep = f.depends_on && phases.find(x => x.id === f.depends_on); const clash = dep && f.start_month <= dep.end_month && !(dep.actual_finish && monthOfDate(dep.actual_finish) < f.start_month);
            return <>{ed ? <select value={f.depends_on || ''} onChange={e => upd(f, { depends_on: e.target.value || null })}><option value="">—</option>{phases.filter(x => x.id !== f.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select> : dep?.name || ''}{clash && <div className="mini" style={{ color: 'var(--warn)' }}>starts before {dep.name} ends</div>}</>; })()}</td>
          <td>{ed ? <input type="date" defaultValue={f.planned_finish || ''} onBlur={e => (e.target.value || null) !== (f.planned_finish || null) && upd(f, { planned_finish: e.target.value || null })} /> : f.planned_finish || ''}</td>
          <td>{ed ? <input type="date" defaultValue={f.actual_finish || ''} onBlur={e => (e.target.value || null) !== (f.actual_finish || null) && upd(f, { actual_finish: e.target.value || null })} /> : f.actual_finish || ''}{(() => { const today = new Date().toISOString().slice(0, 10); if (!f.planned_finish) return null; if (f.actual_finish) { const days = Math.round((Date.parse(f.actual_finish) - Date.parse(f.planned_finish)) / 864e5); return <div className="mini" style={{ color: days > 0 ? 'var(--bad)' : 'var(--good)' }}>{days > 0 ? `${days} days late` : days < 0 ? `${-days} days early` : 'on time'}</div>; } return today > f.planned_finish ? <div className="mini" style={{ color: 'var(--bad)' }}>overdue</div> : null; })()}</td>
          {MONTHS.map((_, i) => { const mm = i + 1; const inR = mm >= f.start_month && mm <= f.end_month; const d = ds.find(x => x.month === mm); return <td key={i} className={'gc' + (inR ? ' in' : '') + (mm === f.start_month ? ' s' : '') + (mm === f.end_month ? ' e' : '') + (d?.status === 'accepted' ? ' acc' : '')} data-tip={d ? `${d.title} · ${d.status === 'done' ? 'submitted' : d.status}` : inR ? 'No deliverable yet for this month' : undefined}>{d ? (d.status === 'accepted' ? '✓' : '●') : ''}</td>; })}
          <td className="nowrap">{ds.length ? <span className="mini">{acc}/{ds.length} accepted · </span> : null}{ed && ds.length < span && <button className="btn xs pri" onClick={() => makeDels(f)}>{ds.length ? `+ ${span - ds.length} missing` : 'Make monthly deliverables'}</button>}{ed && !ds.length && <button className="btn xs" onClick={() => { if (confirm('Delete this phase?')) save(() => sb.from('project_phases').delete().eq('id', f.id), ['project_phases'], 'Phase deleted'); }}>×</button>}</td></tr>; })}
      {!phases.length && <tr><td colSpan={21} className="note">No phases yet.</td></tr>}
      {ed && <tr><td colSpan={21}><div className="row"><input type="text" placeholder="New phase, e.g. Design, Procurement, Installation, Handover" value={nm} onChange={e => setNm(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} style={{ minWidth: 340 }} /><button className="btn sm" disabled={!nm.trim()} onClick={add}>+ Phase</button></div></td></tr>}
    </tbody></table></div>
  </>;
}

/* ---------- Backup & restore ---------- */
export function Backup() {
  const { db, reload } = useData(); const [log, setLog] = useState<string[]>([]); const [busy, setBusy] = useState(false);
  if (!db) return null;
  function download() {
    const data: Row = { meta: { app: 'WBG Planning', at: new Date().toISOString(), fiscal_year: '2026/27' } };
    (TABLES as readonly string[]).filter(t => !['notifications', 'messages', 'profiles', 'position_claims'].includes(t)).forEach(t => { data[t] = (db as Row)[t]; });
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })); a.download = `wbg-planning-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  }
  async function restore(f: File) {
    if (!confirm('Restore this backup? Rows in the backup are written back; rows created since the backup are kept.')) return;
    setBusy(true); setLog([]); const add = (m: string) => setLog(l => [...l, m]);
    try { const T = JSON.parse(await f.text()); const order = ['org_units', 'positions', 'group_pillars', 'group_goals', 'unit_pillars', 'unit_goals', 'strategy_statements', 'objectives', 'key_results', 'kr_targets', 'kr_month_targets', 'kr_plan_links', 'check_ins', 'projects', 'plan_lines', 'actuals', 'cash_items', 'cash_values', 'funds', 'fund_months', 'need_priority', 'need_schedule', 'plan_status', 'rescopes', 'deliverables', 'activities', 'week_reviews', 'scorecards', 'scorecard_items', 'pmo_projects', 'cash_actual', 'cash_weekly'];
      for (const t of order) { const rows: Row[] = T[t]; if (!rows?.length) continue; let n = 0; for (let i = 0; i < rows.length; i += 250) { const { data, error } = await sb.rpc('import_rows', { tbl: t, rows: rows.slice(i, i + 250) }); if (error) throw new Error(`${t}: ${error.message}`); n += data as number; } add(`${t}: ${n}`); }
      add('Done.'); await reload(); } catch (e: any) { add('Stopped — ' + e.message); }
    setBusy(false);
  }
  return <Page title="Backup & restore" desc="Download everything as one file; restore it if something goes wrong." help={<><p>A backup is a single file with every plan, objective, key result, deliverable, activity, scorecard, actual and setting. Keep one before big changes and at each month end. Restore writes the rows in the file back (rows added since are kept). To undo a single change, use Audit log → Undo.</p><p>The free database plan has no automatic backups, so download one regularly.</p></>}>
    <div className="g2"><div className="card stack"><h2>Download a backup</h2><p className="note">{(TABLES as readonly string[]).length} tables · taken in your browser, nothing leaves except the file.</p><button className="btn pri" onClick={download}>Download backup</button></div>
      <div className="card stack"><h2>Restore</h2><input type="file" accept=".json" disabled={busy} onChange={e => e.target.files?.[0] && restore(e.target.files[0])} />{busy && <p>Restoring… keep this page open.</p>}{log.map((l, i) => <div key={i} className="mini">{l}</div>)}</div></div>
  </Page>;
}

/* ---------- ERP personal OKRs: replanning campaign ---------- */
export function ErpReplan() {
  const { db, user, can, unit } = useData(); const save = useSave(); const [q, setQ] = useState(''); const [show, setShow] = useState<string | null>(null);
  if (!db) return null;
  const st = db.settings.erp_replan || {};
  const erpD = db.deliverables.filter(d => (d.source === 'erp' || d.source === 'erp_reviewed') && (can('seeGroup') || d.unit_id === unit));
  const orgs = Array.from(new Set(erpD.map(d => byId(db.positions, d.owner_position_id)?.org_unit_id).filter(Boolean))) as string[];
  const headOf = (orgId: string) => db.positions.find(p => p.org_unit_id === orgId && p.level !== 'employee');
  const rows = orgs.map(o => { const ds = erpD.filter(d => byId(db.positions, d.owner_position_id)?.org_unit_id === o); const org = byId(db.org_units, o);
    return { o, org, unit: byId(db.org_units, org?.unit_id)?.name, head: headOf(o), todo: ds.filter(d => d.source === 'erp' && d.status !== 'removed').length, done: ds.filter(d => d.source === 'erp_reviewed' && d.status !== 'removed').length, removed: ds.filter(d => d.status === 'removed').length, total: ds.length }; })
    .filter(r => !q || (r.org?.name + ' ' + r.unit).toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.todo - a.todo);
  const archived = db.objectives.filter(o => o.level === 'individual' && o.status === 'Archived' && (can('seeGroup') || o.unit_id === unit));
  const tot = { todo: sum(rows.map(r => r.todo)), done: sum(rows.map(r => r.done)), removed: sum(rows.map(r => r.removed)) };
  async function ask(targets: typeof rows) {
    const heads = targets.filter(r => r.todo && r.head).map(r => r.head!.id);
    const { notifyPositions } = await import('../../lib/data');
    await notifyPositions(db!, heads, 'replan', `Please replan your team's deliverables from the ERP personal OKRs${st.deadline ? ' by ' + st.deadline : ''}`, '/plan?tab=deliverables', 'Link each one to a key result, set the month, owner and weight — or remove it.');
    await save(() => sb.from('app_settings').upsert({ key: 'erp_replan', value: { ...st, requested_at: new Date().toISOString(), requested_by: user.id } }), ['app_settings'], `Replan request sent to ${heads.length} head(s)`);
  }
  return <Page title="ERP OKR replan" desc="Personal OKRs from the ERP were kept as deliverables under their department objectives so no work was lost. Heads now replan them properly." help={<>
    <p><b>What happened:</b> each personal ERP objective became a deliverable (with its original text in "Original ERP OKR") under the department objective it served, and the personal objective was archived — nothing was deleted.</p>
    <p><b>What heads do:</b> in Work → Plan → Deliverables, each one shows "⚑ replan". They link it to the right key result, set the month, owner and weight, or delete it. Saving marks it replanned. "Keep all shown as they are" accepts them unchanged.</p>
    <p><b>What you do here:</b> set a deadline, send the request, and follow progress by department.</p></>}>
    <div className="kpis"><div className={'tile ' + (tot.todo ? 'warn' : 'good')}><div className="tv">{tot.todo}</div><div className="tl">Still to replan</div></div><div className="tile good"><div className="tv">{tot.done}</div><div className="tl">Replanned</div></div><div className="tile"><div className="tv">{tot.removed}</div><div className="tl">Removed by heads</div></div><div className="tile"><div className="tv">{archived.length}</div><div className="tl">Archived personal objectives</div></div></div>
    <div className="card row" style={{ gap: 10 }}><label className="f" style={{ maxWidth: 220 }}>Deadline<input type="date" value={st.deadline || ''} onChange={e => save(() => sb.from('app_settings').upsert({ key: 'erp_replan', value: { ...st, deadline: e.target.value } }), ['app_settings'], 'Deadline saved')} /></label>
      <span className="note" style={{ flex: 1 }}>{st.requested_at ? `Last request sent ${String(st.requested_at).slice(0, 10)}.` : 'No request sent yet.'}</span><button className="btn pri" disabled={!tot.todo} onClick={() => ask(rows)}>Ask all heads with items left to replan</button></div>
    <Cmd right={<input type="text" placeholder="Find a department or unit" value={q} onChange={e => setQ(e.target.value)} />} />
    <div className="tw"><table className="t"><thead><tr><th>Organisation</th><th>Head</th><th className="n">To replan</th><th className="n">Replanned</th><th className="n">Removed</th><th>Progress</th><th /></tr></thead><tbody>
      {rows.map(r => <tr key={r.o}><td><b>{r.org?.name}</b><div className="mini">{r.unit}</div></td><td>{r.head?.holder_name || <span className="note">vacant</span>}</td><td className="n">{r.todo}</td><td className="n">{r.done}</td><td className="n">{r.removed}</td><td>{pct(r.total ? (r.done + r.removed) / r.total : null)}</td>
        <td><div className="row" style={{ flexWrap: 'nowrap' }}><button className="btn sm" onClick={() => setShow(show === r.o ? null : r.o)}>{show === r.o ? 'Hide' : 'Items'}</button>{r.todo > 0 && r.head && <button className="btn sm" onClick={() => ask([r])}>Remind</button>}</div></td></tr>)}
    </tbody></table></div>
    {show && <div className="card" style={{ marginTop: 10 }}><h3>{byId(db.org_units, show)?.name}</h3><div className="tw"><table className="t"><thead><tr><th>Deliverable</th><th>Original ERP OKR</th><th>Owner</th><th>Key result</th><th>State</th></tr></thead><tbody>
      {erpD.filter(d => byId(db.positions, d.owner_position_id)?.org_unit_id === show).map(d => <tr key={d.id}><td>{d.title}</td><td className="mini">{String(d.note || '').replace('From ERP personal OKR: ', '')}</td><td>{byId(db.positions, d.owner_position_id)?.holder_name}</td><td className="mini">{byId(db.key_results, d.key_result_id)?.title || '— not linked'}</td><td><Pill tone={d.status === 'removed' ? 'none' : d.source === 'erp' ? 'warn' : 'good'}>{d.status === 'removed' ? 'removed' : d.source === 'erp' ? 'to replan' : 'replanned'}</Pill></td></tr>)}
    </tbody></table></div></div>}
    <details className="card" style={{ marginTop: 12 }}><summary><b>Archived personal objectives ({archived.length})</b> — the originals, kept for reference</summary>
      <div className="tw" style={{ marginTop: 8 }}><table className="t"><thead><tr><th>Objective</th><th>Owner</th><th>Organisation</th><th>Key results</th></tr></thead><tbody>
        {archived.slice(0, 300).map(o => <tr key={o.id}><td>{o.text}</td><td>{byId(db.positions, o.owner_position_id)?.holder_name}</td><td className="mini">{byId(db.org_units, o.org_unit_id)?.name}</td><td className="mini">{db.key_results.filter(k => k.objective_id === o.id).map(k => k.title).join(' · ')}</td></tr>)}
      </tbody></table></div></details>
  </Page>;
}
