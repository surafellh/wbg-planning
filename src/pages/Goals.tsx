import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Targets } from './work/Plan';
import { useData, useSave, byId, posName, type DB, type Row } from '../lib/data';
import { sb } from '../lib/supabase';
import { krState, objScore, objState, krsOf, childObjectives, fmt, pct, MONTHS, periodLabel, periodMonths, krTarget, krActual, monthlyValues, curMonth, qOfMonth, AGG_NAME, DIR_NAME, currentPeriod, orgScore, avg, weighted, subtreeIds, unitOfObjective, krDrivers, type Period } from '../lib/calc';
import { Page, Cmd, Ring, Bar, Pill, Drawer, Empty, Seg, PeriodPicker, usePeriod, StatusStack, Modal, StatePill, OrgFilter, NumIn, ViewTabs } from '../lib/ui';

export const MEASURE: Record<string, [string, string]> = { plan: ['₿', 'From the annual plan'], deliverables: ['✓', 'From deliverables'], children: ['↳', 'From the objectives below'], manual: ['✎', 'Checked in with evidence'] };
const LVL: Record<string, string> = { unit: 'Unit', department: 'Department', division: 'Division' };

export function unitGoalsTree(db: DB, unit: string) {
  const pillars = db.unit_pillars.filter(p => p.unit_id === unit).sort((a, b) => a.sort - b.sort);
  return pillars.map(p => ({ p, goals: db.unit_goals.filter(g => g.pillar_id === p.id).sort((a, b) => a.sort - b.sort) }));
}
export const topObjectives = (db: DB, goalId: string) => db.objectives.filter(o => o.unit_goal_id === goalId && o.status !== 'Archived').sort((a, b) => a.sort - b.sort);
export const unlinked = (db: DB, unit: string) => db.objectives.filter(o => o.unit_id === unit && o.status !== 'Archived' && !o.unit_goal_id && !o.parent_objective_id && !o.parent_kr_id);
/** All objectives under a goal, at every level (for goal and pillar scores). */
export function goalScore(db: DB, goalId: string, p: Period) { return avg(topObjectives(db, goalId).map(o => objScore(db, o, p))); }
/** Pillar score: its goals' scores, weighted by each goal's weight in the pillar (equal when no weights are set). */
export function pillarScore(db: DB, pillarId: string, p: Period) { const gs = db.unit_goals.filter(g => g.pillar_id === pillarId); return weighted(gs.map(g => [Number(g.weight) || (gs.some(x => Number(x.weight)) ? 0 : 1), goalScore(db, g.id, p)])); }

/** Shares that always add up to 100: weights that are set count as given, the rest split what is left equally; then normalised. */
export function shares<T>(items: T[], w: (x: T) => any): Map<T, number> {
  const has = (x: T) => w(x) != null && w(x) !== '' && !isNaN(Number(w(x)));
  const setSum = items.filter(has).reduce((a, x) => a + Number(w(x)), 0); const rest = items.filter(x => !has(x)).length;
  const each = rest ? Math.max(0, 100 - setSum) / rest : 0; const raw = items.map(x => has(x) ? Number(w(x)) : each); const tot = raw.reduce((a, b) => a + b, 0);
  return new Map(items.map((x, i) => [x, tot ? raw[i] * 100 / tot : 100 / items.length]));
}
export const groupGoalsOf = (db: DB, pillarId: string) => db.group_goals.filter(g => g.pillar_id === pillarId).sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }));
/** Each Group pillar's share of the Group strategy. */
export const pillarShares = (db: DB) => shares(db.group_pillars.slice().sort((a, b) => a.sort - b.sort), p => p.weight);
/** Each Group goal's share of its pillar. */
export const goalShares = (db: DB, pillarId: string) => shares(groupGoalsOf(db, pillarId), g => g.weight);
/** Each unit goal's contribution to the Group goal it serves. Shares are per unit (equal by default); a unit with several goals on one Group goal splits its share among them. */
export function contribShares(db: DB, groupGoalId: string) {
  const ugs = db.unit_goals.filter(u => u.group_goal_id === groupGoalId); const units = Array.from(new Set(ugs.map(u => u.unit_id)));
  const uw = (uid: string) => { const m = ugs.filter(u => u.unit_id === uid); return m.some(u => u.contribution != null) ? m.reduce((a, u) => a + (Number(u.contribution) || 0), 0) : null; };
  const us = shares(units, uw); const out = new Map<Row, number>();
  ugs.forEach(u => { const m = ugs.filter(x => x.unit_id === u.unit_id); out.set(u, (us.get(u.unit_id) || 0) / m.length); }); return out;
}
/** Each unit's share of the whole Group strategy: pillar share × goal share × contribution, summed. Adds up to 100 over the goals that are served. */
export function unitStrategyShares(db: DB) {
  const out = new Map<string, number>(); let served = 0; const ps = pillarShares(db);
  db.group_pillars.forEach(pil => { const gs = goalShares(db, pil.id); groupGoalsOf(db, pil.id).forEach(g => { const cs = contribShares(db, g.id); const base = (ps.get(pil) || 0) * (gs.get(g) || 0) / 100;
    if (cs.size) served += base; cs.forEach((c, u) => out.set(u.unit_id, (out.get(u.unit_id) || 0) + base * c / 100)); }); });
  return { byUnit: out, served };
}
/** Corporate functions plan against the Group strategy: picking a Group goal finds (or creates) the unit's mirror of it. */
export async function ensureUnitGoal(db: DB, unit: string, groupGoalId: string): Promise<string | null> {
  const have = db.unit_goals.find(u => u.unit_id === unit && u.group_goal_id === groupGoalId); if (have) return have.id;
  const gg = byId(db.group_goals, groupGoalId); const gp = gg && byId(db.group_pillars, gg.pillar_id); if (!gg || !gp) return null;
  let pil = db.unit_pillars.find(x => x.unit_id === unit && x.code === gp.code);
  if (!pil) { const id = crypto.randomUUID(); const { error } = await sb.from('unit_pillars').insert({ id, unit_id: unit, code: gp.code, name: gp.name, description: 'Group pillar', sort: gp.sort }); if (error) return null; pil = { id }; }
  const id = crypto.randomUUID(); const { error } = await sb.from('unit_goals').insert({ id, unit_id: unit, pillar_id: pil.id, code: gg.code, name: gg.name, group_goal_id: gg.id, link_confirmed: true, sort: gg.sort || 0 });
  return error ? null : id;
}
export const isFunctionUnit = (db: DB, unit: string) => byId(db.org_units, unit)?.unit_type === 'function';
export function statusCounts(db: DB, krs: Row[], p: Period) {
  const c: Record<string, number> = { 'On track': 0, Behind: 0, 'Off track': 0, 'No update': 0, other: 0 };
  krs.forEach(k => { const s = krState(db, k, p).label; if (s in c) c[s]++; else c.other++; });
  return [{ label: 'On track', n: c['On track'], tone: 'good' }, { label: 'Behind', n: c.Behind, tone: 'warn' }, { label: 'Off track', n: c['Off track'], tone: 'bad' }, { label: 'No update / too early', n: c['No update'] + c.other, tone: 'none' }];
}
export const unitKrs = (db: DB, unit: string) => db.objectives.filter(o => o.unit_id === unit && o.level !== 'individual' && o.status !== 'Archived').flatMap(o => krsOf(db, o.id));

