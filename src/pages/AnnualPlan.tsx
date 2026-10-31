import { useState } from 'react';
import { useData, useSave, byId, type DB, type Row } from '../lib/data';
import { sb } from '../lib/supabase';
import { MONTHS, lineVals, lineQty, linesOf, sum, money, fmt, actualBy, lastActualMonth, pct } from '../lib/calc';
import { Page, Cmd, Seg, NumIn, Empty, Modal, Pill, Bar } from '../lib/ui';
import { planStatus, StatusBar } from './OkrPlan';

export function openRescope(db: DB, unit: string) { return db.rescopes.find(r => r.unit_id === unit && r.status === 'Open'); }
/** The annual plan can be changed while it is a draft, or through an open rescope once approved. */
export function useEditable(unit: string) {
  const { db, can } = useData(); if (!db) return { editable: false, why: '' };
  const st = planStatus(db, unit, 'annual')?.status || 'Draft';
  if (!can('editPlan')) return { editable: false, why: 'Your role can view the plan but not change it.' };
  if (st === 'Approved' && !openRescope(db, unit)) return { editable: false, why: 'The annual plan is approved. Start a rescope (Plan → Rescope & versions) to change it.' };
  if (st === 'Submitted') return { editable: false, why: 'The plan is with Group Strategy for approval.' };
  return { editable: true, why: openRescope(db, unit) ? 'Rescope open: changes are recorded against the approved baseline.' : '' };
}
const SECN: Record<string, string> = { rev: 'Revenue', cos: 'Cost of sales', opex: 'Operating expenses', capex: 'Capital spending', proj: 'Projects' };

function groupsOf(lines: Row[]) { const m = new Map<string, Row[]>(); lines.forEach(l => { const g = l.line_group || 'Other'; m.set(g, [...(m.get(g) || []), l]); }); return Array.from(m.entries()); }

