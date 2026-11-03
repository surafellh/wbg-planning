import { useMemo, useState } from 'react';
import { Sheet, useDraft, type Col } from '../lib/sheet';
import { SaveBar } from './work/Plan';
import { useData, useSave, byId, canEnterActuals, type DB, type Row } from '../lib/data';
import { sb } from '../lib/supabase';
import { MONTHS, lineVals, lineQty, linesOf, sum, money, fmt, actualBy, lastActualMonth, pct, lineActual, curMonth, krsOf } from '../lib/calc';
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

/** Key results measured from this part of the annual plan (a link with no groups covers the whole section). */
export function krLinksFor(db: DB, unit: string, sec: string, grp?: string) {
  return db.kr_plan_links.filter(l => l.section === sec && (!grp || !(l.line_groups || []).length || (l.line_groups as string[]).includes(grp)))
    .map(l => ({ l, k: byId(db.key_results, l.kr_id) })).filter(x => x.k && x.k.state !== 'dropped' && db.objectives.find(o => o.id === x.k!.objective_id)?.unit_id === unit);
}
function LinkKrModal({ unit, sec, grp, onClose }: { unit: string; sec: string; grp: string; onClose: () => void }) {
  const { db } = useData(); const save = useSave(); const [kr, setKr] = useState(''); const [metric, setMetric] = useState<'value' | 'quantity'>('value'); if (!db) return null;
  const objs = db.objectives.filter(o => o.unit_id === unit && o.status !== 'Archived' && o.level !== 'individual');
  const linked = krLinksFor(db, unit, sec, grp);
  async function go() {
    const k = byId(db!.key_results, kr); if (!k) return; const ex = db!.kr_plan_links.find(l => l.kr_id === kr);
    const groups = ex && ex.section === sec ? Array.from(new Set([...(ex.line_groups || []), grp])) : [grp];
    const ok = await save(async () => { const a = await sb.from('kr_plan_links').upsert({ kr_id: kr, section: sec, metric: ex && ex.section === sec ? ex.metric : metric, line_groups: groups }); if (a.error) return a; return sb.from('key_results').update({ measure: 'plan' }).eq('id', kr); }, ['kr_plan_links', 'key_results'], 'Linked — the key result now moves with this plan line');
    if (ok) onClose();
  }
  async function unlink(krId: string) { const ex = db!.kr_plan_links.find(l => l.kr_id === krId); if (!ex) return; const rest = (ex.line_groups || []).filter((g: string) => g !== grp);
    await save(() => rest.length ? sb.from('kr_plan_links').update({ line_groups: rest }).eq('kr_id', krId) : sb.from('kr_plan_links').delete().eq('kr_id', krId), ['kr_plan_links'], 'Unlinked'); }
  return <Modal title={`Link “${grp}” to a key result`} onClose={onClose}>
    <p className="note">The key result is then measured straight from this plan group: its target is the plan for the period and its actual is what Finance records. Several groups can feed one key result.</p>
    {linked.length > 0 && <div className="banner">Already feeds: {linked.map(({ k, l }) => <span key={k!.id} className="row" style={{ gap: 6 }}><b>{k!.title}</b> <span className="note">({(l.line_groups || []).length ? (l.line_groups as string[]).join(', ') : 'whole section'})</span>{(l.line_groups || []).length > 0 && <button className="btn sm" onClick={() => unlink(k!.id)}>Unlink</button>}</span>)}</div>}
    <label className="f">Key result<select value={kr} onChange={e => setKr(e.target.value)}><option value="">Choose…</option>{objs.map(o => <optgroup key={o.id} label={o.text.slice(0, 90)}>{krsOf(db, o.id).map(k => <option key={k.id} value={k.id}>{k.title.slice(0, 120)}{k.measure === 'plan' ? ' (already from the plan)' : ''}</option>)}</optgroup>)}</select></label>
    {sec === 'rev' && <label className="f">Measure<Seg value={metric} options={[['value', 'Amount (ETB)'], ['quantity', 'Quantity']]} onChange={setMetric} /></label>}
    <div className="row end"><button className="btn" onClick={onClose}>Cancel</button><button className="btn pri" disabled={!kr} onClick={go}>Link</button></div></Modal>;
}
/** Record Finance actuals line by line, month by month. */
function ActualsEntry({ unit, sec }: { unit: string; sec: string }) {
  const { db } = useData(); const save = useSave(); const [qty, setQty] = useState(false); const [flt, setFlt] = useState(''); if (!db) return null;
  const cm = curMonth(); const months = Array.from({ length: cm }, (_, i) => i + 1);
  const lines = linesOf(db, unit, sec).filter(l => !flt || (l.name + ' ' + (l.line_group || '')).toLowerCase().includes(flt.toLowerCase())).sort((a, b) => (a.line_group || '').localeCompare(b.line_group || '') || a.sort - b.sort);
  const f = qty ? 'qty' : 'value';
  async function put(l: Row, m: number, v: number | null) {
    const ex = db!.actuals.find(a => a.line_id === l.id && a.month === m);
    await save(() => { if (ex) { const other = f === 'qty' ? ex.value : ex.qty; return v == null && other == null ? sb.from('actuals').delete().eq('id', ex.id) : sb.from('actuals').update({ [f]: v, source: 'Entered in the app' }).eq('id', ex.id); }
      return v == null ? Promise.resolve({ error: null }) as any : sb.from('actuals').insert({ unit_id: unit, fiscal_year: '2026/27', section: sec, line_group: l.line_group, line_id: l.id, month: m, [f]: v, source: 'Entered in the app' }); }, ['actuals']);
  }
  const groupOnly = (g: string, m: number) => db.actuals.find(a => a.unit_id === unit && a.section === sec && a.line_group === g && a.month === m && !a.line_id);
  return <>
    <div className="row" style={{ marginBottom: 8 }}><input type="text" placeholder="Filter lines" value={flt} onChange={e => setFlt(e.target.value)} />{sec === 'rev' && <Seg value={qty ? 'q' : 'v'} options={[['v', 'Amount (ETB)'], ['q', 'Quantity']]} onChange={v => setQty(v === 'q')} />}<span className="sp" /><span className="note">Type a figure and leave the box — it saves. Months up to {MONTHS[cm - 1]}.</span></div>
    <div className="banner">Actuals are recorded per line. Where Finance gave only a group total for a month (shown in the group row), entering any line of that group for that month replaces the group total with the sum of the lines.</div>
    <div className="tw"><table className="t"><thead><tr><th className="first">Group / line</th>{months.map(m => <th key={m} className="n">{MONTHS[m - 1]}</th>)}<th className="n">To date</th><th className="n">Plan to date</th></tr></thead><tbody>
      {groupsOf(lines).map(([g, ls]) => [<tr key={g} className="g"><td className="first">{g}</td>{months.map(m => { const go = groupOnly(g, m); const la = ls.some(l => db.actuals.some(a => a.line_id === l.id && a.month === m)); return <td key={m} className="n mini">{la ? money(sum(ls.map(l => lineActual(db, l.id, [m], qty ? 'quantity' : 'value') || 0))) : go && !qty ? <span data-tip="Group total from Finance — not split by line">{money(go.value)} total</span> : ''}</td>; })}<td className="n">{money(actualBy(db, unit, sec, months, [g], qty ? 'quantity' : 'value'))}</td><td className="n">{qty ? fmt(sum(ls.flatMap(l => lineQty(l).slice(0, cm))), 0) : money(sum(ls.flatMap(l => lineVals(l).slice(0, cm))))}</td></tr>,
        ...ls.map(l => <tr key={l.id}><td className="first ind">{l.name}{qty && l.uom ? <span className="note"> · {l.uom}</span> : ''}</td>{months.map(m => { const ex = db.actuals.find(a => a.line_id === l.id && a.month === m); return <td key={m} className="n"><NumIn w={78} value={ex ? ex[f] : null} onChange={v => put(l, m, v)} /></td>; })}
          <td className="n">{qty ? fmt(lineActual(db, l.id, months, 'quantity'), 0) : money(lineActual(db, l.id, months))}</td><td className="n">{qty ? fmt(sum(lineQty(l).slice(0, cm)), 0) : money(sum(lineVals(l).slice(0, cm)))}</td></tr>)])}
    </tbody></table></div></>;
}

