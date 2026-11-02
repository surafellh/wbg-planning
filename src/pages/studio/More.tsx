/* STUDIO — rescope editor, monthly resources & payment scheduling, project portfolio, backup & restore. */
import { useMemo, useState } from 'react';
import { useData, useSave, byId, TABLES, type DB, type Row } from '../../lib/data';
import { sb } from '../../lib/supabase';
import { MONTHS, qMonths, qOfMonth, curMonth, linesOf, lineVals, lineQty, sum, money, pct, fmt } from '../../lib/calc';
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
  const { db, unit, can } = useData(); const save = useSave(); const [m, setM] = useState(curMonth()); const [busy, setBusy] = useState(false);
  const fm = db && unit ? db.fund_months.find(f => f.unit_id === unit && f.month === m) : null;
  const qf = db && unit ? db.funds.find(f => f.unit_id === unit && f.quarter === qOfMonth(m)) : null;
  const funds = { confirmed: fm ? Number(fm.confirmed) : qf ? Number(qf.confirmed) / 3 : 0, expected: fm ? Number(fm.expected) : qf ? Number(qf.expected) / 3 : 0 };
  const source = useMemo(() => {
    if (!db || !unit) return [];
    const groups = new Map<string, Row>();
    linesOf(db, unit).filter(l => ['cos', 'opex', 'capex', 'proj'].includes(l.section)).forEach(l => { const key = `${l.section}|${l.line_group || 'Other'}`; const g = groups.get(key) || { key, sec: l.section, grp: l.line_group || 'Other', amt: 0, must: l.section === 'opex' || !!l.must_pay }; g.amt += lineVals(l)[m - 1]; g.must = g.must || l.section === 'opex'; groups.set(key, g); });
    const rank0 = (k: string) => db.need_priority.find(n => n.unit_id === unit && n.need_key === k)?.rank ?? 99;
    const rows: Row[] = Array.from(groups.values()).filter(g => g.amt > 0).map(g => { const s = db.need_schedule.find(x => x.unit_id === unit && x.need_key === g.key && x.plan_month === m);
      return { id: s?.id, key: g.key, plan_month: m, need: g.grp, sec: SECN[g.sec], planned: g.amt, pay_month: String(s?.pay_month ?? m), amount: s?.amount ?? g.amt, rank: s?.rank ?? (g.must ? 0 : rank0(g.key)), status: s?.status || 'Scheduled', must: g.must ? 'committed' : '', carried: '' }; });
    // amounts deferred from earlier months into this one
    db.need_schedule.filter(x => x.unit_id === unit && x.plan_month < m && x.pay_month === m && x.status !== 'Cancelled').forEach(x => rows.push({ id: x.id, key: x.need_key, plan_month: x.plan_month, need: x.need_key.split('|')[1], sec: SECN[x.need_key.split('|')[0]], planned: Number(x.amount), pay_month: String(m), amount: Number(x.amount), rank: x.rank ?? 50, status: x.status, must: '', carried: `from ${MONTHS[x.plan_month - 1]}` }));
    return rows.sort((a, b) => Number(!!b.must) - Number(!!a.must) || (a.rank ?? 99) - (b.rank ?? 99));
  }, [db, unit, m]);
  const d = useDraft(source, [source]);
  if (!db || !unit) return null;
  // waterline over what is paid THIS month, in priority order
  const paying = d.rows.filter(r => Number(r.pay_month) === m && !['Deferred', 'Cancelled'].includes(r.status)).sort((a, b) => Number(!!b.must) - Number(!!a.must) || (Number(a.rank) || 0) - (Number(b.rank) || 0));
  let run = 0; const tier = new Map<Row, string>(); paying.forEach(r => { run += Number(r.amount) || 0; tier.set(r, run <= funds.confirmed ? 'Funded' : run <= funds.confirmed + funds.expected ? 'Conditional' : 'Backlog'); });
  const tot = (t: string) => sum(paying.filter(r => tier.get(r) === t).map(r => Number(r.amount)));
  const deferred = sum(d.rows.filter(r => Number(r.pay_month) > m || r.status === 'Deferred').map(r => Number(r.amount)));
  const cols: Col[] = [{ key: 'need', label: 'Need (budget group)', type: 'ro', width: 200 }, { key: 'sec', label: 'Section', type: 'ro', width: 130 }, { key: 'carried', label: 'Carried', type: 'ro', width: 90 },
    { key: 'planned', label: `${MONTHS[m - 1]} planned`, type: 'ro', width: 110, fmt: v => money(v) },
    { key: 'pay_month', label: 'Pay in', type: 'select', options: MONTHS.map((x, i) => [String(i + 1), x] as [string, string]).filter(([k]) => Number(k) >= m), width: 90, tip: 'Schedule the payment for this month or push it to a later month.' },
    { key: 'amount', label: 'Amount to pay', type: 'number', width: 120 }, { key: 'rank', label: 'Priority', type: 'number', width: 80, tip: 'Lower number = paid first. Committed costs (salaries, operating costs) always come first.' },
    { key: 'must', label: 'Committed', type: 'ro', width: 90 }, { key: 'status', label: 'Status', type: 'select', options: [['Scheduled', 'Scheduled'], ['Paid', 'Paid'], ['Deferred', 'Deferred'], ['Cancelled', 'Cancelled']], width: 110 },
    { key: 'tier', label: 'Waterline', type: 'ro', width: 100, fmt: (_, r) => { const t = tier.get(r); return t ? <Pill tone={t === 'Funded' ? 'good' : t === 'Conditional' ? 'warn' : 'bad'}>{t}</Pill> : Number(r.pay_month) > m ? `→ ${MONTHS[Number(r.pay_month) - 1]}` : ''; } }];
  async function doSave() {
    setBusy(true); let err: string | null = null;
    for (const r of d.all.filter(r => r._dirty)) { const row = { unit_id: unit, fiscal_year: '2026/27', need_key: r.key, plan_month: r.plan_month, pay_month: Number(r.pay_month), amount: r.amount, rank: r.rank, status: Number(r.pay_month) > r.plan_month && r.status === 'Scheduled' ? 'Deferred' : r.status };
      const x = await sb.from('need_schedule').upsert(row, { onConflict: 'unit_id,fiscal_year,need_key,plan_month' }); err = err || x.error?.message || null; }
    await save(() => Promise.resolve({ error: err }) as any, ['need_schedule'], 'Schedule saved'); setBusy(false);
  }
  const setFund = (k: 'confirmed' | 'expected', v: number | null) => save(() => sb.from('fund_months').upsert({ unit_id: unit, fiscal_year: '2026/27', month: m, confirmed: k === 'confirmed' ? v || 0 : funds.confirmed, expected: k === 'expected' ? v || 0 : funds.expected }), ['fund_months'], 'Funds updated');
  return <Page title="Resources" desc="Month by month: the money available, what gets paid, in what order, and what is pushed to a later month." help={<>
    <p>Each month lists the planned spending by budget group (from the annual plan), plus anything deferred from earlier months. <b>Committed costs</b> are paid first; the rest follows the <b>priority</b> you set (lower = first). Use <b>Pay in</b> to schedule a payment for a later month — it moves to that month's list automatically.</p>
    <p>The <b>waterline</b> compares the running total with the month's funds: <b>Funded</b> (within confirmed money), <b>Conditional</b> (only if expected money arrives), <b>Backlog</b> (not covered — defer, cut or rescope). Funds default to a third of the quarter's funds until you set the month's own figures.</p></>}>
    <Cmd right={<select value={m} onChange={e => setM(Number(e.target.value))}>{MONTHS.map((x, i) => <option key={x} value={i + 1}>{x}{i + 1 === curMonth() ? ' (now)' : ''}</option>)}</select>} />
    <div className="kpis">
      <div className="tile good"><div className="tv">{money(funds.confirmed)}</div><div className="tl">Confirmed funds</div>{can('editPlan') && <div className="ts">Set: <NumIn value={Math.round(funds.confirmed)} onChange={v => setFund('confirmed', v)} w={120} /></div>}</div>
      <div className="tile warn"><div className="tv">{money(funds.expected)}</div><div className="tl">Expected funds</div>{can('editPlan') && <div className="ts">Set: <NumIn value={Math.round(funds.expected)} onChange={v => setFund('expected', v)} w={120} /></div>}</div>
      <div className="tile"><div className="tv">{money(sum(paying.map(r => Number(r.amount))))}</div><div className="tl">To pay this month</div><div className="ts">Funded {money(tot('Funded'))} · Conditional {money(tot('Conditional'))}</div></div>
      <div className={'tile ' + (tot('Backlog') ? 'bad' : 'good')}><div className="tv">{money(tot('Backlog'))}</div><div className="tl">Below the waterline</div></div>
      <div className="tile"><div className="tv">{money(deferred)}</div><div className="tl">Pushed to later months</div></div></div>
    {!d.rows.length ? <Empty>No planned spending in {MONTHS[m - 1]}.</Empty> : <Sheet cols={cols} rows={d.rows} onChange={d.change} readOnly={!can('editPlan')} />}
    <SaveBar dirty={d.dirty} onSave={doSave} onDiscard={d.reset} busy={busy} />
    <p className="note">Quarter view: {pct(tot('Funded') / Math.max(1, sum(paying.map(r => Number(r.amount)))))} of this month's payments are funded.</p>
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