function PlanGrid({ unit, sec, view, editable }: { unit: string; sec: string; view: 'value' | 'qty' | 'pva'; editable: boolean }) {
  const { db } = useData(); const save = useSave(); const [open, setOpen] = useState<Record<string, boolean>>({}); const [flt, setFlt] = useState(''); const [add, setAdd] = useState(false);
  if (!db) return null;
  const all = linesOf(db, unit, sec).sort((a, b) => a.sort - b.sort);
  const lines = all.filter(l => !flt || (l.name + ' ' + (l.line_group || '') + ' ' + (l.code || '')).toLowerCase().includes(flt.toLowerCase()));
  const tools = <div className="row" style={{ marginBottom: 8 }}><input type="text" placeholder="Filter lines" value={flt} onChange={e => setFlt(e.target.value)} /><button className="btn sm" onClick={() => { const g: Record<string, boolean> = {}; groupsOf(lines).forEach(([k]) => { g[k] = true; }); setOpen(Object.keys(open).length ? {} : g); }}>{Object.keys(open).length ? 'Collapse all' : 'Expand all'}</button><span className="sp" /><span className="note">{lines.length} of {all.length} lines</span>{editable && <button className="btn sm pri" onClick={() => setAdd(true)}>+ Line</button>}</div>;
  if (!all.length) return <>{editable && <button className="btn pri" onClick={() => setAdd(true)}>+ Line</button>}<Empty>No {SECN[sec].toLowerCase()} lines in this unit's plan.</Empty>{add && <LineModal unit={unit} sec={sec} onClose={() => setAdd(false)} />}</>;
  const last = lastActualMonth(db, unit);
  const setCell = (l: Row, m: number, v: number | null, kind: 'qty' | 'val') => {
    const q = lineQty(l), val = lineVals(l);
    if (kind === 'qty') { q[m] = v || 0; val[m] = (v || 0) * Number(l.price || 0); } else val[m] = v || 0;
    return save(() => sb.from('plan_lines').update(kind === 'qty' ? { qty: q, val } : { val }).eq('id', l.id), ['plan_lines']);
  };
  const setPrice = (l: Row, p: number | null) => save(() => sb.from('plan_lines').update({ price: p, val: lineQty(l).map(q => q * (p || 0)) }).eq('id', l.id), ['plan_lines'], 'Price updated');
  const grand = Array.from({ length: 12 }, (_, i) => sum(lines.map(l => lineVals(l)[i])));
  return <>{tools}{add && <LineModal unit={unit} sec={sec} onClose={() => setAdd(false)} />}<div className="tw"><table className="t">
    <thead><tr><th className="first">{view === 'pva' ? 'Group' : 'Line'}</th>{view === 'qty' && <th className="n">Price</th>}{MONTHS.map((m, i) => <th key={m} className="n">{m}{view === 'pva' && i < last ? ' ✓' : ''}</th>)}<th className="n">Year</th>{view === 'pva' && <><th className="n">YTD plan</th><th className="n">YTD actual</th><th>Achieved</th></>}</tr></thead>
    <tbody>
      {groupsOf(lines).map(([g, ls]) => {
        const gv = Array.from({ length: 12 }, (_, i) => sum(ls.map(l => lineVals(l)[i])));
        const ytdP = sum(gv.slice(0, last)); const ytdA = actualBy(db, unit, sec, Array.from({ length: last }, (_, i) => i + 1), [g]);
        const acts = Array.from({ length: 12 }, (_, i) => actualBy(db, unit, sec, [i + 1], [g]));
        return [<tr key={g} className="g click" onClick={() => setOpen({ ...open, [g]: !open[g] })}><td className="first">{open[g] ? '▾' : '▸'} {g} <span className="note">({ls.length})</span></td>{view === 'qty' && <td />}
          {gv.map((v, i) => <td key={i} className="n">{view === 'pva' ? <>{money(v)}{acts[i] != null && <div className={'note' + ((acts[i] || 0) < v ? '' : '')}>{money(acts[i])}</div>}</> : view === 'qty' ? '' : money(v)}</td>)}
          <td className="n">{money(sum(gv))}</td>{view === 'pva' && <><td className="n">{money(ytdP)}</td><td className="n">{money(ytdA)}</td><td><Bar p={ytdA == null || !ytdP ? null : (sec === 'rev' ? ytdA / ytdP : ytdP / Math.max(ytdA, 1))} /> <span className="note">{ytdA == null || !ytdP ? '' : pct(ytdA / ytdP)}</span></td></>}</tr>,
          ...(open[g] && view !== 'pva' ? ls.map(l => { const v = view === 'qty' ? lineQty(l) : lineVals(l); const base = view === 'qty' ? lineQty(l, true) : lineVals(l, true);
            return <tr key={l.id}><td className="first ind" title={l.code || ''}>{l.name}{l.uom && view === 'qty' ? <span className="note"> · {l.uom}</span> : ''}</td>
              {view === 'qty' && <td className="n">{editable ? <NumIn value={l.price} onChange={p => setPrice(l, p)} w={100} /> : fmt(Number(l.price))}</td>}
              {v.map((x, i) => <td key={i} className="n" title={base[i] !== x ? `Baseline ${fmt(base[i], 2)}` : ''} style={base[i] !== x ? { background: 'var(--info-soft)' } : undefined}>
                {editable && (view === 'value' ? l.kind === 'value' : l.kind === 'qty') ? <NumIn value={Math.round(x * 100) / 100} onChange={nv => setCell(l, i, nv, view === 'qty' ? 'qty' : 'val')} w={view === 'qty' ? 64 : 96} /> : view === 'qty' ? fmt(x, 2) : money(x)}</td>)}
              <td className="n">{view === 'qty' ? fmt(sum(v), 2) : money(sum(v))}</td></tr>; }) : [])];
      })}
      <tr className="b"><td className="first">Total {SECN[sec].toLowerCase()}</td>{view === 'qty' && <td />}{grand.map((v, i) => <td key={i} className="n">{view === 'qty' ? '' : money(v)}</td>)}<td className="n">{money(sum(grand))}</td>{view === 'pva' && (() => { const p = sum(grand.slice(0, last)); const a = actualBy(db, unit, sec, Array.from({ length: last }, (_, i) => i + 1)); return <><td className="n">{money(p)}</td><td className="n">{money(a)}</td><td>{a != null && p ? pct(a / p) : ''}</td></>; })()}</tr>
    </tbody></table></div></>;
}