function PlanGrid({ unit, sec, view, editable }: { unit: string; sec: string; view: 'value' | 'qty' | 'pva'; editable: boolean }) {
  const { db, can } = useData(); const [open, setOpen] = useState<Record<string, boolean>>({}); const [flt, setFlt] = useState(''); const [add, setAdd] = useState(false); const [edit, setEdit] = useState(false); const [lk, setLk] = useState<string | null>(null);
  if (!db) return null;
  const all = linesOf(db, unit, sec).sort((a, b) => (a.line_group || '').localeCompare(b.line_group || '') || a.sort - b.sort);
  const lines = all.filter(l => !flt || (l.name + ' ' + (l.line_group || '') + ' ' + (l.code || '')).toLowerCase().includes(flt.toLowerCase()));
  const cost = sec !== 'rev';
  const tools = <div className="row" style={{ marginBottom: 8 }}><input type="text" placeholder="Filter lines" value={flt} onChange={e => setFlt(e.target.value)} />
    {!edit && <button className="btn sm" onClick={() => { const g: Record<string, boolean> = {}; groupsOf(lines).forEach(([k]) => { g[k] = true; }); setOpen(Object.keys(open).length ? {} : g); }}>{Object.keys(open).length ? 'Collapse all' : 'Expand all'}</button>}
    <span className="sp" /><span className="note">{lines.length} of {all.length} lines</span>
    {editable && !edit && <button className="btn sm pri" onClick={() => setEdit(true)}>Edit plan</button>}{editable && edit && <button className="btn sm" onClick={() => setAdd(true)}>+ Line</button>}</div>;
  if (!all.length) return <>{editable && <button className="btn pri" onClick={() => setAdd(true)}>+ Line</button>}<Empty>No {SECN[sec].toLowerCase()} lines in this unit's plan.</Empty>{add && <LineModal unit={unit} sec={sec} onClose={() => setAdd(false)} />}</>;
  if (edit) return <>{tools}{add && <LineModal unit={unit} sec={sec} onClose={() => setAdd(false)} />}<PlanSheet lines={lines} qtyMode={view === 'qty'} onDone={() => setEdit(false)} /></>;
  const last = lastActualMonth(db, unit);
  const grand = Array.from({ length: 12 }, (_, i) => sum(lines.map(l => lineVals(l)[i])));
  const used = (a: number | null, p: number) => a == null || !p ? null : a / p;
  const grps = groupsOf(all).map(([g]) => g); const fed = grps.filter(g => krLinksFor(db, unit, sec, g).length);
  const KrChip = ({ g }: { g: string }) => { const ks = krLinksFor(db, unit, sec, g); return <span className="krchips" onClick={e => e.stopPropagation()}>{ks.map(({ k }) => <span key={k!.id} className="krchip" data-tip={'Feeds the key result: ' + k!.title}>₿ {k!.title.length > 38 ? k!.title.slice(0, 38) + '…' : k!.title}</span>)}{can('editOKR') && <button className="btn xs" onClick={() => setLk(g)} data-tip="Link this group to a key result so the OKR moves with the plan and Finance actuals">{ks.length ? '±' : '+ KR'}</button>}</span>; };
  return <>{tools}<div className={'banner' + (fed.length ? '' : ' warn')} style={{ marginBottom: 8 }}><b>Plan → OKR</b> {fed.length} of {grps.length} {sec === 'rev' ? 'product groups' : 'budget groups'} feed a key result.{fed.length < grps.length && can('editOKR') ? ' Use “+ KR” on a group to link it.' : ''}</div>{lk && <LinkKrModal unit={unit} sec={sec} grp={lk} onClose={() => setLk(null)} />}{add && <LineModal unit={unit} sec={sec} onClose={() => setAdd(false)} />}<div className="tw"><table className="t">
    <thead><tr><th className="first">{view === 'pva' ? 'Group / line' : 'Line'}</th>{view === 'qty' && <th className="n">Price</th>}{MONTHS.map((m, i) => <th key={m} className="n" data-tip={view === 'pva' && i < last ? 'Finance actuals are in for this month' : undefined}>{m}{view === 'pva' && i < last ? ' ✓' : ''}</th>)}<th className="n">Year</th>
      {view === 'pva' && <><th className="n">To date plan</th><th className="n">To date actual</th><th data-tip={cost ? 'Used = actual ÷ budget to date. Over 100% means overspent.' : 'Achieved = actual ÷ plan to date.'}>{cost ? 'Used' : 'Achieved'}</th></>}</tr></thead>
    <tbody>
      {groupsOf(lines).map(([g, ls]) => {
        const gv = Array.from({ length: 12 }, (_, i) => sum(ls.map(l => lineVals(l)[i])));
        const ytdP = sum(gv.slice(0, last)); const ytdA = actualBy(db, unit, sec, Array.from({ length: last }, (_, i) => i + 1), [g]); const r = used(ytdA, ytdP);
        const acts = Array.from({ length: 12 }, (_, i) => actualBy(db, unit, sec, [i + 1], [g]));
        return [<tr key={g} className="g click" onClick={() => setOpen({ ...open, [g]: !open[g] })}><td className="first">{open[g] ? '▾' : '▸'} {g} <span className="note">({ls.length})</span><KrChip g={g} /></td>{view === 'qty' && <td />}
          {gv.map((v, i) => <td key={i} className="n">{view === 'qty' ? '' : money(v)}{view === 'pva' && acts[i] != null && <div className="mini" style={{ color: (cost ? (acts[i] || 0) > v : (acts[i] || 0) < v) ? 'var(--bad)' : 'var(--good)' }}>{money(acts[i])}</div>}</td>)}
          <td className="n">{money(sum(gv))}</td>{view === 'pva' && <><td className="n">{money(ytdP)}</td><td className="n">{money(ytdA)}</td><td><Bar p={r == null ? null : cost ? Math.min(1, r) : r} tone={r == null ? undefined : cost ? (r > 1 ? 'bad' : 'good') : undefined} /> <span className="note">{pct(r)}</span></td></>}</tr>,
          ...(open[g] ? ls.map(l => { const v = view === 'qty' ? lineQty(l) : lineVals(l); const base = view === 'qty' ? lineQty(l, true) : lineVals(l, true);
            return <tr key={l.id}><td className="first ind" title={l.code || ''}>{l.name}{l.uom && view === 'qty' ? <span className="note"> · {l.uom}</span> : ''}</td>
              {view === 'qty' && <td className="n">{fmt(Number(l.price))}</td>}
              {v.map((x, i) => { const la = view === 'pva' ? lineActual(db, l.id, [i + 1]) : null; return <td key={i} className="n" data-tip={base[i] !== x ? `Baseline ${fmt(base[i], 2)}` : undefined} style={base[i] !== x ? { background: 'var(--info-soft)' } : undefined}>{view === 'qty' ? fmt(x, 2) : money(x)}{la != null && <div className="mini" style={{ color: (cost ? la > x : la < x) ? 'var(--bad)' : 'var(--good)' }}>{money(la)}</div>}</td>; })}
              <td className="n">{view === 'qty' ? fmt(sum(v), 2) : money(sum(v))}</td>{view === 'pva' && (() => { const lp = sum(v.slice(0, last)); const la = lineActual(db, l.id, Array.from({ length: last }, (_, i) => i + 1)); const r = used(la, lp);
                return la == null ? <td colSpan={3} className="mini">{acts.some(a => a != null) ? 'group total only' : ''}</td> : <><td className="n">{money(lp)}</td><td className="n">{money(la)}</td><td><Bar p={r == null ? null : cost ? Math.min(1, r) : r} tone={r == null ? undefined : cost ? (r > 1 ? 'bad' : 'good') : undefined} /> <span className="note">{pct(r)}</span></td></>; })()}</tr>; }) : [])];
      })}
      <tr className="b"><td className="first">Total {SECN[sec].toLowerCase()}</td>{view === 'qty' && <td />}{grand.map((v, i) => { const a = actualBy(db, unit, sec, [i + 1]); return <td key={i} className="n">{view === 'qty' ? '' : money(v)}{view === 'pva' && a != null && <div className="mini">{money(a)}</div>}</td>; })}<td className="n">{money(sum(grand))}</td>{view === 'pva' && (() => { const p = sum(grand.slice(0, last)); const a = actualBy(db, unit, sec, Array.from({ length: last }, (_, i) => i + 1)); return <><td className="n">{money(p)}</td><td className="n">{money(a)}</td><td>{pct(used(a, p))}</td></>; })()}</tr>
    </tbody></table></div><p className="note">Shaded cells differ from the approved baseline (hover for the baseline). {view === 'pva' ? 'Small figures under the plan are Finance actuals.' : ''}</p></>;
}

