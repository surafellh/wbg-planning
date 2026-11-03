/* STUDIO — rescope editor, monthly resources & payment scheduling, project portfolio, backup & restore. */
import { useMemo, useState } from 'react';
import { useData, useSave, byId, TABLES, type DB, type Row } from '../../lib/data';
import { sb } from '../../lib/supabase';
import { MONTHS, qMonths, qOfMonth, curMonth, linesOf, lineVals, lineQty, sum, money, pct, fmt, needLines, type NeedLine } from '../../lib/calc';
import { Page, Cmd, Seg, Pill, Empty, Modal, NumIn } from '../../lib/ui';
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
    const { groups } = needLines(db, unit, [m], { confirmed: 0, expected: 0 });
    const row = (n: NeedLine, gRank: number): Row => { const s = db.need_schedule.find(x => x.unit_id === unit && x.need_key === n.key && x.plan_month === m);
      return { id: s?.id, key: n.key, gkey: n.must ? 'committed' : n.gkey, grank: n.must ? -1 : gRank, plan_month: m, need: n.line.name, grp: n.grp, sec: SECN[n.sec], planned: n.amount, base: n.base, pay_month: String(s?.pay_month ?? m), amount: s?.amount ?? n.amount, rank: s?.rank ?? n.rank, status: s?.status || 'Scheduled', must: n.must ? 'committed' : '', carried: '' }; };
    const rows: Row[] = groups.flatMap((g, gi) => [...g.committed.map(n => row(n, gi)), ...g.lines.map(n => row(n, gi))]);
    // amounts deferred from earlier months into this one
    db.need_schedule.filter(x => x.unit_id === unit && x.plan_month < m && x.pay_month === m && x.status !== 'Cancelled').forEach(x => { const [sec, grp, lid] = x.need_key.split('|'); const l = lid ? byId(db.plan_lines, lid) : null; const gi = groups.findIndex(g => g.key === `${sec}|${grp}`);
      rows.push({ id: x.id, key: x.need_key, gkey: `${sec}|${grp}`, grank: gi < 0 ? 999 : gi, plan_month: x.plan_month, need: l?.name || grp, grp, sec: SECN[sec], planned: Number(x.amount), base: Number(x.amount), pay_month: String(m), amount: Number(x.amount), rank: x.rank ?? 50, status: x.status, must: '', carried: `from ${MONTHS[x.plan_month - 1]}` }); });
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
  d.rows.forEach((r, i) => { if (r.gkey !== last) { last = r.gkey; const mem = d.rows.filter(x => x.gkey === r.gkey); const on = open.has(r.gkey); const fundedN = mem.filter(x => tier.get(x) === 'Funded').length;
      view.push({ _header: <button className="hbtn" onClick={() => toggle(r.gkey)}>{on ? '▾' : '▸'} {r.gkey === 'committed' ? 'Committed costs (paid first)' : `${r.grp} · ${r.sec}`} <span className="mini" style={{ fontWeight: 400 }}>— {mem.length} line{mem.length > 1 ? 's' : ''} · {money(sum(mem.map(x => Number(x.amount) || 0)))} · {fundedN} funded</span></button> }); idx.push(-1); }
    if (open.has(r.gkey)) { view.push(r); idx.push(i); } });
  const cols: Col[] = [{ key: 'need', label: 'Budget line', type: 'ro', width: 230, fmt: (v, r) => <span>{v}{r.gkey === 'committed' && <span className="mini"> · {r.grp}</span>}</span> }, { key: 'carried', label: 'Carried', type: 'ro', width: 90 },
    { key: 'planned', label: `${MONTHS[m - 1]} planned`, type: 'ro', width: 120, fmt: (v, r) => <span title={Math.abs(v - r.base) > 0.5 ? `Rescoped · original ${money(r.base)}` : undefined}>{money(v)}{Math.abs(v - r.base) > 0.5 ? ' ✎' : ''}</span>, tip: 'The plan in force: after an approved rescope this is the rescoped amount (✎).' },
    { key: 'pay_month', label: 'Pay in', type: 'select', options: MONTHS.map((x, i) => [String(i + 1), x] as [string, string]).filter(([k]) => Number(k) >= m), width: 90, tip: 'Schedule the payment for this month or push it to a later month.' },
    { key: 'amount', label: 'Amount to pay', type: 'number', width: 120 }, { key: 'rank', label: 'Order in group', type: 'number', width: 100, tip: 'Lower number = paid first inside its budget group. The order of the groups is set on the Quarter waterline view.' },
    { key: 'status', label: 'Status', type: 'select', options: [['Scheduled', 'Scheduled'], ['Paid', 'Paid'], ['Deferred', 'Deferred'], ['Cancelled', 'Cancelled']], width: 110 },
    { key: 'tier', label: 'Waterline', type: 'ro', width: 100, fmt: (_, r) => { const t = tier.get(r); return t ? <Pill tone={t === 'Funded' ? 'good' : t === 'Conditional' ? 'warn' : 'bad'}>{t}</Pill> : Number(r.pay_month) > m ? `→ ${MONTHS[Number(r.pay_month) - 1]}` : ''; } }];
  async function doSave() {
    setBusy(true); let err: string | null = null;
    for (const r of d.all.filter(r => r._dirty)) { const row = { unit_id: unit, fiscal_year: '2026/27', need_key: r.key, plan_month: r.plan_month, pay_month: Number(r.pay_month), amount: r.amount, rank: r.rank, status: Number(r.pay_month) > r.plan_month && r.status === 'Scheduled' ? 'Deferred' : r.status };
      const x = await sb.from('need_schedule').upsert(row, { onConflict: 'unit_id,fiscal_year,need_key,plan_month' }); err = err || x.error?.message || null; }
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
  const { db, can, unit } = useData(); const save = useSave(); const [scope, setScope] = useState<'all' | 'unit'>(edit || can('seeGroup') ? 'all' : 'unit'); const [busy, setBusy] = useState(false); const [st, setSt] = useState('');
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
    <Cmd right={<>{(edit || can('seeGroup')) && <Seg value={scope} options={[['all', 'All companies'], ['unit', 'Selected unit']]} onChange={setScope} />}<select value={st} onChange={e => setSt(e.target.value)} aria-label="Status"><option value="">All statuses</option>{STATUS.map(([s]) => <option key={s}>{s}</option>)}</select></>} />
    <div className="kpis"><div className="tile"><div className="tv">{all.length}</div><div className="tl">Projects</div></div><div className="tile good"><div className="tv">{cnt('rag', 'Green')}</div><div className="tl">Green</div></div><div className="tile warn"><div className="tv">{cnt('rag', 'Amber')}</div><div className="tl">Amber</div></div><div className="tile bad"><div className="tv">{cnt('rag', 'Red')}</div><div className="tl">Red</div></div><div className="tile bad"><div className="tv">{all.filter(late).length}</div><div className="tl">Overdue</div></div><div className="tile"><div className="tv">{money(sum(all.map(r => Number(r.budget) || 0)))}</div><div className="tl">Total budget</div></div></div>
    <Sheet cols={cols} rows={all} onChange={d.change} readOnly={!edit} onAdd={edit ? () => d.add({ name: '', status: 'Not started', rag: 'Green', unit_id: unit } as Row) : undefined} onDelete={edit ? d.remove : undefined} />
    <SaveBar dirty={d.dirty} onSave={doSave} onDiscard={d.reset} busy={busy} />
  </Page>;
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