function LineModal({ unit, sec, onClose }: { unit: string; sec: string; onClose: () => void }) {
  const { db } = useData(); const save = useSave(); const [f, setF] = useState<Row>({ kind: sec === 'rev' ? 'qty' : 'value', spread: 'even' }); if (!db) return null;
  const groups = Array.from(new Set(linesOf(db, unit, sec).map(l => l.line_group).filter(Boolean)));
  const isQty = f.kind === 'qty'; const annual = Number(f.annual || 0);
  const months = Array.from({ length: 12 }, (_, i) => f.spread === 'even' ? annual / 12 : i < 3 ? 0 : annual / 9);
  return <Modal title={`New ${SECN[sec].toLowerCase()} line`} onClose={onClose}>
    <div className="g2"><label className="f">Group<input type="text" list="lgroups" value={f.line_group || ''} onChange={e => setF({ ...f, line_group: e.target.value })} /><datalist id="lgroups">{groups.map(g => <option key={g} value={g} />)}</datalist></label><label className="f">Line name<input type="text" value={f.name || ''} onChange={e => setF({ ...f, name: e.target.value })} /></label></div>
    <div className="g3">{sec === 'rev' && <label className="f">Planned as<select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}><option value="qty">Quantity × price</option><option value="value">Amount</option></select></label>}
      {isQty && <label className="f">Unit price (ETB)<NumIn value={f.price} onChange={v => setF({ ...f, price: v })} /></label>}<label className="f">{isQty ? 'Unit' : 'Code'}<input type="text" value={(isQty ? f.uom : f.code) || ''} onChange={e => setF({ ...f, [isQty ? 'uom' : 'code']: e.target.value })} /></label></div>
    <div className="g2"><label className="f">{isQty ? 'Quantity for the year' : 'Amount for the year (ETB)'}<NumIn value={f.annual} onChange={v => setF({ ...f, annual: v })} w={160} /></label><label className="f">Spread<select value={f.spread} onChange={e => setF({ ...f, spread: e.target.value })}><option value="even">Evenly over 12 months</option><option value="late">From Q2 onward</option></select></label></div>
    <p className="note">Added to the plan in force; the approved baseline stays as it was (the line shows as a change). Adjust months in the grid after saving.</p>
    <div className="row end"><button className="btn" onClick={onClose}>Cancel</button><button className="btn pri" disabled={!f.name?.trim() || !annual} onClick={async () => {
      const q = isQty ? months.map(x => Math.round(x * 100) / 100) : null; const val = isQty ? q!.map(x => x * Number(f.price || 0)) : months.map(x => Math.round(x));
      if (await save(() => sb.from('plan_lines').insert({ unit_id: unit, fiscal_year: '2026/27', section: sec, line_group: f.line_group || 'Other', name: f.name.trim(), code: f.code || null, uom: isQty ? f.uom || null : 'ETB', kind: isQty ? 'qty' : 'value', price: isQty ? f.price : null, qty0: isQty ? Array(12).fill(0) : null, qty: q, val0: Array(12).fill(0), val, sort: 999 }), ['plan_lines'], 'Line added')) onClose(); }}>Add line</button></div>
  </Modal>;
}