/** Edit the plan like a spreadsheet: change months, quantities and prices, then Save. */
function PlanSheet({ lines, qtyMode, onDone }: { lines: Row[]; qtyMode: boolean; onDone: () => void }) {
  const save = useSave(); const [busy, setBusy] = useState(false);
  const source = useMemo(() => lines.map(l => { const isQ = qtyMode && l.kind === 'qty'; const v = isQ ? lineQty(l) : lineVals(l); const r: Row = { id: l.id, grp: l.line_group, name: l.name, price: l.price, kind: l.kind, isQ }; v.forEach((x, i) => { r['m' + (i + 1)] = Math.round(x * 100) / 100; }); return r; }), [lines, qtyMode]);
  const d = useDraft(source, [source]);
  const cols: Col[] = [{ key: 'grp', label: 'Group', type: 'ro', width: 150 }, { key: 'name', label: 'Line', type: 'text', width: 220 }, ...(qtyMode ? [{ key: 'price', label: 'Price', type: 'number' as const, width: 100, editable: (r: Row) => r.kind === 'qty' }] : []),
    ...MONTHS.map((m, i) => ({ key: 'm' + (i + 1), label: m, type: 'number' as const, width: qtyMode ? 70 : 100, editable: (r: Row) => qtyMode ? r.kind === 'qty' : r.kind === 'value' })), { key: 'yr', label: 'Year', type: 'ro', width: 110, fmt: (_: any, r: Row) => qtyMode ? fmt(sum(Array.from({ length: 12 }, (_, i) => r['m' + (i + 1)])), 2) : money(sum(Array.from({ length: 12 }, (_, i) => r['m' + (i + 1)]))) }];
  async function doSave() {
    setBusy(true); let err: string | null = null;
    for (const r of d.all.filter(r => r._dirty)) { const arr = Array.from({ length: 12 }, (_, i) => Number(r['m' + (i + 1)]) || 0);
      const patch: Row = { name: r.name }; if (r.isQ) { patch.qty = arr; patch.price = r.price; patch.val = arr.map(q => q * Number(r.price || 0)); } else if (!qtyMode || r.kind === 'value') patch.val = arr; if (qtyMode && r.kind === 'qty' && r.price !== source.find(x => x.id === r.id)?.price) patch.val = arr.map(q => q * Number(r.price || 0));
      const x = await sb.from('plan_lines').update(patch).eq('id', r.id); err = err || x.error?.message || null; }
    if (await save(() => Promise.resolve({ error: err }) as any, ['plan_lines'], 'Plan saved')) onDone(); setBusy(false);
  }
  return <><Sheet cols={cols} rows={d.rows} onChange={d.change} footer={<button className="btn sm" onClick={() => { d.reset(); onDone(); }}>Close editing</button>} />
    <p className="note">{qtyMode ? 'Quantity lines: change quantities and the unit price; amounts follow. Amount-only lines are edited in the Amount view.' : 'Amount lines are edited here; quantity lines in the Quantity × price view.'}</p>
    <SaveBar dirty={d.dirty} onSave={doSave} onDiscard={d.reset} busy={busy} /></>;
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
function ProjectModal({ unit, init, onClose, readOnly }: { unit: string; init: Row; onClose: () => void; readOnly?: boolean }) {
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
    <div className="row end">{f.id && <button className="btn danger" onClick={async () => { if (confirm('Delete this project and its billing plan?')) { if (line) await sb.from('plan_lines').delete().eq('id', line.id); if (await save(() => sb.from('projects').delete().eq('id', f.id), ['projects', 'plan_lines'], 'Deleted')) onClose(); } }}>Delete</button>}<span className="sp" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn pri" disabled={!f.name?.trim() || readOnly} onClick={go}>Save</button></div>
  </Modal>;
}

function ProjectRevenue({ unit, editable }: { unit: string; editable: boolean }) {
  const { db } = useData(); const [pm, setPm] = useState<Row | null>(null); const [kind, setKind] = useState<'all' | 'bill' | 'del'>('all'); const [q, setQ] = useState(''); if (!db) return null;
  const billLine = (p: Row) => db.plan_lines.find(x => x.project_id === p.id && x.section === 'rev');
  const bill = (p: Row) => { const l = billLine(p); return l ? lineVals(l) : null; };
  const all = db.projects.filter(p => p.unit_id === unit).sort((a, b) => a.sort - b.sort);
  const isBill = (p: Row) => !!bill(p) || Number(p.contract_value) > 0;
  const projects = all.filter(p => (kind === 'all' || (kind === 'bill' ? isBill(p) : !isBill(p))) && (!q || (p.name + ' ' + (p.client || '') + ' ' + (p.service_line || '')).toLowerCase().includes(q.toLowerCase())));
  const last = lastActualMonth(db, unit);
  const pipeline = sum(all.filter(p => ['Pipeline', 'Proposal'].includes(p.phase)).map(p => Number(p.contract_value) || 0));
  const contracted = sum(all.filter(p => ['Contracted', 'Delivery', 'Closing'].includes(p.phase) && p.status !== 'Lost').map(p => Number(p.contract_value) || 0));
  const planned = sum(all.filter(p => p.phase === 'Planned').map(p => Number(p.contract_value) || 0));
  const planYear = sum(all.map(p => sum(bill(p) || [])));
  const ytdA = actualBy(db, unit, 'rev', Array.from({ length: last }, (_, i) => i + 1));
  const svcs = Array.from(new Set(linesOf(db, unit, 'rev').map(l => l.line_group || 'Other')));
  return <>
    <div className="kpis">
      <div className="tile" data-tip="Sum of the monthly billing milestones of all projects for this year."><div className="tv">{money(planYear)}</div><div className="tl">Billing planned this year</div></div>
      <div className="tile" data-tip="Contract value of projects in the Contracted, Delivery or Closing phase. Set a project's phase and contract value by opening it."><div className="tv">{money(contracted)}</div><div className="tl">Contracted & in delivery</div></div>
      <div className="tile" data-tip="Contract value of projects in the Pipeline or Proposal phase — opportunities not yet signed."><div className="tv">{money(pipeline)}</div><div className="tl">Pipeline & proposals</div></div>
      <div className="tile" data-tip="Planned engagement streams from the annual plan workbook that are not yet signed projects."><div className="tv">{money(planned)}</div><div className="tl">Planned streams (workbook)</div></div>
      <div className="tile"><div className="tv">{money(ytdA)}</div><div className="tl">Revenue actual to date</div><div className="ts">plan to date {money(sum(all.map(p => sum((bill(p) || []).slice(0, last)))))}</div></div>
    </div>
    <div className="row" style={{ marginBottom: 8 }}><h2 style={{ flex: 1 }}>Projects and engagements</h2><input type="text" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} /><Seg value={kind} options={[['all', 'All'], ['bill', 'Billing (with value)'], ['del', 'Delivery register']]} onChange={setKind} />{editable && <button className="btn pri" onClick={() => setPm({})}>+ Project</button>}</div>
    <p className="note" style={{ marginBottom: 8 }}>Small figures under a project's billing are its actuals (recorded per project in “Enter actuals”). One list: <b>billing</b> projects carry a contract value and monthly billing milestones (they make the revenue plan); the <b>delivery register</b> lists projects being delivered that have no billing set yet. Open any project to set its phase, contract value and billing. Move a project from Pipeline → Proposal → Contracted → Delivery as it progresses; the cards follow.</p>
    <div className="tw"><table className="t">
      <thead><tr><th className="first">Project</th><th>Service line</th><th>Kind</th><th>Phase</th><th className="n">Contract</th>{MONTHS.map(m => <th key={m} className="n">{m}</th>)}<th className="n">This year</th></tr></thead>
      <tbody>{projects.map(p => { const b = bill(p); return <tr key={p.id} className="click" onClick={() => setPm(p)}>
        <td className="first">{p.name}{p.client && <div className="note">{p.client}</div>}</td><td className="mini">{p.service_line}</td><td>{isBill(p) ? <Pill tone="info">Billing</Pill> : <Pill>Delivery</Pill>}</td><td><Pill tone={p.phase === 'Delivery' || p.phase === 'Contracted' ? 'good' : 'none'}>{p.phase}</Pill></td>
        <td className="n">{money(Number(p.contract_value) || null)}</td>{(b || Array(12).fill(null)).map((v: number | null, i: number) => { const bl = billLine(p); const a = bl ? lineActual(db, bl.id, [i + 1]) : null; return <td key={i} className="n">{v ? money(v) : ''}{a != null && <div className="mini" style={{ color: a < (v || 0) ? 'var(--bad)' : 'var(--good)' }}>{money(a)}</div>}</td>; })}<td className="n">{b ? money(sum(b)) : '—'}{(() => { const bl = billLine(p); const a = bl ? lineActual(db, bl.id, Array.from({ length: 12 }, (_, i) => i + 1)) : null; return a != null ? <div className="mini">{money(a)} actual</div> : null; })()}</td></tr>; })}
        {svcs.filter(sv => db.actuals.some(a => a.unit_id === unit && a.section === 'rev' && a.line_group === sv)).map(sv => <tr key={sv} className="g"><td className="first">Actual billed · {sv}</td><td colSpan={4} className="mini">service-line total (projects + any total Finance gave without a project split)</td>{MONTHS.map((_, i) => <td key={i} className="n">{money(actualBy(db, unit, 'rev', [i + 1], [sv]))}</td>)}<td className="n">{money(actualBy(db, unit, 'rev', Array.from({ length: 12 }, (_, i) => i + 1), [sv]))}</td></tr>)}
      </tbody></table></div>
    {!all.length && <Empty>No projects yet. Add the engagements this unit will bill this year.</Empty>}
    {pm && <ProjectModal unit={unit} init={pm} onClose={() => setPm(null)} readOnly={!editable} />}
  </>;
}