export function KrRow({ k, p, onOpen }: { k: Row; p: Period; onOpen: (id: string) => void }) {
  const { db } = useData(); if (!db) return null;
  const s = krState(db, k, p);
  return <div className="kr" onClick={() => onOpen(k.id)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpen(k.id); }}>
    <span className="ms" title={MEASURE[k.measure]?.[1]}>{MEASURE[k.measure]?.[0]}</span>
    <span>{k.title}<span className="note"> · {posName(db, k.owner_position_id)}</span></span>
    <span className="note hide-s" title={`${periodLabel(p)} target and actual`}>{s.actual != null || s.target != null ? `${fmt(s.actual, 1)} / ${fmt(s.target, 1)} ${k.measure === 'deliverables' ? 'weight' : k.uom || ''}` : ''}</span>
    <span className="hide-s"><Bar p={s.progress} /></span>
    <span className="hide-s"><StatePill s={s} /></span>
    <span className="w">{k.weight != null ? fmt(Number(k.weight)) + '%' : ''}</span>
  </div>;
}

export function ObjCard({ o, p, onKr, depth = 0, extra }: { o: Row; p: Period; onKr: (id: string) => void; depth?: number; extra?: (o: Row) => React.ReactNode }) {
  const { db } = useData(); const [open, setOpen] = useState(depth < 1); if (!db) return null;
  const ks = krsOf(db, o.id); const kids = childObjectives(db, o.id).concat(db.objectives.filter(c => c.parent_kr_id && c.status !== 'Archived' && ks.some(k => k.id === c.parent_kr_id)));
  const org = byId(db.org_units, o.org_unit_id); const st = objState(db, o, p);
  return <div className="obj">
    <div className="objh"><Ring p={objScore(db, o, p)} size={40} />
      <div className="ot">{o.text}<div className="om"><span className="lvl">{LVL[o.level]}</span> {org?.name} · {posName(db, o.owner_position_id)}{o.weight_to_parent != null && (o.parent_objective_id || o.parent_kr_id) ? ` · weight ${fmt(Number(o.weight_to_parent))}%` : ''} · {o.status}{/Link to check/.test(o.review_note || '') && <> <span className="pill warn" data-tip={o.review_note}>link to check</span></>}{/^Split from ERP OKR/.test(o.review_note || '') && <span className="mini" data-tip={o.review_note}> · from a multi-objective ERP OKR</span>}</div></div>
      <StatePill s={st} />{extra?.(o)}
    </div>
    <div className="krl">{ks.map(k => <KrRow key={k.id} k={k} p={p} onOpen={onKr} />)}{!ks.length && !kids.length && <p className="note">No key results yet.</p>}</div>
    {kids.length > 0 && <div style={{ marginTop: 6 }}><button className="linkbtn" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} {kids.length} objective{kids.length > 1 ? 's' : ''} below</button>
      {open && <div className="kids">{kids.map(c => <ObjCard key={c.id} o={c} p={p} onKr={onKr} depth={depth + 1} extra={extra} />)}</div>}</div>}
  </div>;
}

/** Key-result detail: targets and actuals by month and quarter, check-in, history, comments. */
/** The deliverables and weekly activities that drive a key result. */
export function KrDriversBlock({ k }: { k: Row }) {
  const { db } = useData(); const [open, setOpen] = useState<string | null>(null); if (!db) return null;
  const dr = krDrivers(db, k.id);
  if (!dr.dels.length && !dr.acts.length) return <div className="card"><h3>What drives this key result</h3><p className="note">No deliverables or weekly activities are linked yet. Heads link them in Work → Plan → Deliverables.</p></div>;
  return <div className="card stack"><div className="row"><h3 style={{ flex: 1 }}>What drives this key result</h3><span className="mini">{dr.dels.length} deliverables · {dr.acts.length} weekly tasks · {dr.done} done{dr.stuck ? ` · ${dr.stuck} blocked/delayed` : ''}{dr.lastUpdate ? ` · last update ${String(dr.lastUpdate).slice(0, 10)}` : ''}</span></div>
    <div className="row" style={{ gap: 8 }}><span className="mini">Work done</span><Bar p={dr.completion} /><span className="mini">{pct(dr.completion)}</span></div>
    {dr.dels.map(d => { const acts = dr.acts.filter(a => a.deliverable_id === d.id); const dn = acts.filter(a => a.status === 'Done').length;
      return <div key={d.id} className="drv"><div className="row click" onClick={() => setOpen(open === d.id ? null : d.id)}><span style={{ flex: 1 }}><b>{open === d.id ? '▾' : '▸'} {d.title}</b><div className="mini">{MONTHS[d.month - 1]} · {posName(db, d.owner_position_id)} · {acts.length ? `${dn}/${acts.length} tasks done` : 'no weekly tasks yet'}</div></span><Pill tone={d.status === 'accepted' ? 'good' : d.status === 'done' ? 'warn' : d.status === 'returned' ? 'bad' : 'none'}>{d.status}</Pill></div>
        {open === d.id && <div className="drvacts">{acts.sort((a, b) => b.week_start.localeCompare(a.week_start)).map(a => <div key={a.id} className="krline"><span style={{ flex: 1 }}>{a.code ? <span className="mini">{a.code} · </span> : null}{a.title}<div className="mini">{posName(db, a.owner_position_id)} · last in {a.week_start}{a.carried_count ? ` · carried ${a.carried_count} wk` : ''}{a.blocker ? ` · ${a.blocker}` : ''}</div></span><Pill tone={a.status === 'Done' ? 'good' : a.status === 'Stuck' ? 'bad' : a.status === 'Delayed' ? 'warn' : 'none'}>{a.status === 'Stuck' ? 'Blocked' : a.status}</Pill><span className="mini">{a.pct ?? 0}%</span></div>)}</div>}</div>; })}
  </div>;
}

