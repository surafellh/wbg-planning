import { useState } from 'react';
import { useData, useSave, byId, type DB, type Row } from '../lib/data';
import { sb } from '../lib/supabase';
import { krsOf, childObjectives, sum, fmt, pct, linesOf, MONTHS, AGG_NAME, DIR_NAME, subtreeIds, ownShare, objScore, liveObj, type Period } from '../lib/calc';
import { Page, Cmd, Modal, Pill, Empty, NumIn, Seg, PeriodPicker, usePeriod, OrgFilter } from '../lib/ui';
import { Link } from 'react-router-dom';
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

function ObjModal({ unit, init, onClose, parentOrg }: { unit: string; init: Row; onClose: () => void; parentOrg?: string | null }) {
  const { db } = useData(); const save = useSave();
  const [f, setF] = useState<Row>({ link: init.parent_kr_id ? 'kr' : init.parent_objective_id ? 'obj' : 'goal', ...init });
  if (!db) return null;
  const set = (k: string, v: any) => setF(x => ({ ...x, [k]: v }));
  const goals = db.unit_goals.filter(g => g.unit_id === unit);
  const goal = byId(db.unit_goals, f.unit_goal_id); const pillar = goal && byId(db.unit_pillars, goal.pillar_id);
  // a department or division head links to the objectives of the organisation directly above them
  const objs = db.objectives.filter(o => o.unit_id === unit && o.id !== f.id && liveObj(o) && o.level !== 'individual' && (!parentOrg || o.org_unit_id === parentOrg || o.id === init.parent_objective_id));
  const krs = db.key_results.filter(k => objs.some(o => o.id === k.objective_id));
  const orgs = orgOptions(db, unit);
  const people = db.positions.filter(p => p.org_unit_id === f.org_unit_id || (p.unit_id === unit && p.level !== 'employee'));
  async function go() {
    const org = byId(db!.org_units, f.org_unit_id);
    const row: Row = { unit_id: unit, org_unit_id: f.org_unit_id, level: kindToLevel(org?.kind || 'unit'), text: f.text.trim(), owner_position_id: f.owner_position_id || null,
      unit_goal_id: f.link === 'goal' ? f.unit_goal_id || null : null, parent_objective_id: f.link === 'obj' ? f.parent_objective_id || null : null, parent_kr_id: f.link === 'kr' ? f.parent_kr_id || null : null,
      weight_to_parent: f.link === 'goal' ? null : f.weight_to_parent ?? null, own_weight: f.own_weight ?? null };
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
    <div className="g2">{f.link !== 'goal' && <label className="f" data-tip="Its share in the objective above. The objectives under one parent add up to 100% — at every level (unit → departments, department → divisions).">Weight in what it delivers (%)<NumIn value={f.weight_to_parent} onChange={v => set('weight_to_parent', v)} /></label>}
      <label className="f" data-tip="When this objective has its own key results AND objectives below it, its score = own share × its key results + the rest × the objectives below. Set it for this objective; empty uses the level default from Studio → Configuration.">Share from its own key results (%)<NumIn value={f.own_weight} onChange={v => set('own_weight', v)} /><span className="mini">Objectives below get {100 - (f.own_weight ?? ownShare(db, { level: kindToLevel(byId(db.org_units, f.org_unit_id)?.kind || 'unit') }))}%{f.own_weight == null ? ' (level default)' : ''}</span></label></div>
    <div className="row end"><button className="btn" onClick={onClose}>Cancel</button><button className="btn pri" disabled={!f.text?.trim() || (f.link === 'goal' && !f.unit_goal_id)} onClick={go}>Save</button></div>
  </Modal>;
}

/** Key result builder. `requestOnly`: the OKR plan is approved, so target changes go to Group Strategy as a change request instead of applying at once. */
export function KrModal({ unit, init, onClose, requestOnly, focus }: { unit: string; init: Row; onClose: () => void; requestOnly?: boolean; focus?: 'targets' }) {
  const { db, me, user } = useData(); const save = useSave();
  const link0 = db?.kr_plan_links.find(l => l.kr_id === init.id);
  const t0 = Object.fromEntries((db?.kr_targets || []).filter(t => t.kr_id === init.id).map(t => [t.quarter, Number(t.target)]));
  const m0 = Object.fromEntries((db?.kr_month_targets || []).filter(t => t.kr_id === init.id).map(t => [t.month, Number(t.target)]));
  const [f, setF] = useState<Row>({ measure: 'manual', confidence: 'Medium', aggregation: 'sum', direction: 'increase', target_mode: 'quarterly', ...init, sec: link0?.section || 'rev', metric: link0?.metric || 'value', groups: link0?.line_groups || [], t: t0, mt: m0 });
  if (!db) return null;
  const set = (k: string, v: any) => setF(x => ({ ...x, [k]: v }));
  const grps = Array.from(new Set(linesOf(db, unit, f.sec).map(l => l.line_group || 'Other')));
  const obj = byId(db.objectives, f.objective_id);
  const people = db.positions.filter(p => p.unit_id === unit);
  const isSum = f.aggregation === 'sum';
  // implied year figure from the entered periods
  const implied = (() => { const vals = f.target_mode === 'monthly' ? Array.from({ length: 12 }, (_, i) => f.mt[i + 1]) : f.target_mode === 'quarterly' ? [1, 2, 3, 4].map(q => f.t[q]) : [f.year_target];
    const v = vals.filter((x: any) => x != null) as number[]; if (!v.length) return null; return isSum ? v.reduce((a, b) => a + b, 0) : f.aggregation === 'average' ? v.reduce((a, b) => a + b, 0) / v.length : f.aggregation === 'max' ? Math.max(...v) : f.aggregation === 'min' ? Math.min(...v) : v[v.length - 1]; })();
  function spread(how: 'even' | 'ramp' | 'back') {
    const yt = Number(f.year_target || 0), b = Number(f.baseline || 0);
    const w = how === 'even' ? Array(12).fill(1) : how === 'ramp' ? Array.from({ length: 12 }, (_, i) => i + 1) : Array.from({ length: 12 }, (_, i) => 12 - i);
    const ws = w.reduce((a, c) => a + c, 0);
    if (f.target_mode === 'monthly') { const mt: Row = {}; let run = 0; for (let i = 0; i < 12; i++) { if (isSum) mt[i + 1] = Math.round(yt * w[i] / ws * 100) / 100; else { run += w[i]; mt[i + 1] = Math.round((b + (yt - b) * run / ws) * 100) / 100; } } set('mt', mt); }
    else { const t: Row = {}; let run = 0; for (let q = 1; q <= 4; q++) { const qw = w[q * 3 - 3] + w[q * 3 - 2] + w[q * 3 - 1]; if (isSum) t[q] = Math.round(yt * qw / ws * 100) / 100; else { run += qw; t[q] = Math.round((b + (yt - b) * run / ws) * 100) / 100; } } set('t', t); }
  }
  async function go() {
    const year = f.target_mode === 'annual' ? f.year_target ?? null : (f.year_target ?? implied);
    const row: Row = { objective_id: f.objective_id, title: f.title.trim(), uom: f.uom || null, aggregation: f.aggregation, direction: f.direction, target_mode: f.target_mode, tolerance: f.tolerance ?? null,
      kr_type: f.aggregation === 'sum' ? 'cumulative' : 'level', lower_is_better: f.direction === 'decrease', weight: f.weight ?? null, owner_position_id: f.owner_position_id || null, measure: f.measure, baseline: f.baseline ?? null, year_target: year, confidence: f.confidence, state: f.state || 'active', state_reason: f.state_reason || null, state_evidence: f.state_evidence || null, state_at: f.state && f.state !== 'active' ? new Date().toISOString() : null };
    if (requestOnly && f.id) { // approved plan: targets go for approval; the rest is saved now
      const changes: Row[] = []; const lbl = (k: string) => `${f.title} · ${k.toUpperCase()}`;
      if ((year ?? null) !== (init.year_target ?? null)) changes.push({ kr_id: f.id, key: 'year', old: init.year_target ?? null, new: year, label: lbl('year') });
      if (f.target_mode === 'quarterly') [1, 2, 3, 4].forEach(q => { if ((f.t[q] ?? null) !== (t0[q] ?? null)) changes.push({ kr_id: f.id, key: 'q' + q, old: t0[q] ?? null, new: f.t[q] ?? null, label: lbl('q' + q) }); });
      if (f.target_mode === 'monthly') for (let m = 1; m <= 12; m++) if ((f.mt[m] ?? null) !== (m0[m] ?? null)) changes.push({ kr_id: f.id, key: 'm' + m, old: m0[m] ?? null, new: f.mt[m] ?? null, label: lbl('m' + m) });
      const { year_target: _y, target_mode: _t, ...rest } = row;
      const u1 = await sb.from('key_results').update(rest).eq('id', f.id); if (u1.error) { alert(u1.error.message); return; }
      const ok = await save(() => changes.length ? sb.from('rescopes').insert({ unit_id: unit, kind: 'okr_targets', trigger: 'Target change', status: 'Submitted', changes, by_user: user.id, note: `${changes.length} target change(s) by ${me?.holder_name || ''}` }) : Promise.resolve({ error: null }) as any, ['key_results', 'rescopes'], changes.length ? 'Target change sent to Group Strategy for approval' : 'Key result saved');
      if (ok) onClose(); return;
    }
    const r = f.id ? await sb.from('key_results').update(row).eq('id', f.id).select('id').single() : await sb.from('key_results').insert(row).select('id').single();
    if (r.error) { alert(r.error.message); return; }
    const id = r.data.id;
    if (f.measure === 'plan') await sb.from('kr_plan_links').upsert({ kr_id: id, section: f.sec, metric: f.metric, line_groups: f.groups });
    else await sb.from('kr_plan_links').delete().eq('kr_id', id);
    await sb.from('kr_targets').delete().eq('kr_id', id); await sb.from('kr_month_targets').delete().eq('kr_id', id);
    const ts = f.target_mode === 'quarterly' ? [1, 2, 3, 4].filter(q => f.t[q] != null).map(q => ({ kr_id: id, quarter: q, target: f.t[q] })) : [];
    const ms = f.target_mode === 'monthly' ? Array.from({ length: 12 }, (_, i) => i + 1).filter(m => f.mt[m] != null).map(m => ({ kr_id: id, month: m, target: f.mt[m] })) : [];
    if (ts.length) await sb.from('kr_targets').insert(ts);
    const ok = await save(() => ms.length ? sb.from('kr_month_targets').insert(ms) : Promise.resolve({ error: null }) as any, ['key_results', 'kr_plan_links', 'kr_targets', 'kr_month_targets'], 'Key result saved');
    if (ok) onClose();
  }
  return <Modal title={f.id ? (focus === 'targets' ? 'Targets — ' + (f.title || '').slice(0, 60) : 'Edit key result') : 'New key result'} onClose={onClose} wide>
    <p className="note">Objective: {obj?.text}</p>
    {requestOnly && <div className="banner warn">The OKR plan is approved: target changes are sent to Group Strategy for approval and apply once approved. Other changes are saved straight away.</div>}
    <label className="f">Key result<input type="text" value={f.title || ''} onChange={e => set('title', e.target.value)} placeholder="Measurable result, e.g. Transformers produced" /></label>
    <div className="g3">
      <label className="f">Where the actual comes from<select value={f.measure} onChange={e => set('measure', e.target.value)}><option value="manual">Checked in with evidence</option><option value="plan">From the annual plan (revenue / budget)</option><option value="deliverables">From deliverables accepted</option><option value="children">From the objectives below</option></select></label>
      <label className="f">Unit of measure<input type="text" value={f.uom || ''} onChange={e => set('uom', e.target.value)} placeholder="units, ETB, %, days…" /></label>
      <label className="f">Weight in the objective (%)<NumIn value={f.weight} onChange={v => set('weight', v)} /></label>
    </div>
    <div className="card stack"><h3>How progress is calculated</h3>
      <div className="g3">
        <label className="f">Combine the months by<select value={f.aggregation} onChange={e => set('aggregation', e.target.value)}>{Object.entries(AGG_NAME).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="f">Direction<select value={f.direction} onChange={e => set('direction', e.target.value)}>{Object.entries(DIR_NAME).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {f.direction === 'maintain' ? <label className="f">Allowed deviation (±)<NumIn value={f.tolerance} onChange={v => set('tolerance', v)} /></label> : <label className="f">Baseline (where we start)<NumIn value={f.baseline} onChange={v => set('baseline', v)} /></label>}
      </div>
      <p className="note">{f.aggregation === 'sum' ? 'Example: units produced, revenue, trainings held — each month adds to the total, so a quarter is the sum of its months.' : f.aggregation === 'average' ? 'Example: average on-time delivery or satisfaction — the quarter is the average of its months.' : f.aggregation === 'latest' ? 'Example: ISO certification progress, staff competency %, market share — the latest reading is the result.' : 'The best (or lowest) month in the period is the result.'} {f.direction === 'decrease' ? 'Lower is better: progress grows as the value falls from the baseline toward the target (costs, defects, downtime).' : f.direction === 'maintain' ? 'Full marks while the value stays within the allowed deviation of the target.' : ''}</p>
    </div>
    {f.measure === 'plan' && <div className="card stack"><h3>Link to the annual plan</h3><div className="g2">
      <label className="f">Plan section<select value={f.sec} onChange={e => { set('sec', e.target.value); set('groups', []); }}><option value="rev">Revenue</option><option value="cos">Cost of sales</option><option value="opex">Operating expenses</option><option value="capex">Capital spending</option><option value="proj">Projects</option></select></label>
      <label className="f">Figure<select value={f.metric} onChange={e => set('metric', e.target.value)}><option value="value">Amount (ETB)</option><option value="quantity">Quantity</option></select></label></div>
      <div><div className="note">Product groups / budget lines (none = all)</div><div className="chips">{grps.map(g => <button type="button" key={g} className={'chip' + (f.groups.includes(g) ? ' on' : '')} onClick={() => set('groups', f.groups.includes(g) ? f.groups.filter((x: string) => x !== g) : [...f.groups, g])}>{g}</button>)}</div></div>
      <p className="note">Monthly targets and actuals come from the plan and Finance actuals. For cost-saving, link the budget lines and choose "Regressive".</p></div>}
    {f.measure !== 'plan' && f.measure !== 'children' && f.measure !== 'deliverables' && <div className="card stack"><div className="row"><h3 style={{ flex: 1 }}>Targets</h3><Seg value={f.target_mode} options={[['annual', 'One annual target'], ['quarterly', 'By quarter'], ['monthly', 'By month']]} onChange={v => set('target_mode', v)} /></div>
      <div className="g3"><label className="f">Year target<NumIn value={f.year_target} onChange={v => set('year_target', v)} /></label>
        {f.target_mode !== 'annual' && <div className="f"><span>Fill from the year target</span><div className="row"><button type="button" className="btn sm" onClick={() => spread('even')}>Evenly</button><button type="button" className="btn sm" onClick={() => spread('ramp')}>Ramp up</button><button type="button" className="btn sm" onClick={() => spread('back')}>Front-loaded</button></div></div>}
        {f.target_mode !== 'annual' && <div className="f"><span>Year implied by the periods</span> <b>{implied == null ? '—' : fmt(implied, 2)} {f.uom}</b></div>}</div>
      {f.target_mode === 'quarterly' && <div className="g4">{[1, 2, 3, 4].map(q => <label key={q} className="f">Q{q} {isSum ? 'target' : 'level by end'}<NumIn value={f.t[q]} onChange={v => set('t', { ...f.t, [q]: v })} /></label>)}</div>}
      {f.target_mode === 'monthly' && <div className="tw"><table className="t"><thead><tr>{MONTHS.map(m => <th key={m} className="n">{m}</th>)}</tr></thead><tbody><tr>{MONTHS.map((_, i) => <td key={i} className="n"><NumIn value={f.mt[i + 1]} w={68} onChange={v => set('mt', { ...f.mt, [i + 1]: v })} /></td>)}</tr></tbody></table></div>}
      <p className="note">{f.target_mode === 'annual' ? (isSum ? 'Each quarter is measured against a quarter of the year target (each month a twelfth).' : 'Each period is measured against the point on a straight line from the baseline to the year target.') : 'Each period is measured against what you enter here.'}</p></div>}
    {(f.measure === 'deliverables' || f.measure === 'children') && <p className="note">{f.measure === 'deliverables' ? 'Progress = weight of deliverables accepted ÷ weight of deliverables due in the period. Add deliverables in Work → Month.' : 'Progress = weighted score of the objectives that deliver this key result.'}</p>}
    <div className="g2">
      <label className="f">Owner<select value={f.owner_position_id || ''} onChange={e => set('owner_position_id', e.target.value)}><option value="">—</option>{people.map(p => <option key={p.id} value={p.id}>{(p.holder_name || 'Vacant') + ' · ' + p.title}</option>)}</select></label>
      <label className="f">Confidence<select value={f.confidence} onChange={e => set('confidence', e.target.value)}><option>High</option><option>Medium</option><option>Low</option></select></label></div>
    {f.id && <div className="card stack"><h3>Status of this key result</h3><div className="g3">
      <label className="f">State<select value={f.state || 'active'} onChange={e => set('state', e.target.value)}><option value="active">Active — scored</option><option value="paused">Paused — not scored for now</option><option value="dropped">Dropped — focus changed</option></select></label>
      <label className="f">Reason<input type="text" value={f.state_reason || ''} onChange={e => set('state_reason', e.target.value)} placeholder="Why the target or state changed" /></label>
      <label className="f">Evidence link<input type="text" value={f.state_evidence || ''} onChange={e => set('state_evidence', e.target.value)} /></label></div>
      <p className="note">Pausing or dropping keeps the history but removes it from scores. Changing the target after approval: use Work → Plan → Targets (sent for approval) or a rescope. Every change is in the audit log.</p></div>}
    <div className="row end">{f.id && <button className="btn danger" onClick={async () => { if (confirm('Delete this key result?') && await save(() => sb.from('key_results').delete().eq('id', f.id), ['key_results', 'check_ins'], 'Deleted')) onClose(); }}>Delete</button>}<span className="sp" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn pri" disabled={!f.title?.trim()} onClick={go}>Save</button></div>
  </Modal>;
}

/** Simplified view for a department or division head: the objectives directly above them, every objective that contributes to each
    (theirs and their peers'), the weight of each and what share of the parent's score it carries. */
function HeadView({ myOrg, p, extra, onKr, onNew }: { myOrg: string; p: Period; extra: (o: Row) => JSX.Element; onKr: (id: string) => void; onNew: (parentId: string | null) => void }) {
  const { db } = useData(); const save = useSave(); if (!db) return null;
  const org = byId(db.org_units, myOrg); const above = byId(db.org_units, org?.parent_id);
  const mine = db.objectives.filter(o => o.org_unit_id === myOrg && liveObj(o) && o.level !== 'individual');
  const parentOf = (o: Row) => o.parent_objective_id || (o.parent_kr_id ? byId(db.key_results, o.parent_kr_id)?.objective_id : null) || null;
  const parents = Array.from(new Set(mine.map(parentOf).filter(Boolean))) as string[];
  const loose = mine.filter(o => !parentOf(o));
  const setW = (o: Row, v: number | null) => save(() => sb.from('objectives').update({ weight_to_parent: v }).eq('id', o.id), ['objectives'], 'Weight saved');
  return <>
    <p className="note">Your objectives and the objectives directly above them{above ? ` (${above.name})` : ''}, with the other objectives that contribute to the same parent — so you can see what share of the parent each one carries. Only your own rows can be changed here; switch to "Whole unit" for everything.</p>
    {parents.map(pid => { const P = byId(db.objectives, pid)!; if (!P) return null; const kids = childObjectives(db, pid).filter(c => c.level !== 'individual'); const hasKrs = krsOf(db, pid).length > 0; const own = hasKrs && kids.length ? ownShare(db, P) : 0; const tw = sum(kids.map(c => Number(c.weight_to_parent) || 0)) || kids.length;
      const viaKr = mine.filter(o => o.parent_kr_id && byId(db.key_results, o.parent_kr_id)?.objective_id === pid);
      return <section className="pil" key={pid}><div className="pilh">Above you · {byId(db.org_units, P.org_unit_id)?.name}</div>
        <div className="card" style={{ marginTop: 8 }}><div className="row"><b style={{ flex: 1 }}>{P.text}</b><span className="mini">score {pct(objScore(db, P, p))}</span></div>
          <div className="mini">{hasKrs && kids.length ? `Its score: ${own}% from its own key results · ${100 - own}% from the objectives below (set by its owner for this objective)` : kids.length ? 'Its score comes entirely from the objectives below' : 'Its score comes from its own key results'}</div>
          {kids.length > 0 && <div className="tw" style={{ marginTop: 8 }}><table className="t"><thead><tr><th>Objective that contributes</th><th>Organisation</th><th className="n" data-tip="Weight of this objective among those under the same parent. Together they should add up to 100%.">Weight</th><th className="n" data-tip="How much of the parent's score this objective carries: (100% − own share) × weight.">Share of parent</th><th className="n">Score</th></tr></thead><tbody>
            {kids.map(c => { const isMine = c.org_unit_id === myOrg; const w = Number(c.weight_to_parent) || (Number(c.weight_to_parent) === 0 ? 0 : 100 / kids.length);
              return <tr key={c.id} className={isMine ? 'b' : ''}><td>{c.text}{isMine && <Pill tone="info">yours</Pill>}</td><td className="mini">{byId(db.org_units, c.org_unit_id)?.name}</td>
                <td className="n">{isMine ? <NumIn value={c.weight_to_parent} w={64} onChange={v => setW(c, v)} /> : `${fmt(Number(c.weight_to_parent) || 0)}%`}</td><td className="n">{pct((100 - own) / 100 * w / tw)}</td><td className="n">{pct(objScore(db, c, p))}</td></tr>; })}
            <tr className="mini"><td colSpan={2}>Total</td><td className="n">{Math.round(sum(kids.map(c => Number(c.weight_to_parent) || 0))) !== 100 ? <Pill tone="warn">{fmt(sum(kids.map(c => Number(c.weight_to_parent) || 0)))}%</Pill> : '100%'}</td><td className="n">{pct((100 - own) / 100)}</td><td /></tr>
          </tbody></table></div>}
          {viaKr.length > 0 && <p className="mini">Also delivering its key results: {viaKr.map(o => o.text).join(' · ')}</p>}
          <div className="row" style={{ marginTop: 8 }}><span className="sp" /><button className="btn sm" onClick={() => onNew(pid)}>+ Objective under this</button></div></div>
        {mine.filter(o => parentOf(o) === pid).map(o => <ObjCard key={o.id} o={o} p={p} onKr={onKr} extra={extra} depth={1} />)}</section>; })}
    {loose.length > 0 && <section className="pil"><div className="pilh" style={{ background: 'var(--warn)' }}>Yours, not yet linked to an objective above · {loose.length}</div>{loose.map(o => <ObjCard key={o.id} o={o} p={p} onKr={onKr} extra={extra} />)}</section>}
    {!mine.length && <Empty>{org?.name} has no objectives yet. Use "+ Objective" to add one under an objective of {above?.name || 'the level above'}.</Empty>}
  </>;
}

export default function OkrPlan() {
  const { db, unit, me } = useData(); const save = useSave();
  const isDeptHead = !!me && ['department', 'division'].includes(me.level) && me.role !== 'employee';
  const [p, setP] = usePeriod(); const [org, setOrg] = useState(() => isDeptHead ? me!.org_unit_id : ''); const [simple, setSimple] = useState<'mine' | 'all'>(isDeptHead ? 'mine' : 'all'); const [om, setOm] = useState<Row | null>(null); const [km, setKm] = useState<Row | null>(null); const [kr, setKr] = useState<string | null>(null);
  if (!db || !unit) return null;
  const tree = unitGoalsTree(db, unit); const loose = unlinked(db, unit);
  const headMode = isDeptHead && simple === 'mine' && me!.unit_id === unit; const parentOrg = me ? byId(db.org_units, me.org_unit_id)?.parent_id : null;
  const newUnder = (pid: string | null) => setOm({ unit_id: unit, org_unit_id: me!.org_unit_id, link: 'obj', parent_objective_id: pid || '', owner_position_id: me!.id });
  const unitOrg = unit;
  const krW = (oid: string) => sum(krsOf(db, oid).map(k => Number(k.weight) || 0));
  const kidW = (oid: string) => sum(childObjectives(db, oid).map(c => Number(c.weight_to_parent) || 0));
  const issues = db.objectives.filter(o => o.unit_id === unit && ((krsOf(db, o.id).length && Math.round(krW(o.id)) !== 100) || (childObjectives(db, o.id).length && Math.round(kidW(o.id)) !== 100)));
  const extra = (o: Row) => <div className="row">
    {(o.state || 'active') !== 'active' && <Pill tone="warn">{o.state}</Pill>}
    <button className="btn sm" data-tip="Pause: keep it but stop scoring it (e.g. focus changed). Resume any time." onClick={() => { const st = (o.state || 'active') === 'active' ? 'paused' : 'active'; const why = st === 'paused' ? prompt('Why is it paused?') : ''; if (st === 'paused' && !why) return; save(() => sb.from('objectives').update({ state: st, state_reason: why || null }).eq('id', o.id), ['objectives'], st === 'paused' ? 'Paused' : 'Resumed'); }}>{(o.state || 'active') === 'active' ? 'Pause' : 'Resume'}</button>
    {krsOf(db, o.id).length > 0 && Math.round(krW(o.id)) !== 100 && <Pill tone="warn">KR weights {fmt(krW(o.id))}%</Pill>}
    {childObjectives(db, o.id).length > 0 && Math.round(kidW(o.id)) !== 100 && <Pill tone="warn">cascade {fmt(kidW(o.id))}%</Pill>}
    {krsOf(db, o.id).length > 0 && childObjectives(db, o.id).length > 0 && <span className={'ownshare' + (o.own_weight == null ? ' unset' : '')} data-tip="This objective has its own key results and objectives below it. Own share = how much of its score comes from its own key results; the rest comes from the objectives below. Set it for each objective.">Own KRs <input type="number" min={0} max={100} defaultValue={ownShare(db, o)} onBlur={e => { const v = Number(e.target.value); if (!isNaN(v) && v >= 0 && v <= 100 && v !== Number(o.own_weight)) save(() => sb.from('objectives').update({ own_weight: v }).eq('id', o.id), ['objectives'], 'Own share saved'); }} />% · below {100 - ownShare(db, o)}%{o.own_weight == null && ' (default)'}</span>}
    <button className="btn sm" onClick={() => setKm({ objective_id: o.id, owner_position_id: o.owner_position_id })}>+ Key result</button>
    <button className="btn sm" onClick={() => setOm({ unit_id: unit, org_unit_id: o.org_unit_id, parent_objective_id: o.id, owner_position_id: null })}>+ Below</button>
    <button className="btn sm" onClick={() => setOm(o)}>Edit</button>
    <button className="btn sm danger" onClick={() => { if (confirm('Delete this objective and its key results?')) save(() => sb.from('objectives').delete().eq('id', o.id), ['objectives', 'key_results'], 'Deleted'); }}>Delete</button>
  </div>;
  return <Page title="Objective planner" desc="Set the year's objectives from the strategic goals, cascade them, and weight them." help={<>
    <h3>How OKR planning works</h3><ol><li><b>Start from a strategic goal.</b> A unit objective always delivers one of the unit's own strategic goals; choosing the goal sets the pillar.</li>
      <li><b>Add key results</b> (2–5 per objective). Say how each is measured: from the annual plan (revenue, quantity or spending of chosen product groups or budget lines), from deliverables, from the objectives below, or checked in with evidence. Weights inside an objective add up to 100%.</li>
      <li><b>Cascade.</b> Use "+ Below" to give a department or division an objective that delivers the one above (or one of its key results). The weights of the objectives below one parent add up to 100% — this is cascade weighting.</li>
      <li><b>Submit.</b> The OKR plan goes to Group Strategy, who approve it or return it with a note.</li></ol>
    <p>Pills warn when weights do not add up to 100%. Click a key result to see its detail; use Edit on it there via its objective.</p>
    <p>Objectives brought over from the ERP keep their ERP status; review and link the ones listed under "Not linked to a goal yet".</p></>}>
    <Cmd right={<>{isDeptHead && <Seg value={simple} options={[['mine', 'Above me and mine'], ['all', 'Whole unit']]} onChange={setSimple} />}{!headMode && <OrgFilter value={org} onChange={setOrg} />}<PeriodPicker value={p} onChange={setP} />{!headMode && <Link className="btn" to="/goals/new">Guided new objective</Link>}<button className="btn pri" onClick={() => headMode ? newUnder(null) : setOm({ unit_id: unit, org_unit_id: unitOrg, unit_goal_id: '', owner_position_id: null })}>+ Objective</button></>} />
    <StatusBar unit={unit} kind="okr" label="OKR plan 2026/27" />
    {issues.length > 0 && <div className="banner warn">{issues.length} objective{issues.length > 1 ? 's have' : ' has'} weights that do not add up to 100%.</div>}
    {!headMode && !tree.length && <Empty>No strategic goals for this unit yet. Group Strategy loads them from the unit strategy.</Empty>}
    {headMode && <HeadView myOrg={me!.org_unit_id} p={p} extra={extra} onKr={id => setKm(byId(db.key_results, id)!)} onNew={newUnder} />}
    {!headMode && org && <section className="pil"><div className="pilh">Objectives of {byId(db.org_units, org)?.name} and below</div>{db.objectives.filter(o => subtreeIds(db, org).has(o.org_unit_id) && o.status !== 'Archived' && o.level !== 'individual').map(o => <ObjCard key={o.id} o={o} p={p} onKr={id => setKm(byId(db.key_results, id)!)} extra={extra} depth={1} />)}</section>}
    {!headMode && !org && tree.map(({ p: pil, goals }) => <section className="pil" key={pil.id}><div className="pilh">{pil.code} · {pil.name}</div>
      {goals.map(g => <div className="goal" key={g.id}><div className="goalh">{g.code} {g.name}<button className="btn sm" onClick={() => setOm({ unit_id: unit, org_unit_id: unitOrg, unit_goal_id: g.id })}>+ Objective</button></div>
        {topObjectives(db, g.id).map(o => <ObjCard key={o.id} o={o} p={p} onKr={id => setKm(byId(db.key_results, id)!)} extra={extra} />)}</div>)}</section>)}
    {!headMode && !org && loose.length > 0 && <section className="pil"><div className="pilh" style={{ background: 'var(--warn)' }}>Not linked to a goal yet · {loose.length}</div>{loose.map(o => <ObjCard key={o.id} o={o} p={p} onKr={id => setKm(byId(db.key_results, id)!)} extra={extra} />)}</section>}
    {om && <ObjModal unit={unit} init={om} onClose={() => setOm(null)} parentOrg={headMode ? parentOrg : null} />}
    {km && <KrModal unit={unit} init={km} onClose={() => setKm(null)} />}
    {kr && <KrDrawer id={kr} onClose={() => setKr(null)} />}
  </Page>;
}