/* ---------- Niyat-style project revenue: engagements billed by milestone ---------- */
function ProjectModal({ unit, init, onClose }: { unit: string; init: Row; onClose: () => void }) {
  const { db } = useData(); const save = useSave();
  const line = db?.plan_lines.find(l => l.project_id === init.id && l.section === 'rev');
  const [f, setF] = useState<Row>({ status: 'Planned', phase: 'Pipeline', ...init, bill: line ? lineVals(line) : Array(12).fill(0) });
  if (!db) return null;
  const set = (k: string, v: any) => setF(x => ({ ...x, [k]: v }));
  const lines = Array.from(new Set(linesOf(db, unit, 'rev').map(l => l.line_group).concat(db.projects.filter(p => p.unit_id === unit).map(p => p.service_line)).filter(Boolean)));
  async function go() {
    const row = { unit_id: unit, fiscal_year: '2026/27', name: f.name.trim(), client: f.client || null, service_line: f.service_line || null, contract_value: f.contract_value ?? null, start_date: f.start_date || null, end_date: f.end_date || null, phase: f.phase, status: f.status, progress_pct: f.progress_pct ?? null, note: f.note || null };
    const r = f.id ? await sb.from('projects').update(row).eq('id', f.id).select('id').single() : await sb.from('projects').insert(row).select('id').single();
    if (r.error) { alert(r.error.message); return; }
    const billed = sum(f.bill);
    let res: any;
    if (line) res = () => sb.from('plan_lines').update({ val: f.bill, name: row.name, line_group: row.service_line }).eq('id', line.id);
    else if (billed) res = () => sb.from('plan_lines').insert({ unit_id: unit, fiscal_year: '2026/27', section: 'rev', line_group: row.service_line || 'Projects', name: row.name, uom: 'ETB', kind: 'value', val0: Array(12).fill(0), val: f.bill, project_id: r.data.id });
    else res = () => Promise.resolve({ error: null });
    if (await save(res, ['projects', 'plan_lines'], 'Project saved')) onClose();
  }
  return <Modal title={f.id ? 'Edit project' : 'New project'} onClose={onClose} wide>
    <div className="g2"><label className="f">Project / engagement<input type="text" value={f.name || ''} onChange={e => set('name', e.target.value)} /></label><label className="f">Client<input type="text" value={f.client || ''} onChange={e => set('client', e.target.value)} /></label></div>
    <div className="g4"><label className="f">Service line<input type="text" list="svc" value={f.service_line || ''} onChange={e => set('service_line', e.target.value)} /><datalist id="svc">{lines.map(l => <option key={l} value={l} />)}</datalist></label>
      <label className="f">Contract value (ETB)<NumIn value={f.contract_value} onChange={v => set('contract_value', v)} w={140} /></label>
      <label className="f">Phase<select value={f.phase} onChange={e => set('phase', e.target.value)}>{['Planned', 'Pipeline', 'Proposal', 'Contracted', 'Delivery', 'Closing', 'Closed'].map(x => <option key={x}>{x}</option>)}</select></label>
      <label className="f">Status<select value={f.status} onChange={e => set('status', e.target.value)}>{['Planned', 'Active', 'On hold', 'Completed', 'Lost'].map(x => <option key={x}>{x}</option>)}</select></label></div>
    <div className="g3"><label className="f">Start<input type="text" placeholder="YYYY-MM-DD" value={f.start_date || ''} onChange={e => set('start_date', e.target.value)} /></label><label className="f">End<input type="text" placeholder="YYYY-MM-DD" value={f.end_date || ''} onChange={e => set('end_date', e.target.value)} /></label><label className="f">Delivery progress (%)<NumIn value={f.progress_pct} onChange={v => set('progress_pct', v)} /></label></div>
    <div><h4>Billing milestones by month (ETB)</h4><div className="tw"><table className="t"><thead><tr>{MONTHS.map(m => <th key={m} className="n">{m}</th>)}<th className="n">Total</th></tr></thead><tbody><tr>
      {f.bill.map((v: number, i: number) => <td key={i} className="n"><NumIn value={v || null} w={84} onChange={nv => { const b = [...f.bill]; b[i] = nv || 0; set('bill', b); }} /></td>)}<td className="n">{money(sum(f.bill))}</td></tr></tbody></table></div>
      {f.contract_value && Math.abs(sum(f.bill) - f.contract_value) > 1 && <p className="note">Billing this year {money(sum(f.bill))} of contract {money(f.contract_value)} — the rest falls in other years.</p>}</div>
    <div className="row end">{f.id && <button className="btn danger" onClick={async () => { if (confirm('Delete this project and its billing plan?')) { if (line) await sb.from('plan_lines').delete().eq('id', line.id); if (await save(() => sb.from('projects').delete().eq('id', f.id), ['projects', 'plan_lines'], 'Deleted')) onClose(); } }}>Delete</button>}<span className="sp" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn pri" disabled={!f.name?.trim()} onClick={go}>Save</button></div>
  </Modal>;
}

