import { useState } from 'react';
import { useData, useSave, byId, type DB, type Row } from '../lib/data';
import { sb } from '../lib/supabase';
import { krsOf, childObjectives, sum, fmt, linesOf } from '../lib/calc';
import { Page, Cmd, Modal, Pill, Empty, NumIn } from '../lib/ui';
import { unitGoalsTree, topObjectives, unlinked, ObjCard, KrDrawer } from './Goals';

export function orgOptions(db: DB, unit: string) {
  const out: { id: string; label: string; kind: string }[] = [];
  const walk = (id: string, d: number) => { const u = byId(db.org_units, id); if (!u) return; out.push({ id, label: '  '.repeat(d) + u.name, kind: u.kind }); db.org_units.filter(c => c.parent_id === id).sort((a, b) => a.sort - b.sort).forEach(c => walk(c.id, d + 1)); };
  walk(unit, 0); return out;
}
const kindToLevel = (k: string) => (k === 'unit' ? 'unit' : k === 'department' ? 'department' : 'division');
export function planStatus(db: DB, unit: string, kind: string, period = '') { return db.plan_status.find(s => s.unit_id === unit && s.plan_kind === kind && s.period === period); }

export function StatusBar({ unit, kind, label, period = '' }: { unit: string; kind: string; label: string; period?: string }) {
  const { db, can, user } = useData(); const save = useSave(); if (!db) return null;
  const st = planStatus(db, unit, kind, period); const s = st?.status || 'Draft';
  const set = (status: string, note?: string) => save(() => sb.from('plan_status').upsert({ unit_id: unit, fiscal_year: '2026/27', plan_kind: kind, period, status, note: note || null, by_user: user.id, at: new Date().toISOString() }), ['plan_status'], `${label} ${status.toLowerCase()}`);
  const tone = s === 'Approved' ? 'good' : s === 'Submitted' || s === 'Endorsed' ? 'info' : s === 'Returned' ? 'bad' : 'none';
  return <div className={'banner ' + (s === 'Approved' ? 'good' : s === 'Returned' ? 'bad' : '')}>
    <b>{label}</b><Pill tone={tone}>{s}</Pill>{st?.note && <span className="note">{st.note}</span>}<span className="sp" />
    {(s === 'Draft' || s === 'Returned') && (can('editOKR') || can('editPlan')) && <button className="btn sm pri" onClick={() => set('Submitted')}>Submit to Group Strategy</button>}
    {s === 'Submitted' && can('approve') && <><button className="btn sm pri" onClick={() => set(kind === 'annual' ? 'Endorsed' : 'Approved', kind === 'annual' ? 'Endorsed by Group Strategy — awaiting final approval by top management' : undefined)}>{kind === 'annual' ? 'Endorse' : 'Approve'}</button><button className="btn sm" onClick={() => { const n = prompt('What needs to change?'); if (n) set('Returned', n); }}>Return</button></>}
    {s === 'Endorsed' && can('finalApprove') && <><button className="btn sm pri" onClick={() => set('Approved', 'Final approval by top management')}>Final approval</button><button className="btn sm" onClick={() => { const n = prompt('What needs to change?'); if (n) set('Returned', n); }}>Return</button></>}
    {s === 'Approved' && can('approve') && <button className="btn sm" onClick={() => set('Draft', 'Reopened for changes')}>Reopen</button>}
  </div>;
}