const PLAN_HELP = <>
  <h3>The annual plan</h3><p>The plan comes from each unit's annual plan workbook: revenue, cost of sales, operating expenses, capital spending and projects, month by month. The <b>approved baseline</b> is kept unchanged; the <b>plan in force</b> is what the unit works to after any rescope. Cells that differ from the baseline are shaded; hover to see the baseline.</p>
  <h3>Product units and project units</h3><p>Product units such as Wagwago Electric plan revenue as <b>quantity × price</b> for each product line. Project units such as Niyat plan revenue <b>by project or engagement</b>: contract value, phase, and billing milestones by month — there is no quantity or unit price.</p>
  <h3>Plan against actual</h3><p>Actuals come from Finance (Power BI exports) by product group or budget line, monthly. Months with actuals are ticked. Achieved = actual ÷ plan to date (for costs, under plan reads as good).</p>
  <h3>Changing the plan</h3><p>While the plan is a draft, planners edit it here and submit it: Group Strategy approves first, then top management gives final approval. Once approved, changes go through a rescope so there is always a before and after.</p></>;

export function RevenuePlan() {
  const { db, unit, me, role } = useData(); const { editable, why } = useEditable(unit || ''); const [view, setView] = useState<'value' | 'qty' | 'pva' | 'act'>('pva');
  if (!db || !unit) return null;
  const u = byId(db.org_units, unit)!; const canAct = canEnterActuals(db, me, role);
  const opts: [string, string][] = u.revenue_model === 'product' ? [['pva', 'Plan vs actual'], ['qty', 'Quantity × price'], ['value', 'Amount']] : [['pva', 'Projects']]; if (canAct && linesOf(db, unit, 'rev').length) opts.push(['act', 'Enter actuals']);
  return <Page title="Revenue plan" desc={u.revenue_model === 'project' ? 'Projects and engagements, contract values and billing milestones.' : 'Quantity × price by product line, month by month, against actual.'} help={PLAN_HELP}>
    <Cmd right={opts.length > 1 ? <Seg value={view} options={opts} onChange={v => setView(v as any)} /> : undefined} />
    <StatusBar unit={unit} kind="annual" label="Annual plan 2026/27" />
    {why && <div className="banner">{why}</div>}
    {view === 'act' ? <ActualsEntry unit={unit} sec="rev" /> : u.revenue_model === 'project' ? <ProjectRevenue unit={unit} editable={editable} /> : u.revenue_model === 'none' ? <Empty>{u.name} is a function unit with no revenue plan. Its budget is under Plan → Budget.</Empty> : <PlanGrid unit={unit} sec="rev" view={view as any} editable={editable} />}
  </Page>;
}