function ProjectRevenue({ unit, editable }: { unit: string; editable: boolean }) {
  const { db } = useData(); const [pm, setPm] = useState<Row | null>(null); if (!db) return null;
  const projects = db.projects.filter(p => p.unit_id === unit).sort((a, b) => a.sort - b.sort);
  const bill = (p: Row) => { const l = db.plan_lines.find(x => x.project_id === p.id && x.section === 'rev'); return l ? lineVals(l) : null; };
  const last = lastActualMonth(db, unit);
  const svc = Array.from(new Set(projects.map(p => p.service_line || 'Other')));
  const pipeline = sum(projects.filter(p => ['Pipeline', 'Proposal'].includes(p.phase)).map(p => Number(p.contract_value) || 0));
  const contracted = sum(projects.filter(p => ['Contracted', 'Delivery', 'Closing'].includes(p.phase) && p.status !== 'Lost').map(p => Number(p.contract_value) || 0));
  const planYear = sum(projects.map(p => sum(bill(p) || [])));
  const ytdA = actualBy(db, unit, 'rev', Array.from({ length: last }, (_, i) => i + 1));
  return <>
    <div className="g4" style={{ marginBottom: 14 }}>
      <div className="tile"><div className="tv">{money(planYear)}</div><div className="tl">Billing planned this year</div></div>
      <div className="tile"><div className="tv">{money(contracted)}</div><div className="tl">Contract value — contracted & in delivery</div></div>
      <div className="tile"><div className="tv">{money(pipeline)}</div><div className="tl">Pipeline & proposals</div></div>
      <div className="tile"><div className="tv">{money(ytdA)}</div><div className="tl">Revenue actual to date</div><div className="ts">plan to date {money(sum(projects.map(p => sum((bill(p) || []).slice(0, last)))))}</div></div>
    </div>
    <div className="row" style={{ marginBottom: 8 }}><h2>Projects and engagements</h2><span className="sp" />{editable && <button className="btn pri" onClick={() => setPm({})}>+ Project</button>}</div>
    {svc.map(s => <div key={s} style={{ marginBottom: 14 }}><h4 style={{ margin: '6px 0' }}>{s}</h4><div className="tw"><table className="t">
      <thead><tr><th className="first">Project</th><th>Phase</th><th className="n">Contract</th>{MONTHS.map(m => <th key={m} className="n">{m}</th>)}<th className="n">This year</th></tr></thead>
      <tbody>{projects.filter(p => (p.service_line || 'Other') === s).map(p => { const b = bill(p); return <tr key={p.id} className={editable ? 'click' : ''} onClick={() => editable && setPm(p)}>
        <td className="first">{p.name}{p.client && <div className="note">{p.client}</div>}{p.note && <div className="note">{p.note}</div>}</td><td><Pill tone={p.phase === 'Delivery' || p.phase === 'Contracted' ? 'good' : 'none'}>{p.phase}</Pill></td>
        <td className="n">{money(Number(p.contract_value) || null)}</td>{(b || Array(12).fill(null)).map((v: number | null, i: number) => <td key={i} className="n">{v ? money(v) : ''}</td>)}<td className="n">{b ? money(sum(b)) : '—'}</td></tr>; })}
        <tr className="b"><td className="first">Actual billed ({s})</td><td /><td />{MONTHS.map((_, i) => <td key={i} className="n">{money(actualBy(db, unit, 'rev', [i + 1], [s]))}</td>)}<td className="n">{money(actualBy(db, unit, 'rev', Array.from({ length: 12 }, (_, i) => i + 1), [s]))}</td></tr>
      </tbody></table></div></div>)}
    {!projects.length && <Empty>No projects yet. Add the engagements this unit will bill this year.</Empty>}
    {pm && <ProjectModal unit={unit} init={pm} onClose={() => setPm(null)} />}
  </>;
}