export function KrDrawer({ id, onClose, p: p0 }: { id: string; onClose: () => void; p?: Period }) {
  const { db, me, can, user } = useData(); const save = useSave();
  const [m, setM] = useState(curMonth()); const [v, setV] = useState(''); const [conf, setConf] = useState('Medium'); const [note, setNote] = useState(''); const [ev, setEv] = useState(''); const [cm, setCm] = useState('');
  if (!db) return null;
  const k = byId(db.key_results, id); if (!k) return null;
  const o = byId(db.objectives, k.objective_id); const p = p0 || currentPeriod('Q');
  const s = krState(db, k, p); const ys = krState(db, k, { t: 'Y', n: 1 });
  const mayCheck = k.measure === 'manual' && (can('editOKR') || k.owner_position_id === me?.id);
  const hist = db.check_ins.filter(c => c.kr_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const comments = db.comments.filter(c => c.entity_type === 'kr' && c.entity_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const agg = k.aggregation || 'sum'; const mv = monthlyValues(db, k);
  const valueLabel = agg === 'sum' ? `Achieved in ${MONTHS[m - 1]}` : 'Level reached now';
  return <Drawer title="Key result" onClose={onClose}>
    <div><b style={{ fontSize: 16 }}>{k.title}</b><div className="note">{o?.text}</div></div>
    <div className="g3">
      <div className="tile"><div className="tv">{pct(s.progress)}</div><div className="tl">{periodLabel(p)} progress</div><div className="ts"><StatePill s={s} /> {s.expected < 1 && s.expected > 0 ? `· ${pct(s.expected)} of ${periodLabel(p)} passed` : ''}</div></div>
      <div className="tile"><div className="tv">{fmt(s.actual, 1)}</div><div className="tl">Actual · target {fmt(s.target, 1)} {k.uom}</div></div>
      <div className="tile"><div className="tv">{pct(ys.progress)}</div><div className="tl">Year · target {fmt(ys.target, 1)}</div></div>
    </div>
    <div className="note">{MEASURE[k.measure]?.[0]} {MEASURE[k.measure]?.[1]} · {AGG_NAME[agg]} · {DIR_NAME[k.direction || 'increase']} · weight {fmt(Number(k.weight))}% · owner {posName(db, k.owner_position_id)} · confidence {k.confidence || '—'}</div>
    {k.measure !== 'deliverables' && k.measure !== 'children' && <div className="tw"><table className="t"><thead><tr><th></th>{MONTHS.map((mm, i) => <th key={mm} className="n">{mm}{i + 1 === curMonth() ? '•' : ''}</th>)}</tr></thead><tbody>
      <tr><td>Target</td>{MONTHS.map((_, i) => <td key={i} className="n">{fmt(krTarget(db, k, { t: 'M', n: i + 1 }), 1)}</td>)}</tr>
      <tr><td>Actual</td>{MONTHS.map((_, i) => <td key={i} className="n">{k.measure === 'manual' ? fmt(mv[i], 1) : fmt(krActual(db, k, { t: 'M', n: i + 1 }), 1)}</td>)}</tr>
    </tbody></table></div>}
    <div className="tw"><table className="t"><thead><tr><th>Quarter</th><th className="n">Target</th><th className="n">Actual</th><th>Progress</th><th>Status</th></tr></thead><tbody>
      {[1, 2, 3, 4].map(q => { const qs = krState(db, k, { t: 'Q', n: q }); return <tr key={q}><td>Q{q}{q === qOfMonth(curMonth()) ? ' (now)' : ''}</td><td className="n">{fmt(qs.target, 1)}</td><td className="n">{fmt(qs.actual, 1)}</td><td><Bar p={qs.progress} /> {pct(qs.progress)}</td><td><StatePill s={qs} /></td></tr>; })}
    </tbody></table></div>
    <KrDriversBlock k={k} />
    {k.erp_kr_text && <div className="note">From the ERP: {k.erp_kr_text}</div>}
    {mayCheck && <div className="card stack"><h3>Check in</h3>
      <div className="g3"><label className="f">Month<select value={m} onChange={e => setM(Number(e.target.value))}>{MONTHS.slice(0, curMonth()).map((mm, i) => <option key={mm} value={i + 1}>{mm}</option>)}</select></label>
        <label className="f">{valueLabel} ({k.uom || 'value'})<input type="text" inputMode="decimal" value={v} onChange={e => setV(e.target.value)} /></label>
        <label className="f">Confidence the target will be met<select value={conf} onChange={e => setConf(e.target.value)}><option>High</option><option>Medium</option><option>Low</option></select></label></div>
      <label className="f">What moved it, what is in the way<textarea rows={2} value={note} onChange={e => setNote(e.target.value)} /></label>
      <label className="f">Evidence link (optional)<input type="text" value={ev} onChange={e => setEv(e.target.value)} /></label>
      <div className="row end"><button className="btn pri" disabled={v.trim() === '' || isNaN(Number(v))} onClick={async () => {
        const ok = await save(() => sb.from('check_ins').insert({ kr_id: id, month: m, quarter: qOfMonth(m), value: Number(v), confidence: conf, note: note.trim() || null, evidence_url: ev.trim() || null, created_by: user.id }), ['check_ins'], 'Check-in saved');
        if (ok) { await sb.from('key_results').update({ confidence: conf }).eq('id', id); setV(''); setNote(''); setEv(''); }
      }}>Save check-in</button></div></div>}
    <div><h4>Check-ins</h4>{hist.length ? hist.map(c => <div className="lg" key={c.id}><small>{c.created_at.slice(0, 10)} · {c.month ? MONTHS[c.month - 1] : 'Q' + c.quarter} · confidence {c.confidence}</small><div><b>{fmt(Number(c.value), 1)}</b> {k.uom}{c.note ? ' — ' + c.note : ''}{c.evidence_url && <> · <a href={c.evidence_url} target="_blank" rel="noreferrer">evidence</a></>}</div></div>) : <p className="note">{k.measure === 'manual' ? 'No check-ins yet.' : 'This key result updates itself.'}</p>}</div>
    <div><h4>Comments</h4>
      <div className="row"><textarea rows={2} value={cm} onChange={e => setCm(e.target.value)} placeholder="Ask, update or decide" /><button className="btn sm pri" disabled={!cm.trim()} onClick={async () => { if (await save(() => sb.from('comments').insert({ entity_type: 'kr', entity_id: id, body: cm.trim(), created_by: user.id }), ['comments'])) setCm(''); }}>Post</button></div>
      {comments.map(c => <div className="lg" key={c.id}><small>{c.created_at.slice(0, 16).replace('T', ' ')} · {db.profiles.find(pp => pp.id === c.created_by)?.full_name || 'someone'}</small><div>{c.body}</div></div>)}</div>
    {can('editOKR') && <Link to="/studio/okr" onClick={onClose}>Edit in OKR plan →</Link>}
  </Drawer>;
}

/* ---------------- Strategy overview ---------------- */
export function IdentityModal({ unit, onClose }: { unit: string; onClose: () => void }) {
  const { db } = useData(); const save = useSave(); const s0 = db?.strategy_statements.find(s => s.unit_id === unit) || {};
  const [f, setF] = useState<Row>({ ...s0, valuesText: ((s0 as Row).values || []).map((v: Row) => v.name + (v.text ? ' — ' + v.text : '')).join('\n') });
  return <Modal title="Edit vision, mission and values" onClose={onClose} wide>
    <label className="f">Strategy period<input type="text" value={f.period || ''} onChange={e => setF({ ...f, period: e.target.value })} /></label>
    <label className="f">Vision<textarea rows={2} value={f.vision || ''} onChange={e => setF({ ...f, vision: e.target.value })} /></label>
    <label className="f">Mission<textarea rows={3} value={f.mission || ''} onChange={e => setF({ ...f, mission: e.target.value })} /></label>
    <label className="f">Strategic intent<textarea rows={2} value={f.intent || ''} onChange={e => setF({ ...f, intent: e.target.value })} /></label>
    <label className="f">Core values — one per line, "Name — what it means"<textarea rows={6} value={f.valuesText} onChange={e => setF({ ...f, valuesText: e.target.value })} /></label>
    <div className="row end"><button className="btn" onClick={onClose}>Cancel</button><button className="btn pri" onClick={async () => {
      const values = f.valuesText.split('\n').map((l: string) => l.trim()).filter(Boolean).map((l: string) => { const [n, ...t] = l.split(' — '); return { name: n.trim(), text: t.join(' — ').trim() || undefined }; });
      if (await save(() => sb.from('strategy_statements').upsert({ unit_id: unit, period: f.period || null, vision: f.vision || null, mission: f.mission || null, intent: f.intent || null, values }), ['strategy_statements'], 'Saved')) onClose(); }}>Save</button></div>
  </Modal>;
}

export function StrategyOverview() {
  const { db, unit, can } = useData(); const [p, setP] = usePeriod(); const [ed, setEd] = useState(false);
  if (!db || !unit) return null;
  const u = byId(db.org_units, unit)!; const group = db.org_units.find(x => x.kind === 'group');
  const own = db.strategy_statements.find(s => s.unit_id === unit); const st = own || db.strategy_statements.find(s => s.unit_id === group?.id);
  const tree = unitGoalsTree(db, unit); const krs = unitKrs(db, unit);
  const nObj = db.objectives.filter(o => o.unit_id === unit && o.status !== 'Archived').length;
  return <Page title="Strategy" desc={`${u.name}'s strategic identity, pillars and goals, and how they are doing.`} help={<><p>The strategy is the starting point for everything else: pillars → strategic goals → objectives → key results → deliverables → weekly activities. Each pillar and goal shows its score for the period you choose (average of the objectives under it) and the status of its key results.</p><p>Function units such as HR and Supply Chain work directly to the Group strategy, so they show the Group's vision and mission and the Group pillars they serve.</p></>}>
    <Cmd right={<PeriodPicker value={p} onChange={setP} />} />
    <div className="ident">
      <div className="card"><h4>Vision</h4><div className="big">{st?.vision || '—'}</div>{!own && <p className="note">Group vision — {u.name} serves the Group strategy.</p>}</div>
      <div className="card"><h4>Mission</h4><div>{st?.mission || '—'}</div>{st?.period && <p className="note">Strategy period {st.period}</p>}</div>
    </div>
    {st?.intent && <div className="banner" style={{ marginTop: 12 }}><b>Intent</b> {st.intent}</div>}
    {(st?.values?.length || 0) > 0 && <div className="card" style={{ marginTop: 12 }}><div className="row"><h4 style={{ flex: 1 }}>Core values</h4>{can('editPlan') && <button className="btn sm" onClick={() => setEd(true)}>Edit identity</button>}</div><div className="vals">{st!.values.map((v: Row) => <div key={v.name}><b>{v.name}</b>{v.text && <span className="note">{v.text}</span>}</div>)}</div></div>}
    {!st?.values?.length && can('editPlan') && <div className="row" style={{ marginTop: 12 }}><button className="btn" onClick={() => setEd(true)}>Add vision, mission and values</button></div>}
    <div className="kpis" style={{ marginTop: 14 }}>
      <div className="tile"><div className="tv">{tree.length}</div><div className="tl">Pillars</div></div>
      <div className="tile"><div className="tv">{tree.reduce((s, t) => s + t.goals.length, 0)}</div><div className="tl">Strategic goals</div></div>
      <div className="tile"><div className="tv">{nObj}</div><div className="tl">Objectives</div><div className="ts">{krs.length} key results</div></div>
      <div className="tile"><div className="row"><Ring p={orgScore(db, unit, p)} size={46} /><div className="tl">{periodLabel(p)} score</div></div></div>
      <div className="tile" style={{ gridColumn: 'span 2' }}><div className="tl" style={{ marginBottom: 6 }}>Key results — {periodLabel(p)}</div><StatusStack counts={statusCounts(db, krs, p)} /></div>
    </div>
    <div className="sec-h"><h2>Pillars and goals</h2><Link to="/insights/map">Open the strategy map →</Link></div>
    <div className="pilgrid">{tree.map(({ p: pil, goals }) => <div key={pil.id} className="pilcard">
      <div className="ph"><Ring p={pillarScore(db, pil.id, p)} size={42} /><b>{pil.code} · {pil.name}</b></div>
      {pil.description && <div className="note">{pil.description}</div>}
      {pil.outcomes && <div className="mini"><b>Outcomes:</b> {pil.outcomes}</div>}
      {goals.map(g => { const gg = byId(db.group_goals, g.group_goal_id); const gks = topObjectives(db, g.id).flatMap(o => krsOf(db, o.id));
        return <div key={g.id} className="lg"><div className="row"><b style={{ flex: 1 }}>{g.code} {g.name}</b><span className="note">{pct(goalScore(db, g.id, p))}</span></div>
          {g.description && <div className="mini">{g.description}</div>}{gg && <div className="mini">↗ Group {gg.code} {gg.name}</div>}
          <div className="mini">{topObjectives(db, g.id).length} objectives · {gks.length} key results</div></div>; })}
    </div>)}</div>
    {!tree.length && <Empty>No pillars for this unit yet.</Empty>}
    {ed && <IdentityModal unit={own ? unit : (can('approve') ? unit : unit)} onClose={() => setEd(false)} />}
  </Page>;
}

/** The annual plan feeding the OKRs: revenue streams, cost of sales and budget lines linked to key results (₿). */
function PlanFeeds({ db, unit, p, onKr }: { db: DB; unit: string; p: Period; onKr: (id: string) => void }) {
  const links = db.kr_plan_links.map(l => ({ l, k: byId(db.key_results, l.kr_id) })).filter(x => x.k && x.k.state !== 'dropped' && unitOfObjective(db, x.k.objective_id) === unit);
  if (!links.length) return null;
  const SEC: Record<string, string> = { rev: 'Revenue plan', cos: 'Cost of sales', opex: 'Budget (cost saving)', capex: 'Capital budget' };
  return <section className="card" style={{ marginBottom: 12 }}><h3>Annual plan feeding the {periodLabel(p)} OKRs</h3><p className="mini" style={{ margin: '0 0 8px' }}>These key results are measured straight from the revenue plan and budget: when Finance records actuals, the key result, its objective and the goal above move with it.</p>
    <div className="tw"><table className="t"><thead><tr><th>From</th><th>Lines</th><th>Feeds key result</th><th>Objective</th><th className="n">Plan</th><th className="n">Actual</th><th>Status</th></tr></thead><tbody>
      {links.map(({ l, k }) => { const s = krState(db, k!, p); const o = byId(db.objectives, k!.objective_id);
        return <tr key={l.kr_id} className="click" onClick={() => onKr(k!.id)}><td><b>{SEC[l.section] || l.section}</b>{l.metric === 'quantity' && <div className="mini">quantity</div>}</td><td className="mini">{(l.line_groups || []).length ? (l.line_groups as string[]).join(', ') : 'All lines'}</td><td>{k!.title}</td><td className="mini">{o?.text}</td><td className="n">{fmt(s.target, 1)}</td><td className="n">{fmt(s.actual, 1)}</td><td><StatePill s={s} /></td></tr>; })}
    </tbody></table></div></section>;
}

export function GoalsMap() {
  const { db, unit } = useData(); const [kr, setKr] = useState<string | null>(null); const [p, setP] = usePeriod(); const [lvl, setLvl] = useState<'all' | 'off'>('all'); const [q, setQ] = useState('');
  if (!db || !unit) return <Page title="Strategy map"><Empty>No unit selected.</Empty></Page>;
  const tree = unitGoalsTree(db, unit); const loose = unlinked(db, unit);
  const hit = (o: Row): boolean => !q || o.text.toLowerCase().includes(q.toLowerCase()) || krsOf(db, o.id).some(k => k.title.toLowerCase().includes(q.toLowerCase())) || (byId(db.org_units, o.org_unit_id)?.name || '').toLowerCase().includes(q.toLowerCase()) || childObjectives(db, o.id).some(hit);
  const show = (o: Row) => (lvl === 'all' || (objState(db, o, p).tone === 'bad')) && hit(o);
  return <Page title="Strategy map" desc="Pillar → strategic goal → objectives → key results, with progress for the period you choose." help={<>
    <h3>Reading the map</h3><ul><li><b>Pillar</b> (black band) → the unit's own <b>strategic goal</b> (↗ shows the Group goal it serves) → <b>objectives</b> with their score ring → <b>key results</b>.</li>
      <li>Every figure is for the period chosen at the top — a month, quarter, half or the year — against that period's target, not the annual total.</li>
      <li>₿ from the annual plan · ✓ from deliverables · ↳ from the objectives below · ✎ checked in with evidence.</li>
      <li><b>Status is judged on pace.</b> Halfway through a quarter, a key result at 50% of its quarter target is on track. The rule is set in Settings → Rules.</li></ul></>}>
    <ViewTabs items={[['/insights/map', 'Strategy map', 'Pillar → goal → objectives → key results, with progress'], ['/insights/alignment', 'Cascade & owners', 'How objectives cascade, who owns each one and how much it contributes']]} />
    <Cmd right={<><input type="text" placeholder="Search objectives, key results, departments" value={q} onChange={e => setQ(e.target.value)} /><Seg value={lvl} options={[['all', 'All'], ['off', 'Off track only']]} onChange={setLvl} /><PeriodPicker value={p} onChange={setP} /></>} />
    {!tree.length && !loose.length && <Empty>No strategy or OKRs loaded for this unit yet.</Empty>}
    <PlanFeeds db={db} unit={unit} p={p} onKr={setKr} />
    {tree.map(({ p: pil, goals }) => <section className="pil" key={pil.id}>
      <div className="pilh">{pil.code} · {pil.name}<span className="sp" /><small>{pct(pillarScore(db, pil.id, p))}</small></div>
      {goals.map(g => { const os = topObjectives(db, g.id).filter(show); const gg = byId(db.group_goals, g.group_goal_id);
        return <div className="goal" key={g.id}><div className="goalh"><Ring p={goalScore(db, g.id, p)} size={34} />{g.code} {g.name}{gg && <span className="gg">↗ Group {gg.code} {gg.name}</span>}</div>
          {os.map(o => <ObjCard key={o.id} o={o} p={p} onKr={setKr} />)}{!os.length && <p className="note">{lvl === 'off' ? 'Nothing off track.' : 'No objectives yet.'}</p>}</div>; })}
    </section>)}
    {loose.length > 0 && <section className="pil"><div className="pilh" style={{ background: 'var(--warn)' }}>Not linked to a goal yet · {loose.length}</div>
      {loose.filter(show).map(o => <ObjCard key={o.id} o={o} p={p} onKr={setKr} />)}</section>}
    {kr && <KrDrawer id={kr} p={p} onClose={() => setKr(null)} />}
  </Page>;
}

export function GoalsQuarter() {
  const { db, unit, can } = useData(); const [kr, setKr] = useState<string | null>(null); const [lvl, setLvl] = useState<'unit' | 'all'>('all'); const [view, setView] = useState<'Q' | 'M'>('Q'); const [org, setOrg] = useState(''); const [q, setQ] = useState(''); const [mode, setMode] = useState<'follow' | 'edit'>('follow');
  if (!db || !unit) return null;
  const canEdit = can('editOKR') || can('approve');
  const sub = org ? subtreeIds(db, org) : null;
  const objs = db.objectives.filter(o => o.unit_id === unit && o.status !== 'Archived' && o.level !== 'individual' && (lvl === 'all' || o.level === 'unit') && (!sub || sub.has(o.org_unit_id)) && (!q || o.text.toLowerCase().includes(q.toLowerCase()) || krsOf(db, o.id).some(k => k.title.toLowerCase().includes(q.toLowerCase()))));
  const cols: Period[] = view === 'Q' ? [1, 2, 3, 4].map(n => ({ t: 'Q', n })) : Array.from({ length: 12 }, (_, i) => ({ t: 'M', n: i + 1 }));
  const help = <><h3>What this page is for</h3><p><b>Follow progress</b> is the scoreboard: every key result with its <b>actual / target</b> for each quarter or month, coloured by status (green on track, amber behind, red off track — judged on pace). Use it to spot which results are slipping and in which period. Click a row for its detail, check-ins and the deliverables and activities that drive it.</p>
    <p><b>Edit targets</b> lists the key results whose targets can be set; <b>Set targets</b> opens the objective builder for that key result, where you choose one annual, quarterly or monthly targets, how the months combine (adds up, average, latest level) and whether higher or lower is better. Once the OKR plan is approved, target changes go to Group Strategy as a change request (Studio → Rescope) instead of changing straight away.</p>
    <p>Not everything has an editable target: key results measured from the annual plan take theirs from the revenue plan or budget (change those through a rescope); key results scored from the objectives below have no target of their own. Actuals are not typed here — they come from check-ins (Work → Record → Key results), accepted deliverables, or Finance actuals.</p></>;
  if (mode === 'edit') return <Page title="Targets & progress" desc="Enter or correct the quarterly and monthly targets of the unit's key results." help={help}>
    <Cmd right={<><OrgFilter value={org} onChange={setOrg} /><Seg value={mode} options={[['follow', 'Follow progress'], ['edit', 'Edit targets']]} onChange={setMode} /></>} />
    <Targets unitId={unit} orgId={org || undefined} /></Page>;
  return <Page title="Targets & progress" desc="Every key result with its target and actual for each quarter or month — and where to change targets." help={help}>
    <Cmd right={<>{canEdit && <Seg value={mode} options={[['follow', 'Follow progress'], ['edit', 'Edit targets']]} onChange={setMode} />}<input type="text" placeholder="Search objectives or key results" value={q} onChange={e => setQ(e.target.value)} /><OrgFilter value={org} onChange={setOrg} /><Seg value={view} options={[['Q', 'Quarters'], ['M', 'Months']]} onChange={setView} /><Seg value={lvl} options={[['unit', 'Unit only'], ['all', 'All levels']]} onChange={setLvl} /></>} />
    <div className="tw"><table className="t"><thead><tr><th className="first">Objective / key result</th><th>Owner</th><th className="n">Year target</th>{cols.map(c => <th key={c.t + c.n} className="n">{periodLabel(c)}</th>)}<th>Year</th></tr></thead><tbody>
      {objs.map(o => [<tr key={o.id} className="g"><td className="first" colSpan={3 + cols.length}>{o.text}</td><td>{pct(objScore(db, o, { t: 'Y', n: 1 }))}</td></tr>,
        ...krsOf(db, o.id).map(k => { const ys = krState(db, k, { t: 'Y', n: 1 });
          return <tr key={k.id} className="click" onClick={() => setKr(k.id)}><td className="first ind">{MEASURE[k.measure]?.[0]} {k.title}</td><td>{posName(db, k.owner_position_id)}</td><td className="n">{fmt(ys.target, 1)} {k.uom}</td>
            {cols.map(c => { const s = krState(db, k, c); return <td key={c.t + c.n} className="n" style={{ background: s.tone === 'good' ? 'var(--good-soft)' : s.tone === 'warn' ? 'var(--warn-soft)' : s.tone === 'bad' ? 'var(--bad-soft)' : undefined }} title={s.label}>{s.actual == null && s.target == null ? '—' : `${fmt(s.actual, 1)} / ${fmt(s.target, 1)}`}</td>; })}
            <td><Bar p={ys.progress} /></td></tr>; })])}
    </tbody></table></div>
    {kr && <KrDrawer id={kr} onClose={() => setKr(null)} />}
  </Page>;
}

export function GroupView() {
  const { db, setUnit, can } = useData(); const save = useSave(); const [p, setP] = usePeriod(); if (!db) return null;
  const edit = can('approve');
  const pillars = db.group_pillars.slice().sort((a, b) => a.sort - b.sort); const st = db.strategy_statements.find(s => s.unit_id === db.org_units.find(x => x.kind === 'group')?.id);
  const ps = pillarShares(db);
  const gScore = (g: Row) => { const cs = contribShares(db, g.id); return weighted(Array.from(cs.entries()).map(([u, w]) => [w, goalScore(db, u.id, p)])); };
  const pScore = (pil: Row) => { const gs = goalShares(db, pil.id); return weighted(groupGoalsOf(db, pil.id).filter(g => db.unit_goals.some(u => u.group_goal_id === g.id)).map(g => [gs.get(g) || 0, gScore(g)])); };
  const put = (table: string, id: string, field: string, v: number | null) => save(() => sb.from(table).update({ [field]: v }).eq('id', id), [table], 'Weight saved');
  const sumSet = (rows: Row[], f: string) => rows.reduce((a, r) => a + (Number(r[f]) || 0), 0);
  const Total = ({ rows, f, what }: { rows: Row[]; f: string; what: string }) => { const set = rows.filter(r => r[f] != null); const t = sumSet(rows, f);
    return !set.length ? <span className="mini">{what}: equal shares (none set)</span> : <span className="mini">{what}: entered {fmt(t, 2)}%{set.length < rows.length ? ` · ${rows.length - set.length} not set share the rest` : ''} {set.length === rows.length && Math.round(t) !== 100 ? <Pill tone="warn">not 100% — shares are scaled</Pill> : Math.round(t) === 100 ? <Pill tone="good">100%</Pill> : null}</span>; };
  const { byUnit, served } = unitStrategyShares(db);
  const units = db.org_units.filter(u => u.kind === 'unit' && u.active !== false);
  const cat = (u: Row) => u.unit_type === 'business' ? 'Business units' : 'Corporate functions';
  return <Page title="Group view" desc="Group pillars and goals, the units that serve them, how much each contributes, and how they are doing." help={<>
    <p><b>Weights.</b> Each pillar has a share of the Group strategy; the goals in a pillar share it (they add up to 100%); and the units serving a Group goal share that goal (they add up to 100%). A weight left empty takes an equal share of what the set weights leave. Scores roll up with these weights.</p>
    <p><b>Contribution to the Group strategy</b> = pillar share × goal share × the unit's share of the goal, added over every goal the unit serves. It adds up to 100% over the goals that are served.</p>
    <p><b>Categories.</b> Business units plan their own pillars and goals, each linked to a Group goal. Corporate functions link their objectives straight to the Group goals.</p>
    <p>Links marked "to confirm" were proposed from the strategy documents. A Group goal no unit serves is flagged.</p></>}>
    <div className="cmdbar">{edit && <span className="note">You can edit the weights: type a number and leave the box.</span>}<span className="sp" /><PeriodPicker value={p} onChange={setP} /></div>
    {st && <div className="ident" style={{ marginBottom: 14 }}><div className="card"><h4>Group vision</h4><div className="big">{st.vision}</div></div><div className="card"><h4>Group mission</h4><div>{st.mission}</div></div></div>}
    <div className="pilgrid" style={{ marginBottom: 6 }}>{pillars.map(pil => { const gs = groupGoalsOf(db, pil.id); return <div key={pil.id} className="pilcard"><div className="ph"><Ring p={pScore(pil)} size={42} /><b>{pil.code} · {pil.name}</b></div>
      <div className="row"><span className="mini" style={{ flex: 1 }}>{gs.length} goals · {gs.filter(g => db.unit_goals.some(u => u.group_goal_id === g.id)).length} served</span><span className="mini">share of the strategy</span>{edit ? <NumIn w={64} value={pil.weight} onChange={v => put('group_pillars', pil.id, 'weight', v)} /> : null}<b>{fmt(ps.get(pil) || 0, 1)}%</b></div></div>; })}</div>
    <p style={{ marginBottom: 14 }}><Total rows={pillars} f="weight" what="Pillar weights" /></p>
    {pillars.map(pil => { const gs = groupGoalsOf(db, pil.id); const gsh = goalShares(db, pil.id); return <section className="pil" key={pil.id}><div className="pilh">{pil.code} · {pil.name} · {fmt(ps.get(pil) || 0, 1)}% of the Group strategy</div>
      <div className="tw" style={{ marginTop: 8 }}><table className="t"><thead><tr><th>Group goal</th><th className="n">Share of pillar</th><th>Served by · share of the goal</th><th>{periodLabel(p)}</th></tr></thead><tbody>
        {gs.map(g => { const ugs = db.unit_goals.filter(u => u.group_goal_id === g.id); const cs = contribShares(db, g.id);
          return <tr key={g.id}><td style={{ width: '28%' }}>{g.code} {g.name}</td>
            <td className="n" style={{ whiteSpace: 'nowrap' }}>{edit && <NumIn w={58} value={g.weight} onChange={v => put('group_goals', g.id, 'weight', v)} />} <b>{fmt(gsh.get(g) || 0, 1)}%</b></td>
            <td>{ugs.length ? <>{Array.from(new Set(ugs.map(u => u.unit_id))).map(uid => { const mine = ugs.filter(u => u.unit_id === uid); const sh = mine.reduce((a, u) => a + (cs.get(u) || 0), 0);
              const val = mine.every(u => u.contribution != null) ? mine.reduce((a, u) => a + Number(u.contribution), 0) : null;
              const setV = (v: number | null) => save(async () => { for (const u of mine) { const r = await sb.from('unit_goals').update({ contribution: v == null ? null : v / mine.length }).eq('id', u.id); if (r.error) return r; } return { error: null }; }, ['unit_goals'], 'Contribution saved');
              return <div key={uid} className="contrib">
              <span className="cw">{edit && <NumIn w={54} value={val == null ? null : Math.round(val * 100) / 100} onChange={setV} />}<b>{fmt(sh, 1)}%</b></span>
              <span className="cbar"><i style={{ width: sh + '%' }} /></span>
              <span className="cname"><Link to="/insights/map" onClick={() => setUnit(uid)}>{byId(db.org_units, uid)?.name}</Link>
                {mine.map(u => <div key={u.id} className="mini">{u.name}{!u.link_confirmed && <> <Pill tone="warn">to confirm</Pill></>} · {pct(goalScore(db, u.id, p))}</div>)}</span></div>; })}
              {new Set(ugs.map(u => u.unit_id)).size > 1 && <Total rows={Array.from(new Set(ugs.map(u => u.unit_id))).map(uid => { const m = ugs.filter(u => u.unit_id === uid); return { contribution: m.some(u => u.contribution != null) ? m.reduce((a, u) => a + (Number(u.contribution) || 0), 0) : null }; })} f="contribution" what="Unit shares" />}</> : <Pill tone="bad">No unit serving it</Pill>}</td>
            <td><Bar p={gScore(g)} /></td></tr>; })}
      </tbody></table></div><p style={{ margin: '4px 0 0' }}><Total rows={gs} f="weight" what="Goal weights in this pillar" /></p></section>; })}
    <section className="pil"><div className="pilh">Contribution of each unit to the Group strategy</div>
      <p className="note" style={{ margin: '8px 0' }}>Pillar share × goal share × unit share of the goal, added over the goals each unit serves. {served < 99.5 ? `Goals no unit serves hold ${fmt(100 - served, 1)}% of the strategy; the shares below are of the ${fmt(served, 1)}% that is served, scaled to 100%.` : ''}</p>
      <div className="tw"><table className="t"><thead><tr><th>Unit</th><th>Category</th><th className="n">Group goals served</th><th className="n">Contribution</th><th style={{ width: '30%' }} /></tr></thead><tbody>
        {['Business units', 'Corporate functions'].map(c => { const rows = units.filter(u => cat(u) === c).map(u => ({ u, v: served ? (byUnit.get(u.id) || 0) * 100 / served : 0, n: new Set(db.unit_goals.filter(g => g.unit_id === u.id && g.group_goal_id).map(g => g.group_goal_id)).size })).sort((a, b) => b.v - a.v);
          const tot = rows.reduce((a, r) => a + r.v, 0);
          return [<tr key={c} className="g"><td colSpan={3}><b>{c}</b></td><td className="n"><b>{fmt(tot, 1)}%</b></td><td /></tr>,
            ...rows.map(({ u, v, n }) => <tr key={u.id}><td className="ind"><Link to="/insights/map" onClick={() => setUnit(u.id)}>{u.name}</Link></td>
              <td>{edit ? <select value={u.unit_type || 'function'} onChange={e => save(() => sb.from('org_units').update({ unit_type: e.target.value }).eq('id', u.id), ['org_units'], 'Category saved')}><option value="business">Business unit</option><option value="function">Corporate function</option></select> : u.unit_type === 'business' ? 'Business unit' : 'Corporate function'}</td>
              <td className="n">{n || '—'}</td><td className="n">{v ? fmt(v, 1) + '%' : '—'}</td><td><span className="cbar"><i style={{ width: v + '%' }} /></span></td></tr>)]; })}
        <tr className="g"><td colSpan={3}><b>Total</b></td><td className="n"><b>{served ? '100%' : '—'}</b></td><td /></tr>
      </tbody></table></div></section>
    <p className="note">Months {MONTHS.join(' · ')} start on the Ethiopian month. Period months: {periodMonths(p).map(x => MONTHS[x - 1]).join(', ')}.</p>
  </Page>;
}

/** INSIGHTS — Key result follow-up: every key result with the deliverables and weekly activities that drive it. */
export function KrFollowUp() {
  const { db, unit } = useData(); const [p, setP] = usePeriod(); const [org, setOrg] = useState(''); const [q, setQ] = useState(''); const [show, setShow] = useState<'all' | 'linked' | 'none' | 'risk'>('all'); const [kr, setKr] = useState<string | null>(null);
  if (!db || !unit) return null;
  const sub = org ? subtreeIds(db, org) : null;
  const rows = db.objectives.filter(o => o.unit_id === unit && o.level !== 'individual' && o.status !== 'Archived' && (!sub || sub.has(o.org_unit_id)))
    .flatMap(o => krsOf(db, o.id).map(k => ({ k, o, s: krState(db, k, p), d: krDrivers(db, k.id) })))
    .filter(r => !q || (r.k.title + ' ' + r.o.text).toLowerCase().includes(q.toLowerCase()))
    .filter(r => show === 'all' || (show === 'linked' ? r.d.acts.length > 0 : show === 'none' ? !r.d.dels.length && !r.d.acts.length : r.d.stuck > 0 || r.s.tone === 'bad'));
  const linked = rows.filter(r => r.d.acts.length).length;
  return <Page title="Key result follow-up" desc="Each key result with the deliverables and weekly activities that drive it — see whether the work behind a result is moving." help={<>
    <p>Activities from the weekly plan link to a monthly deliverable, and the deliverable to a key result. This page rolls them up per key result: how many deliverables, how many weekly tasks, how many are done or blocked, and when the work was last updated.</p>
    <p>A key result with no linked work, or whose work is blocked, needs attention even if its number looks fine. Click a row for the full detail.</p></>}>
    <Cmd right={<><input type="text" placeholder="Search key results" value={q} onChange={e => setQ(e.target.value)} /><OrgFilter value={org} onChange={setOrg} /><Seg value={show} options={[['all', 'All'], ['linked', 'With work linked'], ['none', 'No work linked'], ['risk', 'At risk']]} onChange={setShow} /><PeriodPicker value={p} onChange={setP} /></>} />
    <div className="kpis"><div className="tile"><div className="tv">{rows.length}</div><div className="tl">Key results</div></div><div className="tile good"><div className="tv">{linked}</div><div className="tl">With weekly work linked</div></div><div className={'tile ' + (rows.length - linked ? 'warn' : '')}><div className="tv">{rows.length - linked}</div><div className="tl">No work linked yet</div></div><div className={'tile ' + (rows.some(r => r.d.stuck) ? 'bad' : '')}><div className="tv">{rows.reduce((a, r) => a + r.d.stuck, 0)}</div><div className="tl">Blocked / delayed tasks</div></div></div>
    {!rows.length ? <Empty>No key results match.</Empty> : <div className="tw"><table className="t"><thead><tr><th>Key result</th><th>Organisation</th><th>Status · {periodLabel(p)}</th><th className="n" data-tip="Deliverables linked: accepted / total">Deliverables</th><th className="n" data-tip="Weekly tasks linked (latest week of each): done / total">Weekly tasks</th><th data-tip="Average % complete of the linked weekly tasks">Work done</th><th className="n">Blocked</th><th>Last update</th></tr></thead><tbody>
      {rows.map(({ k, o, s, d }) => <tr key={k.id} className="click" onClick={() => setKr(k.id)}><td>{k.title}<div className="mini">{o.text}</div></td><td className="mini">{byId(db.org_units, o.org_unit_id)?.name}</td><td><StatePill s={s} /></td>
        <td className="n">{d.dels.length ? `${d.dels.filter(x => x.status === 'accepted').length}/${d.dels.length}` : '—'}</td><td className="n">{d.acts.length ? `${d.done}/${d.acts.length}` : '—'}</td><td>{d.acts.length ? <><Bar p={d.completion} /> {pct(d.completion)}</> : <span className="mini">no work linked</span>}</td>
        <td className={'n' + (d.stuck ? ' neg' : '')}>{d.stuck || ''}</td><td className="mini">{d.lastUpdate ? String(d.lastUpdate).slice(0, 10) : ''}</td></tr>)}
    </tbody></table></div>}
    {kr && <KrDrawer id={kr} p={p} onClose={() => setKr(null)} />}
  </Page>;
}