function ObjModal({ unit, init, onClose }: { unit: string; init: Row; onClose: () => void }) {
  const { db } = useData(); const save = useSave();
  const [f, setF] = useState<Row>({ link: init.parent_kr_id ? 'kr' : init.parent_objective_id ? 'obj' : 'goal', ...init });
  if (!db) return null;
  const set = (k: string, v: any) => setF(x => ({ ...x, [k]: v }));
  const goals = db.unit_goals.filter(g => g.unit_id === unit);
  const goal = byId(db.unit_goals, f.unit_goal_id); const pillar = goal && byId(db.unit_pillars, goal.pillar_id);
  const objs = db.objectives.filter(o => o.unit_id === unit && o.id !== f.id);
  const krs = db.key_results.filter(k => objs.some(o => o.id === k.objective_id));
  const orgs = orgOptions(db, unit);
  const people = db.positions.filter(p => p.org_unit_id === f.org_unit_id || (p.unit_id === unit && p.level !== 'employee'));
  async function go() {
    const org = byId(db!.org_units, f.org_unit_id);
    const row: Row = { unit_id: unit, org_unit_id: f.org_unit_id, level: kindToLevel(org?.kind || 'unit'), text: f.text.trim(), owner_position_id: f.owner_position_id || null,
      unit_goal_id: f.link === 'goal' ? f.unit_goal_id || null : null, parent_objective_id: f.link === 'obj' ? f.parent_objective_id || null : null, parent_kr_id: f.link === 'kr' ? f.parent_kr_id || null : null,
      weight_to_parent: f.link === 'goal' ? null : f.weight_to_parent ?? null };
    const ok = await save(() => f.id ? sb.from('objectives').update(row).eq('id', f.id) : sb.from('objectives').insert({ ...row, status: 'Draft' }), ['objectives'], 'Objective saved');
    if (ok) onClose();
  }
  return <Modal title={f.id ? 'Edit objective' : 'New objective'} onClose={onClose}>
    <label className="f">This objective delivers
      <select value={f.link} onChange={e => set('link', e.target.value)}><option value="goal">A strategic goal (unit objective)</option><option value="obj">An objective above</option><option value="kr">A key result above</option></select></label>
    {f.link === 'goal' && <label className="f">Strategic goal
      <select value={f.unit_goal_id || ''} onChange={e => set('unit_goal_id', e.target.value)}><option value="">Choose…</option>{goals.map(g => <option key={g.id} value={g.id}>{g.code} {g.name}</option>)}</select>
      {pillar && <span className="note">Pillar: <b>{pillar.code} {pillar.name}</b> (set by the goal)</span>}</label>}
    {f.link === 'obj' && <label className="f">Objective above<select value={f.parent_objective_id || ''} onChange={e => set('parent_objective_id', e.target.value)}><option value="">Choose…</option>{objs.map(o => <option key={o.id} value={o.id}>{o.text.slice(0, 90)}</option>)}</select></label>}
    {f.link === 'kr' && <label className="f">Key result above<select value={f.parent_kr_id || ''} onChange={e => set('parent_kr_id', e.target.value)}><option value="">Choose…</option>{krs.map(k => <option key={k.id} value={k.id}>{k.title.slice(0, 90)}</option>)}</select></label>}
    <label className="f">Objective<textarea rows={2} value={f.text || ''} onChange={e => set('text', e.target.value)} placeholder="What we want to achieve, in plain words" /></label>
    <div className="g2"><label className="f">Owned by (organisation)<select value={f.org_unit_id || ''} onChange={e => set('org_unit_id', e.target.value)}>{orgs.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
      <label className="f">Owner<select value={f.owner_position_id || ''} onChange={e => set('owner_position_id', e.target.value)}><option value="">—</option>{people.map(p => <option key={p.id} value={p.id}>{(p.holder_name || 'Vacant') + ' · ' + p.title}</option>)}</select></label></div>
    {f.link !== 'goal' && <label className="f">Weight in what it delivers (%)<NumIn value={f.weight_to_parent} onChange={v => set('weight_to_parent', v)} /></label>}
    <div className="row end"><button className="btn" onClick={onClose}>Cancel</button><button className="btn pri" disabled={!f.text?.trim() || (f.link === 'goal' && !f.unit_goal_id)} onClick={go}>Save</button></div>
  </Modal>;
}

function KrModal({ unit, init, onClose }: { unit: string; init: Row; onClose: () => void }) {
  const { db } = useData(); const save = useSave();
  const link0 = db?.kr_plan_links.find(l => l.kr_id === init.id);
  const t0 = Object.fromEntries((db?.kr_targets || []).filter(t => t.kr_id === init.id).map(t => [t.quarter, Number(t.target)]));
  const [f, setF] = useState<Row>({ kr_type: 'cumulative', measure: 'manual', confidence: 'Medium', ...init, sec: link0?.section || 'rev', metric: link0?.metric || 'value', groups: link0?.line_groups || [], t: t0 });
  if (!db) return null;
  const set = (k: string, v: any) => setF(x => ({ ...x, [k]: v }));
  const grps = Array.from(new Set(linesOf(db, unit, f.sec).map(l => l.line_group || 'Other')));
  const obj = byId(db.objectives, f.objective_id);
  const people = db.positions.filter(p => p.unit_id === unit);
  async function go() {
    const row: Row = { objective_id: f.objective_id, title: f.title.trim(), uom: f.uom || null, kr_type: f.kr_type, lower_is_better: !!f.lower_is_better, weight: f.weight ?? null, owner_position_id: f.owner_position_id || null, measure: f.measure, baseline: f.baseline ?? null, year_target: f.year_target ?? null, confidence: f.confidence };
    const r = f.id ? await sb.from('key_results').update(row).eq('id', f.id).select('id').single() : await sb.from('key_results').insert(row).select('id').single();
    if (r.error) { alert(r.error.message); return; }
    const id = r.data.id;
    if (f.measure === 'plan') await sb.from('kr_plan_links').upsert({ kr_id: id, section: f.sec, metric: f.metric, line_groups: f.groups });
    else await sb.from('kr_plan_links').delete().eq('kr_id', id);
    const ts = [1, 2, 3, 4].filter(q => f.t[q] != null).map(q => ({ kr_id: id, quarter: q, target: f.t[q] }));
    await sb.from('kr_targets').delete().eq('kr_id', id);
    const ok = await save(() => ts.length ? sb.from('kr_targets').insert(ts) : Promise.resolve({ error: null }) as any, ['key_results', 'kr_plan_links', 'kr_targets'], 'Key result saved');
    if (ok) onClose();
  }
  return <Modal title={f.id ? 'Edit key result' : 'New key result'} onClose={onClose} wide>
    <p className="note">Objective: {obj?.text}</p>
    <label className="f">Key result<input type="text" value={f.title || ''} onChange={e => set('title', e.target.value)} placeholder="Measurable result, e.g. Transformers produced" /></label>
    <div className="g4">
      <label className="f">How it is measured<select value={f.measure} onChange={e => set('measure', e.target.value)}><option value="plan">From the annual plan</option><option value="deliverables">From deliverables</option><option value="children">From the objectives below</option><option value="manual">Checked in with evidence</option></select></label>
      <label className="f">Unit of measure<input type="text" value={f.uom || ''} onChange={e => set('uom', e.target.value)} /></label>
      <label className="f">Type<select value={f.kr_type} onChange={e => set('kr_type', e.target.value)}><option value="cumulative">Adds up over the year</option><option value="level">A level to reach</option><option value="milestone">Milestone (done / not done)</option></select></label>
      <label className="f">Better when<select value={f.lower_is_better ? '1' : ''} onChange={e => set('lower_is_better', !!e.target.value)}><option value="">Higher</option><option value="1">Lower</option></select></label>
    </div>
    {f.measure === 'plan' && <div className="card stack"><div className="g2">
      <label className="f">Plan section<select value={f.sec} onChange={e => { set('sec', e.target.value); set('groups', []); }}><option value="rev">Revenue</option><option value="cos">Cost of sales</option><option value="opex">Operating expenses</option><option value="capex">Capital spending</option><option value="proj">Projects</option></select></label>
      <label className="f">Figure<select value={f.metric} onChange={e => set('metric', e.target.value)}><option value="value">Amount (ETB)</option><option value="quantity">Quantity</option></select></label></div>
      <div><div className="note">Product groups / budget lines (none = all)</div><div className="chips">{grps.map(g => <button type="button" key={g} className={'chip' + (f.groups.includes(g) ? ' on' : '')} onClick={() => set('groups', f.groups.includes(g) ? f.groups.filter((x: string) => x !== g) : [...f.groups, g])}>{g}</button>)}</div></div>
      <p className="note">Targets and actuals come from the plan and Finance actuals; a cost-saving key result should be linked to the budget lines it saves on, with "Better when: Lower".</p></div>}
    {f.measure !== 'plan' && <div className="g4">
      <label className="f">Baseline<NumIn value={f.baseline} onChange={v => set('baseline', v)} /></label>
      <label className="f">Year target<NumIn value={f.year_target} onChange={v => set('year_target', v)} /></label>
      {[1, 2, 3, 4].map(q => <label key={q} className="f">Q{q} target<NumIn value={f.t[q]} onChange={v => set('t', { ...f.t, [q]: v })} /></label>)}</div>}
    <div className="g3"><label className="f">Weight in the objective (%)<NumIn value={f.weight} onChange={v => set('weight', v)} /></label>
      <label className="f">Owner<select value={f.owner_position_id || ''} onChange={e => set('owner_position_id', e.target.value)}><option value="">—</option>{people.map(p => <option key={p.id} value={p.id}>{(p.holder_name || 'Vacant') + ' · ' + p.title}</option>)}</select></label>
      <label className="f">Confidence<select value={f.confidence} onChange={e => set('confidence', e.target.value)}><option>High</option><option>Medium</option><option>Low</option></select></label></div>
    <div className="row end">{f.id && <button className="btn danger" onClick={async () => { if (confirm('Delete this key result?') && await save(() => sb.from('key_results').delete().eq('id', f.id), ['key_results', 'check_ins'], 'Deleted')) onClose(); }}>Delete</button>}<span className="sp" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn pri" disabled={!f.title?.trim()} onClick={go}>Save</button></div>
  </Modal>;
}

export default function OkrPlan() {
  const { db, unit } = useData(); const save = useSave();
  const [om, setOm] = useState<Row | null>(null); const [km, setKm] = useState<Row | null>(null); const [kr, setKr] = useState<string | null>(null);
  if (!db || !unit) return null;
  const tree = unitGoalsTree(db, unit); const loose = unlinked(db, unit);
  const unitOrg = unit;
  const krW = (oid: string) => sum(krsOf(db, oid).map(k => Number(k.weight) || 0));
  const kidW = (oid: string) => sum(childObjectives(db, oid).map(c => Number(c.weight_to_parent) || 0));
  const issues = db.objectives.filter(o => o.unit_id === unit && ((krsOf(db, o.id).length && Math.round(krW(o.id)) !== 100) || (childObjectives(db, o.id).length && Math.round(kidW(o.id)) !== 100)));
  const extra = (o: Row) => <div className="row">
    {krsOf(db, o.id).length > 0 && Math.round(krW(o.id)) !== 100 && <Pill tone="warn">KR weights {fmt(krW(o.id))}%</Pill>}
    {childObjectives(db, o.id).length > 0 && Math.round(kidW(o.id)) !== 100 && <Pill tone="warn">cascade {fmt(kidW(o.id))}%</Pill>}
    <button className="btn sm" onClick={() => setKm({ objective_id: o.id, owner_position_id: o.owner_position_id })}>+ Key result</button>
    <button className="btn sm" onClick={() => setOm({ unit_id: unit, org_unit_id: o.org_unit_id, parent_objective_id: o.id, owner_position_id: null })}>+ Below</button>
    <button className="btn sm" onClick={() => setOm(o)}>Edit</button>
    <button className="btn sm danger" onClick={() => { if (confirm('Delete this objective and its key results?')) save(() => sb.from('objectives').delete().eq('id', o.id), ['objectives', 'key_results'], 'Deleted'); }}>Delete</button>
  </div>;
  return <Page title="OKR plan" desc="Set the year's objectives from the strategic goals, cascade them, and weight them." help={<>
    <h3>How OKR planning works</h3><ol><li><b>Start from a strategic goal.</b> A unit objective always delivers one of the unit's own strategic goals; choosing the goal sets the pillar.</li>
      <li><b>Add key results</b> (2–5 per objective). Say how each is measured: from the annual plan (revenue, quantity or spending of chosen product groups or budget lines), from deliverables, from the objectives below, or checked in with evidence. Weights inside an objective add up to 100%.</li>
      <li><b>Cascade.</b> Use "+ Below" to give a department or division an objective that delivers the one above (or one of its key results). The weights of the objectives below one parent add up to 100% — this is cascade weighting.</li>
      <li><b>Submit.</b> The OKR plan goes to Group Strategy, who approve it or return it with a note.</li></ol>
    <p>Pills warn when weights do not add up to 100%. Click a key result to see its detail; use Edit on it there via its objective.</p>
    <p>Objectives brought over from the ERP keep their ERP status; review and link the ones listed under "Not linked to a goal yet".</p></>}>
    <Cmd right={<button className="btn pri" onClick={() => setOm({ unit_id: unit, org_unit_id: unitOrg, unit_goal_id: '', owner_position_id: null })}>+ Objective</button>} />
    <StatusBar unit={unit} kind="okr" label="OKR plan 2026/27" />
    {issues.length > 0 && <div className="banner warn">{issues.length} objective{issues.length > 1 ? 's have' : ' has'} weights that do not add up to 100%.</div>}
    {!tree.length && <Empty>No strategic goals for this unit yet. Group Strategy loads them from the unit strategy.</Empty>}
    {tree.map(({ p, goals }) => <section className="pil" key={p.id}><div className="pilh">{p.code} · {p.name}</div>
      {goals.map(g => <div className="goal" key={g.id}><div className="goalh">{g.code} {g.name}<button className="btn sm" onClick={() => setOm({ unit_id: unit, org_unit_id: unitOrg, unit_goal_id: g.id })}>+ Objective</button></div>
        {topObjectives(db, g.id).map(o => <ObjCard key={o.id} o={o} onKr={id => setKm(byId(db.key_results, id)!)} extra={extra} />)}</div>)}</section>)}
    {loose.length > 0 && <section className="pil"><div className="pilh" style={{ background: 'var(--warn)' }}>Not linked to a goal yet · {loose.length}</div>{loose.map(o => <ObjCard key={o.id} o={o} onKr={id => setKm(byId(db.key_results, id)!)} extra={extra} />)}</section>}
    {om && <ObjModal unit={unit} init={om} onClose={() => setOm(null)} />}
    {km && <KrModal unit={unit} init={km} onClose={() => setKm(null)} />}
    {kr && <KrDrawer id={kr} onClose={() => setKr(null)} />}
  </Page>;
}