const PLAN_HELP = <>
  <h3>The annual plan</h3><p>The plan comes from each unit's annual plan workbook: revenue, cost of sales, operating expenses, capital spending and projects, month by month. The <b>approved baseline</b> is kept unchanged; the <b>plan in force</b> is what the unit works to after any rescope. Cells that differ from the baseline are shaded; hover to see the baseline.</p>
  <h3>Product units and project units</h3><p>Product units such as Wagwago Electric plan revenue as <b>quantity × price</b> for each product line. Project units such as Niyat plan revenue <b>by project or engagement</b>: contract value, phase, and billing milestones by month — there is no quantity or unit price.</p>
  <h3>Plan against actual</h3><p>Actuals come from Finance (Power BI exports) by product group or budget line, monthly. Months with actuals are ticked. Achieved = actual ÷ plan to date (for costs, under plan reads as good).</p>
  <h3>Changing the plan</h3><p>While the plan is a draft, planners edit it here and submit it: Group Strategy approves first, then top management gives final approval. Once approved, changes go through a rescope so there is always a before and after.</p></>;

export function RevenuePlan() {
  const { db, unit } = useData(); const { editable, why } = useEditable(unit || ''); const [view, setView] = useState<'value' | 'qty' | 'pva'>('pva');
  if (!db || !unit) return null;
  const u = byId(db.org_units, unit)!;
  return <Page title="Revenue plan" desc={u.revenue_model === 'project' ? 'Projects and engagements, contract values and billing milestones.' : 'Quantity × price by product line, month by month, against actual.'} help={PLAN_HELP}>
    <Cmd right={u.revenue_model === 'product' ? <Seg value={view} options={[['pva', 'Plan vs actual'], ['qty', 'Quantity × price'], ['value', 'Amount']]} onChange={setView} /> : undefined} />
    <StatusBar unit={unit} kind="annual" label="Annual plan 2026/27" />
    {why && <div className="banner">{why}</div>}
    {u.revenue_model === 'project' ? <ProjectRevenue unit={unit} editable={editable} /> : u.revenue_model === 'none' ? <Empty>{u.name} is a function unit with no revenue plan. Its budget is under Plan → Budget.</Empty> : <PlanGrid unit={unit} sec="rev" view={view} editable={editable} />}
  </Page>;
}

export function BudgetPlan() {
  const { db, unit } = useData(); const { editable, why } = useEditable(unit || ''); const [sec, setSec] = useState('opex'); const [view, setView] = useState<'value' | 'pva'>('pva');
  if (!db || !unit) return null;
  const secs = (['cos', 'opex', 'capex', 'proj'] as const).filter(s => linesOf(db, unit, s).length);
  const cur = secs.includes(sec as any) ? sec : secs[0] || 'opex';
  return <Page title="Budget" desc="Cost of sales, operating expenses, capital spending and projects, against actual." help={PLAN_HELP}>
    <Cmd>{secs.length > 0 && <Seg value={cur} options={secs.map(s => [s, SECN[s]] as [string, string])} onChange={setSec} />}<Seg value={view} options={[['pva', 'Plan vs actual'], ['value', 'Plan']]} onChange={setView} /></Cmd>
    <StatusBar unit={unit} kind="annual" label="Annual plan 2026/27" />
    {why && <div className="banner">{why}</div>}
    {secs.length ? <PlanGrid unit={unit} sec={cur} view={view} editable={editable} /> : <Empty>No budget lines loaded for this unit.</Empty>}
    <p className="note">Costs are treated as budget: key results about saving cost link to these lines (OKR plan → key result → From the annual plan, Better when: Lower).</p>
  </Page>;
}