export function BudgetPlan() {
  const { db, unit, me, role } = useData(); const { editable, why } = useEditable(unit || ''); const [sec, setSec] = useState('opex'); const [view, setView] = useState<'value' | 'pva' | 'act'>('pva');
  if (!db || !unit) return null;
  const secs = (['cos', 'opex', 'capex', 'proj'] as const).filter(s => linesOf(db, unit, s).length);
  const cur = secs.includes(sec as any) ? sec : secs[0] || 'opex';
  return <Page title="Budget" desc="Cost of sales, operating expenses, capital spending and projects, against actual." help={PLAN_HELP}>
    <Cmd>{secs.length > 0 && <Seg value={cur} options={secs.map(s => [s, SECN[s]] as [string, string])} onChange={setSec} />}<Seg value={view} options={[['pva', 'Plan vs actual'], ['value', 'Plan'], ...(canEnterActuals(db, me, role) ? [['act', 'Enter actuals'] as [string, string]] : [])]} onChange={v => setView(v as any)} /></Cmd>
    <StatusBar unit={unit} kind="annual" label="Annual plan 2026/27" />
    {why && <div className="banner">{why}</div>}
    {secs.length ? (view === 'act' ? <ActualsEntry unit={unit} sec={cur} /> : <PlanGrid unit={unit} sec={cur} view={view} editable={editable} />) : <Empty>No budget lines loaded for this unit.</Empty>}
    <p className="note">Costs are treated as budget: key results about saving cost link to these lines (OKR plan → key result → From the annual plan, Better when: Lower).</p>
  </Page>;
}
