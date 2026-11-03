/* STUDIO WINDOW — advanced, editable views: process monitor, strategy builder, scorecards, framework & rules, audit. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData, useSave, useTerms, byId, posName, ROLE_NAME, FRAMEWORKS, STUDIO_ITEMS, STUDIO_LABELS, WORK_PAGES, CAPS, type DB, type Row } from '../../lib/data';
import { sb } from '../../lib/supabase';
import { krsOf, krState, currentPeriod, subtreeIds, weekStart, ymd, workStats, delivScore, lastActualMonth, MONTHS, qOfMonth, curMonth, pct, fmt, krTarget, cutoffLabel } from '../../lib/calc';
import { Page, Cmd, Pill, Modal, Empty, Seg, NumIn, Bar, UnitPicker } from '../../lib/ui';
import { planStatus } from '../OkrPlan';
import { openRescope } from '../AnnualPlan';
import { proposeScorecard, ScorecardEditor } from '../work/Inbox';
import { IdentityModal } from '../Goals';
import { SettingsRules, ScoringRules } from '../Settings';

/* ---------- Process monitor (planning cycle and system health, like a submission monitor) ---------- */
type Cell = { v: string; tone: 'good' | 'warn' | 'bad' | 'none'; tip?: string };
const rag = (x: number | null, g = 0.8, w = 0.5): 'good' | 'warn' | 'bad' | 'none' => x == null ? 'none' : x >= g ? 'good' : x >= w ? 'warn' : 'bad';
function unitHealth(db: DB, u: Row): Record<string, Cell> {
  const ids = subtreeIds(db, u.id); const pos = db.positions.filter(x => ids.has(x.org_unit_id) && x.holder_name); const posIds = new Set(pos.map(x => x.id));
  const objs = db.objectives.filter(o => o.unit_id === u.id); const krs = objs.flatMap(o => krsOf(db, o.id)); const p = currentPeriod('Q');
  const okr = planStatus(db, u.id, 'okr')?.status || 'Draft'; const ann = planStatus(db, u.id, 'annual')?.status || 'Draft';
  const withKr = objs.filter(o => krsOf(db, o.id).length || db.objectives.some(c => c.parent_objective_id === o.id)).length;
  const withT = krs.filter(k => k.measure !== 'manual' || krTarget(db, k, p) != null).length;
  const man = krs.filter(k => k.measure === 'manual'); const fresh = man.filter(k => db.check_ins.some(c => c.kr_id === k.id && c.created_at > new Date(Date.now() - 30 * 864e5).toISOString())).length;
  const linkedUsers = pos.filter(x => x.user_id).length; const ws = workStats(db, posIds, ymd(weekStart(new Date(Date.now() - 7 * 864e5))));
  const dm = delivScore(db, posIds, { t: 'M', n: curMonth() }); const q = qOfMonth(curMonth());
  const cards = db.scorecards.filter(s => posIds.has(s.position_id) && s.quarter === q); const agreed = cards.filter(s => s.status === 'Agreed').length;
  const last = lastActualMonth(db, u.id); const hasPlan = db.plan_lines.some(l => l.unit_id === u.id);
  const pend = objs.filter(o => o.status === 'Submitted').length + db.deliverables.filter(d => posIds.has(d.owner_position_id) && d.status === 'done').length;
  const st = (s: string): Cell => ({ v: s, tone: s === 'Approved' ? 'good' : s === 'Submitted' || s === 'Endorsed' ? 'warn' : s === 'Returned' ? 'bad' : 'none' });
  return {
    okr: st(okr), annual: st(ann),
    struct: { v: objs.length ? pct(withKr / objs.length) : '—', tone: rag(objs.length ? withKr / objs.length : null), tip: `${withKr}/${objs.length} objectives have key results or objectives below` },
    targets: { v: krs.length ? pct(withT / krs.length) : '—', tone: rag(krs.length ? withT / krs.length : null), tip: `${withT}/${krs.length} key results have a Q${p.n} target` },
    checkins: { v: man.length ? pct(fresh / man.length) : '—', tone: rag(man.length ? fresh / man.length : null, .7, .3), tip: `${fresh}/${man.length} checked in within 30 days` },
    users: { v: `${linkedUsers}/${pos.length}`, tone: rag(pos.length ? linkedUsers / pos.length : null, .6, .2), tip: 'People with a linked sign-in' },
    weekly: { v: linkedUsers ? pct(ws.people / linkedUsers) : '—', tone: rag(linkedUsers ? ws.people / linkedUsers : null, .7, .4), tip: `${ws.people} people logged activities last week` },
    deliv: { v: dm.total ? `${dm.total}` : '0', tone: dm.total ? 'good' : 'warn', tip: `${MONTHS[curMonth() - 1]} deliverables planned` },
    cards: { v: pos.length ? `${agreed}/${pos.length}` : '—', tone: rag(pos.length ? agreed / pos.length : null, .8, .3), tip: `Q${q} scorecards agreed (${cards.length} prepared)` },
    actuals: { v: hasPlan ? (last ? MONTHS[last - 1] : 'none') : 'n/a', tone: !hasPlan ? 'none' : last >= curMonth() - 1 ? 'good' : last >= curMonth() - 2 ? 'warn' : 'bad', tip: 'Latest month with Finance actuals' },
    pending: { v: String(pend), tone: pend ? 'warn' : 'good', tip: 'Approvals waiting' },
    rescope: { v: openRescope(db, u.id) ? 'open' : '—', tone: openRescope(db, u.id) ? 'warn' : 'none' },
  };
}
const TIPS: Record<string, string> = { okr: 'Status of the unit OKR plan: Draft → Submitted → Approved.', annual: 'Annual plan: Draft → Submitted → Endorsed by Group Strategy → Approved by top management.', struct: 'Share of objectives that have key results or objectives below them.', targets: 'Share of key results with a target for the current quarter.', checkins: 'Share of check-in key results updated in the last 30 days.', users: 'People in the unit with a linked sign-in.', weekly: 'Share of signed-in people who logged activities last week.', deliv: 'Deliverables planned for the current month.', cards: 'Quarter scorecards agreed out of people in the unit.', actuals: 'Latest month covered by Finance actuals.', pending: 'Objectives and deliverables waiting for approval.', rescope: 'Whether a rescope is open.' };
export function Monitor() {
  const { db, setUnit } = useData(); const { t } = useTerms(); if (!db) return null;
  const units = db.org_units.filter(u => u.kind === 'unit' && u.pilot).sort((a, b) => a.sort - b.sort);
  const cols: [string, string][] = [['okr', `${t('objective')} plan`], ['annual', 'Annual plan'], ['struct', 'Structure'], ['targets', 'Targets set'], ['checkins', 'Check-ins fresh'], ['users', 'Signed in'], ['weekly', 'Weekly updates'], ['deliv', 'Deliverables'], ['cards', 'Scorecards'], ['actuals', 'Actuals to'], ['pending', 'Pending'], ['rescope', 'Rescope']];
  const H = units.map(u => ({ u, h: unitHealth(db, u) }));
  const claims = db.position_claims.filter(c => c.status === 'Pending').length; const users = db.positions.filter(p => p.user_id).length;
  const recent = db.check_ins.filter(c => c.created_at > new Date(Date.now() - 7 * 864e5).toISOString()).length; const acts7 = db.activities.filter(a => (a.updated_at || a.created_at) > new Date(Date.now() - 7 * 864e5).toISOString()).length;
  return <Page title="Process monitor" desc="Where each unit is in the planning cycle and how well the system is being used — the control room." help={<><p>Each row is a unit, each column a step of the cycle or a health signal. Green is healthy, amber needs attention, red is behind. Hover a cell for the detail; click a unit name to open it.</p>
    <ul><li><b>Structure</b> — objectives that have key results or objectives below them.</li><li><b>Targets set</b> — key results with a target for the current quarter.</li><li><b>Check-ins fresh</b> — manual key results updated in the last 30 days.</li><li><b>Weekly updates</b> — signed-in people who logged activities last week.</li><li><b>Scorecards</b> — quarter scorecards agreed.</li><li><b>Actuals to</b> — the latest month Finance actuals cover.</li></ul></>}>
    <div className="kpis"><div className="tile"><div className="tv">{users}</div><div className="tl">Linked sign-ins</div><div className="ts">of {db.positions.length} positions</div></div><div className={'tile ' + (claims ? 'warn' : '')}><div className="tv">{claims}</div><div className="tl">Sign-ins to confirm</div><div className="ts"><Link to="/studio/people">People & access →</Link></div></div>
      <div className="tile"><div className="tv">{recent}</div><div className="tl">Check-ins, last 7 days</div></div><div className="tile"><div className="tv">{acts7}</div><div className="tl">Activities touched, 7 days</div></div><div className="tile"><div className="tv">{db.notifications.length}</div><div className="tl">My notifications</div></div></div>
    <div className="tw"><table className="t monitor"><thead><tr><th>Unit</th>{cols.map(([k, l]) => <th key={k} data-tip={TIPS[k]}>{l}</th>)}</tr></thead><tbody>
      {H.map(({ u, h }) => <tr key={u.id}><td><Link to="/studio/okr" onClick={() => setUnit(u.id)}><b>{u.name}</b></Link><div className="mini">{u.revenue_model === 'project' ? 'Project business' : u.revenue_model === 'product' ? 'Product business' : 'Function'}</div></td>
        {cols.map(([k]) => <td key={k}><span className={'cell ' + h[k].tone} data-tip={h[k].tip}>{h[k].v}</span></td>)}</tr>)}
    </tbody></table></div>
    <h2 style={{ margin: '18px 0 8px' }}>Cycle steps</h2>
    <div className="cycle-steps">{[['Strategy', 'Pillars, goals, identity', '/studio/strategy'], [`${t('objective')} plan`, 'Objectives, key results, cascade, weights', '/studio/okr'], ['Annual plan', 'Revenue, budget, cash; two-step approval', '/studio/revenue'], ['Resources', 'Funds and the waterline', '/studio/resources'], ['Quarter', 'Targets, deliverables, scorecards', '/studio/scorecards'], ['Month & week', 'Deliverables, activities, check-ins', '/insights/people-work'], ['Review & rescope', 'Results, rescope, versions', '/studio/rescope']].map(([a, b, l], i) => <Link key={a} to={l} className="cstep"><i>{i + 1}</i><b>{a}</b><small>{b}</small></Link>)}</div>
  </Page>;
}

/* ---------- Strategy builder ---------- */
function PillarModal({ init, unit, group, onClose }: { init: Row; unit: string; group: boolean; onClose: () => void }) {
  const save = useSave(); const [f, setF] = useState<Row>(init); const tbl = group ? 'group_pillars' : 'unit_pillars';
  return <Modal title={f.id ? 'Edit pillar' : 'New pillar'} onClose={onClose}><div className="g2"><label className="f">Code<input type="text" value={f.code || ''} onChange={e => setF({ ...f, code: e.target.value })} /></label><label className="f">Name<input type="text" value={f.name || ''} onChange={e => setF({ ...f, name: e.target.value })} /></label></div>
    <label className="f">Description<textarea rows={3} value={f.description || ''} onChange={e => setF({ ...f, description: e.target.value })} /></label><label className="f">Strategic outcomes<textarea rows={2} value={f.outcomes || ''} onChange={e => setF({ ...f, outcomes: e.target.value })} /></label>
    <div className="row end">{f.id && <button className="btn danger" onClick={async () => { if (confirm('Delete this pillar and its goals?') && await save(() => sb.from(tbl).delete().eq('id', f.id), [tbl, group ? 'group_goals' : 'unit_goals'], 'Deleted')) onClose(); }}>Delete</button>}<span className="sp" /><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn pri" disabled={!f.name?.trim()} onClick={async () => { const row: Row = { code: f.code || null, name: f.name.trim(), description: f.description || null, outcomes: f.outcomes || null, sort: f.sort ?? 99 }; if (!group) row.unit_id = unit;
        if (await save(() => f.id ? sb.from(tbl).update(row).eq('id', f.id) : sb.from(tbl).insert(row), [tbl], 'Saved')) onClose(); }}>Save</button></div></Modal>;
}
export function GoalModal({ init, unit, group, onClose }: { init: Row; unit: string; group: boolean; onClose: () => void }) {
  const { db } = useData(); const save = useSave(); const [f, setF] = useState<Row>(init);
  const linked0 = db && init.id ? db.objectives.filter(o => o.unit_goal_id === init.id && o.status !== 'Archived').map(o => o.id) : [];
  const [objs, setObjs] = useState<string[]>(linked0); const [busy, setBusy] = useState(false);
  if (!db) return null; const tbl = group ? 'group_goals' : 'unit_goals';
  const unitPillars = group ? db.group_pillars : db.unit_pillars.filter(p => p.unit_id === unit);
  // a unit can also place a goal under a Group pillar it does not have yet — the pillar is added to the unit on save
  const groupOnly = group ? [] : db.group_pillars.filter(gp => !unitPillars.some(up => up.code === gp.code || up.name === gp.name));
  const siblings = (group ? db.group_goals : db.unit_goals).filter(g => g.pillar_id === f.pillar_id && g.id !== f.id);
  const wSum = siblings.reduce((s, g) => s + (Number(g.weight) || 0), 0) + (Number(f.weight) || 0);
  // objectives that can sit under a goal: the unit's top objectives (those not cascaded from an objective above)
  const candidates = group ? [] : db.objectives.filter(o => o.unit_id === unit && !o.parent_objective_id && !o.parent_kr_id && o.level !== 'individual' && o.status !== 'Archived');
  const gg = db.group_goals.slice().sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }));
  async function go() {
    setBusy(true); let pillar = f.pillar_id;
    if (pillar?.startsWith('gp:')) { const gp = byId(db!.group_pillars, pillar.slice(3))!; const r = await sb.from('unit_pillars').insert({ unit_id: unit, code: gp.code, name: gp.name, description: 'Group pillar', sort: gp.sort }).select('id').single(); if (r.error) { alert(r.error.message); setBusy(false); return; } pillar = r.data.id; }
    const row: Row = { pillar_id: pillar, code: f.code || null, name: f.name.trim(), description: f.description || null, weight: f.weight ?? null, sort: f.sort ?? 99 };
    if (!group) Object.assign(row, { unit_id: unit, group_goal_id: f.group_goal_id || null, link_confirmed: !!f.link_confirmed });
    const r = f.id ? await sb.from(tbl).update(row).eq('id', f.id).select('id').single() : await sb.from(tbl).insert(row).select('id').single();
    if (r.error) { alert(r.error.message); setBusy(false); return; }
    const gid = r.data.id;
    if (!group) { const add = objs.filter(id => !linked0.includes(id)), drop = linked0.filter(id => !objs.includes(id));
      if (add.length) await sb.from('objectives').update({ unit_goal_id: gid }).in('id', add); if (drop.length) await sb.from('objectives').update({ unit_goal_id: null }).in('id', drop); }
    const ok = await save(() => Promise.resolve({ error: null }) as any, [tbl, 'unit_pillars', 'objectives'], 'Saved'); setBusy(false); if (ok) onClose();
  }
  return <Modal title={f.id ? 'Edit goal' : 'New goal'} onClose={onClose} wide>
    <div className="g3"><label className="f">Pillar<select value={f.pillar_id || ''} onChange={e => setF({ ...f, pillar_id: e.target.value })}><option value="">Choose…</option>
        {unitPillars.length > 0 && <optgroup label={group ? 'Group pillars' : 'This unit\'s pillars'}>{unitPillars.slice().sort((a, b) => a.sort - b.sort).map(p => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</optgroup>}
        {groupOnly.length > 0 && <optgroup label="Group pillars (added to this unit)">{groupOnly.map(p => <option key={p.id} value={'gp:' + p.id}>{p.code} {p.name}</option>)}</optgroup>}</select></label>
      <label className="f">Code<input type="text" value={f.code || ''} onChange={e => setF({ ...f, code: e.target.value })} /></label>
      <label className="f" data-tip="This goal's share of its pillar's score. The goals under one pillar should add up to 100%; if none have a weight they count equally.">Weight in the pillar (%)<NumIn value={f.weight} onChange={v => setF({ ...f, weight: v })} />{f.pillar_id && !f.pillar_id.startsWith('gp:') && <span className={'mini' + (Math.round(wSum) !== 100 && wSum ? ' neg' : '')}>Pillar total with this goal: {Math.round(wSum)}%</span>}</label></div>
    <label className="f">Goal<input type="text" value={f.name || ''} onChange={e => setF({ ...f, name: e.target.value })} /></label><label className="f">Description / target statement<textarea rows={2} value={f.description || ''} onChange={e => setF({ ...f, description: e.target.value })} /></label>
    {!group && <div className="g2"><label className="f">Serves Group goal<select value={f.group_goal_id || ''} onChange={e => setF({ ...f, group_goal_id: e.target.value || null })}><option value="">—</option>{db.group_pillars.slice().sort((a, b) => a.sort - b.sort).map(gp => <optgroup key={gp.id} label={`${gp.code} · ${gp.name}`}>{gg.filter(g => g.pillar_id === gp.id).map(g => <option key={g.id} value={g.id}>{g.code} {g.name}</option>)}</optgroup>)}</select></label>
      <label className="row" style={{ marginTop: 22 }}><input type="checkbox" checked={!!f.link_confirmed} onChange={e => setF({ ...f, link_confirmed: e.target.checked })} /> Link confirmed with the unit</label></div>}
    {!group && <div className="card stack"><h3>Objectives that deliver this goal</h3><p className="note" style={{ margin: 0 }}>Tick the unit objectives that serve this goal. Objectives cascaded from another objective follow their parent and are not listed.</p>
      {!candidates.length ? <p className="note">No unit objectives yet.</p> : <div style={{ maxHeight: 220, overflow: 'auto' }}>{candidates.map(o => { const other = o.unit_goal_id && o.unit_goal_id !== f.id ? byId(db.unit_goals, o.unit_goal_id) : null;
        return <label key={o.id} className="row" style={{ gap: 8, padding: '3px 0', alignItems: 'flex-start', flexWrap: 'nowrap' }}><input type="checkbox" checked={objs.includes(o.id)} onChange={e => setObjs(e.target.checked ? [...objs, o.id] : objs.filter(x => x !== o.id))} /><span>{o.text}<span className="mini"> · {byId(db.org_units, o.org_unit_id)?.name}{other ? ` · now under ${other.code || ''} ${other.name}` : ''}</span></span></label>; })}</div>}</div>}
    <div className="row end">{f.id && <button className="btn danger" onClick={async () => { if (confirm('Delete this goal? Objectives linked to it become unlinked.') && await save(() => sb.from(tbl).delete().eq('id', f.id), [tbl, 'objectives'], 'Deleted')) onClose(); }}>Delete</button>}<span className="sp" /><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn pri" disabled={busy || !f.name?.trim() || !f.pillar_id} onClick={go}>{busy ? 'Saving…' : 'Save'}</button></div></Modal>;
}
export function StrategyBuilder() {
  const { db, unit, can } = useData(); const save0 = useSave(); const sbConfirm = (id: string) => save0(() => sb.from('unit_goals').update({ link_confirmed: true }).eq('id', id), ['unit_goals'], 'Link confirmed'); const { t } = useTerms(); const [scope, setScope] = useState<'unit' | 'group'>('unit'); const [pm, setPm] = useState<Row | null>(null); const [gm, setGm] = useState<Row | null>(null); const [idm, setIdm] = useState(false);
  if (!db || !unit) return null; const group = scope === 'group';
  const pillars = (group ? db.group_pillars : db.unit_pillars.filter(p => p.unit_id === unit)).slice().sort((a, b) => a.sort - b.sort);
  const goalsOf = (pid: string) => (group ? db.group_goals : db.unit_goals).filter(g => g.pillar_id === pid).sort((a, b) => a.sort - b.sort);
  const st = db.strategy_statements.find(s => s.unit_id === (group ? db.org_units.find(o => o.kind === 'group')?.id : unit));
  return <Page title="Strategy builder" desc={`Edit the strategic identity, ${t('pillar', true).toLowerCase()} and ${t('goal', true).toLowerCase()}, and link unit goals to Group goals.`} help={<><h3>What this page is for</h3><p>The unit's strategy: vision, mission and values, its <b>pillars</b>, and the <b>strategic goals</b> under each pillar. Click a goal to change its pillar, its weight in the pillar, the Group goal it serves, and the objectives that deliver it. A unit can put a goal under any Group pillar — the pillar is added to the unit when you save.</p><p><b>Weights</b>: the goals of one pillar should add up to 100%. The pillar's score is the weighted score of its goals.</p><p>"To confirm" marks links proposed from the strategy documents; Group Strategy confirms them with the unit.</p></>}>
    <Cmd right={<>{can('approve') && <Seg value={scope} options={[['unit', 'Unit strategy'], ['group', 'Group strategy']]} onChange={setScope} />}<button className="btn pri" onClick={() => setPm({})}>+ {t('pillar')}</button></>} />
    <div className="card"><div className="row"><h3 style={{ flex: 1 }}>Identity</h3><Link to="/insights/strategy">View →</Link></div><div className="mini"><b>Vision:</b> {st?.vision || '—'}</div><div className="mini"><b>Mission:</b> {st?.mission || '—'}</div><div className="mini"><b>Values:</b> {(st?.values || []).map((v: Row) => v.name).join(', ') || '—'}</div>{!group && <div className="row" style={{ marginTop: 6 }}><button className="btn sm" onClick={() => setIdm(true)}>Edit vision, mission and values</button></div>}</div>
    {pillars.map(p => { const gw = goalsOf(p.id).reduce((s0, g) => s0 + (Number(g.weight) || 0), 0); return <div key={p.id} className="card"><div className="row"><b style={{ flex: 1 }}>{p.code} · {p.name}</b>{goalsOf(p.id).length > 0 && <span className={'mini'} data-tip="Weights of the goals in this pillar. They should add up to 100%; with none set, goals count equally.">{gw ? <>goal weights {Math.round(gw)}%{Math.round(gw) !== 100 && <Pill tone="warn">not 100%</Pill>}</> : 'goals weighted equally'}</span>}<button className="btn sm" onClick={() => setGm({ pillar_id: p.id })}>+ {t('goal')}</button><button className="btn sm" onClick={() => setPm(p)}>Edit</button></div>
      {p.description && <div className="mini">{p.description}</div>}
      <div className="tw" style={{ marginTop: 8 }}><table className="t"><tbody>{goalsOf(p.id).map(g => <tr key={g.id} className="click" onClick={() => setGm(g)}><td style={{ width: 60 }}>{g.code}</td><td>{g.name}{g.description && <div className="mini">{g.description}</div>}</td><td className="n mini" style={{ width: 70 }} data-tip="Weight in the pillar">{g.weight != null ? fmt(Number(g.weight)) + '%' : '—'}</td>
        {!group && <td>{byId(db.group_goals, g.group_goal_id) ? <span className="mini">↗ {byId(db.group_goals, g.group_goal_id)?.name}</span> : <Pill tone="warn">no Group link</Pill>}{!group && !g.link_confirmed && g.group_goal_id && <span data-tip="Proposed from the strategy documents. Group Strategy confirms the link with the unit (button on the right)."><Pill tone="warn">to confirm</Pill></span>}</td>}
        <td className="n"><span data-tip={db.objectives.filter(o => o.unit_goal_id === g.id && o.status !== 'Archived').map(o => '• ' + o.text).join('\n') || 'No objectives yet'}>{db.objectives.filter(o => o.unit_goal_id === g.id && o.status !== 'Archived').length} objectives</span></td>
        {!group && g.group_goal_id && !g.link_confirmed && can('approve') && <td><button className="btn sm" onClick={e => { e.stopPropagation(); sbConfirm(g.id); }}>Confirm link</button></td>}</tr>)}</tbody></table></div></div>; })}
    {!pillars.length && <Empty>No {t('pillar', true).toLowerCase()} yet.</Empty>}
    {pm && <PillarModal init={pm} unit={unit} group={group} onClose={() => setPm(null)} />}
    {gm && <GoalModal init={gm} unit={unit} group={group} onClose={() => setGm(null)} />}
    {idm && <IdentityModal unit={unit} onClose={() => setIdm(false)} />}
  </Page>;
}

/* ---------- Scorecards (quarter agreements) ---------- */
export function Scorecards() {
  const { db, unit, user } = useData(); const save = useSave(); const [q, setQ] = useState(qOfMonth(curMonth())); const [ed, setEd] = useState<Row | null>(null); const [busy, setBusy] = useState(false);
  if (!db || !unit) return null;
  const pos = db.positions.filter(p => p.unit_id === unit && p.holder_name);
  const rows = pos.map(p => ({ p, sc: db.scorecards.find(s => s.position_id === p.id && s.quarter === q) }));
  const cnt = (s: string) => rows.filter(r => (r.sc?.status || 'None') === s).length;
  async function proposeAll() { setBusy(true); let n = 0, skipped = 0; for (const r of rows.filter(r => !r.sc)) { const x = await proposeScorecard(db!, r.p, q, user.id); if (x.error) skipped++; else n++; } await save(() => Promise.resolve({ error: null }) as any, ['scorecards', 'scorecard_items'], `${n} scorecards sent${skipped ? `, ${skipped} skipped (nothing planned yet)` : ''}`); setBusy(false); }
  return <Page title="Scorecards" desc="Quarter agreements: what each person is measured on, proposed by the manager and agreed by the person." help={<p>A scorecard lists the deliverables due in the quarter and the key results a person owns, with weights adding up to 100%. Once agreed, it becomes the personal part of the person's result. The person can ask to discuss; the manager adjusts and sends it again. Managers do this from their Inbox; this page shows the whole unit.</p>}>
    <Cmd right={<><Seg value={q} options={[1, 2, 3, 4].map(n => [n, 'Q' + n] as [number, string])} onChange={setQ} /><button className="btn pri" disabled={busy} onClick={proposeAll}>Prepare all missing</button></>} />
    <div className="kpis">{(['Agreed', 'Proposed', 'Discuss', 'Draft', 'None'] as const).map(s => <div key={s} className={'tile ' + (s === 'Agreed' ? 'good' : s === 'Discuss' ? 'warn' : '')}><div className="tv">{cnt(s)}</div><div className="tl">{s === 'None' ? 'Not prepared' : s}</div></div>)}</div>
    <div className="tw"><table className="t"><thead><tr><th>Person</th><th>Organisation</th><th>Status</th><th className="n">Items</th><th /></tr></thead><tbody>
      {rows.map(({ p, sc }) => <tr key={p.id}><td><b>{p.holder_name}</b><div className="mini">{p.title}</div></td><td>{byId(db.org_units, p.org_unit_id)?.name}</td><td>{sc ? <Pill tone={sc.status === 'Agreed' ? 'good' : sc.status === 'Discuss' ? 'warn' : 'info'}>{sc.status}</Pill> : <span className="note">not prepared</span>}{sc?.person_note && <div className="mini">“{sc.person_note}”</div>}</td>
        <td className="n">{sc ? db.scorecard_items.filter(i => i.scorecard_id === sc.id).length : ''}</td>
        <td><div className="row" style={{ justifyContent: 'flex-end' }}>{sc && <button className="btn sm" onClick={() => setEd(sc)}>Edit</button>}<button className="btn sm" onClick={async () => { const x = await proposeScorecard(db, p, q, user.id); if (x.error) alert(x.error); else await save(() => Promise.resolve({ error: null }) as any, ['scorecards', 'scorecard_items'], 'Sent'); }}>{sc ? 'Rebuild & resend' : 'Prepare'}</button></div></td></tr>)}
    </tbody></table></div>
    {ed && <ScorecardEditor sc={ed} onClose={() => setEd(null)} />}
  </Page>;
}

/* ---------- Framework, windows and rules ---------- */
export function Framework() {
  const { db, can, user } = useData(); const save = useSave(); const [tab, setTab] = useState(() => new URLSearchParams(location.search).get('tab') || 'framework'); if (!db) return null;
  const f = db.settings.framework || { type: 'okr', labels: {} }; const w = db.settings.windows || {}; const req = db.settings.framework_request || {};
  const items = { ...STUDIO_ITEMS, ...(db.settings.studio_items || {}) } as Record<string, string[]>; const wr = db.settings.work_rules || {}; const tax = db.settings.tax_rate || { rate: 30 };
  const cal = db.settings.calendar || {}; const cur = db.settings.current || {}; const ap = db.settings.approvals || {}; const nt = db.settings.notify || {}; const mods = db.settings.modules || {}; const wp = db.settings.work_pages || {}; const ae = db.settings.actuals_entry || {};
  const put = (key: string, value: any, msg = 'Saved') => save(() => sb.from('app_settings').upsert({ key, value }), ['app_settings'], msg);
  const base = (FRAMEWORKS[f.type] || FRAMEWORKS.okr).labels; const roles = Object.keys(ROLE_NAME).filter(r => r !== 'none');
  const toggle = (win: string, r: string) => { const cur: string[] = w[win] || []; put('windows', { ...w, [win]: cur.includes(r) ? cur.filter(x => x !== r) : [...cur, r] }); };
  const toggleItem = (k: string, r: string) => { const cur = items[k] || []; put('studio_items', { ...items, [k]: cur.includes(r) ? cur.filter(x => x !== r) : [...cur, r] }); };
  const toggleWork = (k: string, r: string) => { const cur: string[] = wp[k] || roles; put('work_pages', { ...wp, [k]: cur.includes(r) ? cur.filter(x => x !== r) : [...cur, r] }); };
  const aeRoles: string[] = ae.roles || ['super_admin', 'group_strategy', 'finance', 'planning_head', 'unit_head'];
  const yearStart = curMonth() === 1;
  const Mx = ({ rows, has, on }: { rows: [string, string][]; has: (k: string, r: string) => boolean; on: (k: string, r: string) => void }) => <div className="tw"><table className="t"><thead><tr><th />{roles.map(r => <th key={r} style={{ fontSize: 11 }}>{ROLE_NAME[r as keyof typeof ROLE_NAME]}</th>)}</tr></thead><tbody>{rows.map(([k, l]) => <tr key={k}><td><b>{l}</b></td>{roles.map(r => <td key={r} style={{ textAlign: 'center' }}><input type="checkbox" checked={has(k, r)} onChange={() => on(k, r)} disabled={r === 'super_admin' && (k === 'studio_admin')} /></td>)}</tr>)}</tbody></table></div>;
  const Sw = ({ label, on, set, tip }: { label: string; on: boolean; set: (v: boolean) => void; tip?: string }) => <label className="row" style={{ gap: 8 }} data-tip={tip}><input type="checkbox" checked={on} onChange={e => set(e.target.checked)} />{label}</label>;
  const TABS: [string, string][] = [['framework', 'Framework & terms'], ['scoring', 'Scoring'], ['cycle', 'Cycle & work rules'], ['access', 'Access'], ['approvals', 'Approvals & notifications'], ['modules', 'Modules']];
  return <Page title="Configuration" desc="Everything that shapes how planning and performance work: the framework, scoring, the cycle, who can do what, approvals, notifications and optional modules." help={<p>Changes apply straight away for everyone. Every change is in the audit log and can be undone there.</p>}>
    <div className="tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
    {tab === 'framework' && <div className="card stack"><h2>Planning framework</h2>
      <div className="g3">{Object.entries(FRAMEWORKS).map(([k, F]) => <button key={k} className={'kind' + (f.type === k ? ' on' : '')} disabled={f.type === k} onClick={() => { if (yearStart && can('finalApprove')) put('framework', { type: k, labels: {} }); else put('framework_request', { type: k, by: user.id, at: new Date().toISOString(), status: 'Pending' }, 'Change requested — top management must approve; it takes effect at the start of the next fiscal year'); }}><b>{F.name}</b><small>{Object.values(F.labels).slice(0, 4).join(' → ')}</small></button>)}</div>
      {req.status === 'Pending' && <div className="banner warn">Requested change to <b>{FRAMEWORKS[req.type]?.name}</b> on {String(req.at).slice(0, 10)} — waiting for top management.{can('finalApprove') && <> <button className="btn sm pri" onClick={async () => { await put('framework_request', { ...req, status: 'Approved', approved_at: new Date().toISOString() }); if (yearStart) await put('framework', { type: req.type, labels: {} }); }}>Approve</button> <button className="btn sm" onClick={() => put('framework_request', { ...req, status: 'Rejected' })}>Reject</button></>}</div>}
      {req.status === 'Approved' && !yearStart && <div className="banner">Approved: switches to {FRAMEWORKS[req.type]?.name} at the start of the next fiscal year.</div>}
      <p className="note">The framework can only change at the start of a fiscal year, with top management approval, so a year is planned and scored one way. Renaming the terms below is allowed any time.</p>
      <div className="g3">{Object.keys(base).map(k => <label key={k} className="f">{k.replace('_', ' ')}<input type="text" defaultValue={(f.labels || {})[k] || base[k]} onBlur={e => { const v = e.target.value.trim(); if (v && v !== ((f.labels || {})[k] || base[k])) put('framework', { ...f, labels: { ...(f.labels || {}), [k]: v } }); }} /></label>)}</div></div>}
    {tab === 'scoring' && <><ScoringRules /><SettingsRules /></>}
    {tab === 'cycle' && <><div className="card stack"><h2>Calendar</h2><div className="g4">
        <label className="f">Current quarter<select value={cur.quarter} onChange={e => put('current', { ...cur, quarter: Number(e.target.value) })}>{[1, 2, 3, 4].map(q => <option key={q} value={q}>Q{q}</option>)}</select></label>
        <label className="f" data-tip="Weeks run Saturday to Friday. The cut-off is the deadline to update the week.">Weekly cut-off day<select value={cal.cutoffDay ?? 7} onChange={e => put('calendar', { ...cal, cutoffDay: Number(e.target.value) })}>{[[5, 'Thursday'], [6, 'Friday'], [7, 'Saturday (after the week)'], [8, 'Sunday'], [9, 'Monday']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="f">Cut-off hour (0–23)<NumIn value={cal.cutoffHour ?? 14} onChange={v => v != null && v >= 0 && v <= 23 && put('calendar', { ...cal, cutoffHour: v })} /></label>
        <label className="f">Month closes on day<NumIn value={cal.monthClose ?? 9} onChange={v => v != null && v >= 1 && v <= 28 && put('calendar', { ...cal, monthClose: v })} /></label></div>
        <p className="note">Fiscal year starts 8 July; months start on the Ethiopian month; weeks run Saturday–Friday. Current cut-off: <b>{cutoffLabel()}</b>.</p></div>
      <div className="card stack"><h2>Work rules</h2><div className="g3">
        <label className="f">Who plans weekly activities<select value={wr.activities || 'both'} onChange={e => put('work_rules', { ...wr, activities: e.target.value })}><option value="members">Team members plan their own</option><option value="managers">Managers plan for their team</option><option value="both">Both</option></select></label>
        <label className="f">Monthly deliverables can be changed<select value={wr.deliverable_lock || 'month_start'} onChange={e => put('work_rules', { ...wr, deliverable_lock: e.target.value })}><option value="month_start">Until the month starts (heads any time)</option><option value="open">Any time</option></select></label>
        <label className="f">A person's deliverable weights in a month<select value={wr.weights || 'warn'} onChange={e => put('work_rules', { ...wr, weights: e.target.value })}><option value="warn">Warn when not 100%</option><option value="block">Must be 100% to save</option><option value="off">No check</option></select></label>
        <label className="f">Team members may propose deliverables<select value={wr.propose === false ? 'no' : 'yes'} onChange={e => put('work_rules', { ...wr, propose: e.target.value === 'yes' })}><option value="yes">Yes — the manager confirms</option><option value="no">No — managers plan them</option></select></label>
        <label className="f">Top priorities per week (★)<NumIn value={wr.top_max ?? 3} onChange={v => v != null && put('work_rules', { ...wr, top_max: v })} /></label>
        <label className="f">Profit tax rate for the income statement (%)<NumIn value={tax.rate} onChange={v => v != null && put('tax_rate', { ...tax, rate: v })} /></label></div></div></>}
    {tab === 'access' && <><div className="card"><h2>Windows</h2><p className="note">Everyone has the Work window. Everyone else gets a personal Insights pane (My insights and the Strategic plan — switch it off under Modules). Insights — full is the whole picture for leaders; Studio is where plans are built; Studio admin adds configuration, people, import, backup and audit.</p>
        <Mx rows={[['insights', 'Insights — full'], ['studio', 'Studio'], ['studio_admin', 'Studio admin']]} has={(k, r) => (w[k] || []).includes(r)} on={toggle} /></div>
      <div className="card"><h2>Work pages</h2><p className="note">Turn a Work page off for a role to keep their window simpler. Today is always on.</p>
        <Mx rows={Object.entries(WORK_PAGES)} has={(k, r) => !wp[k] || (wp[k] as string[]).includes(r)} on={toggleWork} /></div>
      <div className="card"><h2>Studio pages</h2><p className="note">Leaders only see their own unit's data. Changes to an approved plan by anyone other than Group Strategy go through a change request.</p>
        <Mx rows={Object.keys(STUDIO_ITEMS).map(k => [k, STUDIO_LABELS[k]] as [string, string])} has={(k, r) => (items[k] || []).includes(r)} on={toggleItem} /></div>
      <div className="card stack"><h2>Who enters financial actuals</h2><p className="note">By role, plus everyone in the organisations you pick (for example the Finance department's team members). They get Work → Record → Financial actuals.</p>
        <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>{roles.map(r => <Sw key={r} label={ROLE_NAME[r as keyof typeof ROLE_NAME]} on={aeRoles.includes(r)} set={v => put('actuals_entry', { ...ae, roles: v ? [...aeRoles, r] : aeRoles.filter(x => x !== r) })} />)}</div>
        <label className="f" style={{ maxWidth: 520 }}>Add an organisation<select value="" onChange={e => e.target.value && put('actuals_entry', { ...ae, org_unit_ids: Array.from(new Set([...(ae.org_unit_ids || []), e.target.value])) })}><option value="">Choose…</option>{db.org_units.filter(o => o.kind !== 'group').sort((a, b) => a.name.localeCompare(b.name)).map(o => <option key={o.id} value={o.id}>{o.name} · {byId(db.org_units, o.unit_id)?.name}</option>)}</select></label>
        <div className="row" style={{ flexWrap: 'wrap' }}>{(ae.org_unit_ids || []).map((id: string) => <Pill key={id}>{byId(db.org_units, id)?.name} <button className="linkbtn" onClick={() => put('actuals_entry', { ...ae, org_unit_ids: (ae.org_unit_ids || []).filter((x: string) => x !== id) })}>×</button></Pill>)}</div></div>
      <div className="card"><h2>What each role can do (database rules)</h2><div className="tw"><table className="t"><thead><tr><th>Can</th>{roles.map(r => <th key={r} style={{ fontSize: 11 }}>{ROLE_NAME[r as keyof typeof ROLE_NAME]}</th>)}</tr></thead><tbody>
        {Object.entries({ seeGroup: 'See every unit', editOKR: 'Edit OKRs', editPlan: 'Edit the annual plan', approve: 'Approve plans', finalApprove: 'Final approval', managePeople: 'Accept deliverables', reports: 'See reports', settings: 'Change configuration' }).map(([k, l]) => <tr key={k}><td>{l}</td>{roles.map(r => <td key={r} style={{ textAlign: 'center' }}>{CAPS[k].includes(r as any) ? '✓' : ''}</td>)}</tr>)}
      </tbody></table></div><p className="note">These are enforced by the database. Pages and windows above decide what each role sees; the database decides what they can save.</p></div></>}
    {tab === 'approvals' && <><div className="card stack"><h2>Approvals</h2>
        <Sw label="Target changes after the OKR plan is approved go to Group Strategy for approval" on={ap.target_changes !== false} set={v => put('approvals', { ...ap, target_changes: v })} />
        <Sw label="Deliverables count only once the manager accepts them" on={ap.accept_deliverables !== false} set={v => put('approvals', { ...ap, accept_deliverables: v })} tip="Off: a deliverable counts as soon as the owner marks it delivered." />
        <Sw label="Quarter scorecards must be agreed by the person" on={ap.scorecard_agree !== false} set={v => put('approvals', { ...ap, scorecard_agree: v })} />
        <Sw label="Changes to the approved annual plan go through a rescope" on={ap.rescope !== false} set={v => put('approvals', { ...ap, rescope: v })} /></div>
      <div className="card stack"><h2>Notifications</h2><p className="note">Who gets told what. Turning one off stops that notification for everyone.</p><div className="g3">
        {Object.entries({ blocker: 'Stuck activity → manager and helping unit', deliverable: 'Deliverable delivered / proposed → manager', week: 'Week summary or month plan submitted → manager', feedback: 'Manager feedback → person', scorecard: 'Scorecard ready / agreed / discuss', okr: 'Objective approved or returned', replan: 'ERP replan requests', message: 'Direct messages' }).map(([k, l]) => <Sw key={k} label={l} on={nt[k] !== false} set={v => put('notify', { ...nt, [k]: v })} />)}</div></div></>}
    {tab === 'modules' && <div className="card stack"><h2>Optional modules</h2><p className="note">Modules add department-specific features. Turning one off hides it everywhere; its data is kept.</p>
      {[['member_insights', 'Insights pane for team members', 'A personal Insights window for roles without full Insights: My insights and the Strategic plan.'], ['projects', 'Project portfolio (PMO)', 'Studio → Project portfolio for PMO; Insights → Projects for leaders.'], ['weekly_cash', 'Weekly cash flow', 'Record → Financial actuals → weekly cash; Reports → Weekly cash.'], ['erp_replan', 'ERP OKR replan', 'Replan campaign for deliverables brought over from personal ERP OKRs.'], ['messages', 'Messages', 'Direct messages in the Inbox.']].map(([k, l, d]) => <div key={k} className="row" style={{ gap: 10 }}><Sw label={l} on={mods[k]?.enabled !== false} set={v => put('modules', { ...mods, [k]: { ...(mods[k] || {}), enabled: v } })} /><span className="mini">{d}</span></div>)}</div>}
  </Page>;
}

/* ---------- Audit log ---------- */
export function Audit() {
  const { db } = useData(); const [rows, setRows] = useState<Row[]>([]); const [tbl, setTbl] = useState(''); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let q = sb.from('audit_log').select('*').order('at', { ascending: false }).limit(300); if (tbl) q = q.eq('table_name', tbl); q.then(({ data, error }) => { if (error) setErr(error.message); else setRows(data || []); }); }, [tbl]);
  if (!db) return null;
  const who = (u: string) => db.profiles.find(p => p.id === u)?.full_name || db.profiles.find(p => p.id === u)?.email || 'system';
  const label = (r: Row) => { const d = r.new_data || r.old_data || {}; return d.text || d.title || d.name || d.holder_name || d.item || d.status || r.row_id; };
  const diff = (r: Row) => { if (r.action !== 'UPDATE' || !r.old_data || !r.new_data) return ''; return Object.keys(r.new_data).filter(k => !['updated_at', 'created_at'].includes(k) && JSON.stringify(r.new_data[k]) !== JSON.stringify(r.old_data[k])).slice(0, 4).map(k => `${k}: ${String(JSON.stringify(r.old_data[k])).slice(0, 30)} → ${String(JSON.stringify(r.new_data[k])).slice(0, 30)}`).join(' · '); };
  const save = useSave();
  async function undo(r: Row, redo = false) {
    const snap = redo ? r.new_data : r.old_data; let error: any = null;
    if (!redo && r.action === 'INSERT') ({ error } = await sb.from(r.table_name).delete().eq('id', r.row_id));
    else if (redo && r.action === 'DELETE') ({ error } = await sb.from(r.table_name).delete().eq('id', r.row_id));
    else if (snap) ({ error } = await sb.rpc('restore_row', { tbl: r.table_name, r: snap }));
    await save(() => Promise.resolve({ error }) as any, [r.table_name], error ? undefined : redo ? 'Redone' : 'Undone'); setTbl(x => x);
  }
  return <Page title="Audit log" desc="Every change to objectives, key results, plans, approvals, scorecards and positions — who, when, what — with undo and redo." help={<p><b>Undo</b> puts a row back exactly as it was before that change (an added row is removed, a deleted row comes back). <b>Redo</b> re-applies the change. Undo and redo are themselves recorded here.</p>}>
    <Cmd right={<select value={tbl} onChange={e => setTbl(e.target.value)} aria-label="Table"><option value="">All tables</option>{['objectives', 'key_results', 'plan_lines', 'plan_status', 'rescopes', 'scorecards', 'positions', 'unit_goals', 'unit_pillars', 'deliverables'].map(t => <option key={t}>{t}</option>)}</select>} />
    {err ? <div className="banner bad">{err}</div> : !rows.length ? <Empty>No changes recorded yet.</Empty> : <div className="tw"><table className="t"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Item</th><th>Change</th><th /></tr></thead><tbody>
      {rows.map(r => <tr key={r.id}><td className="mini">{String(r.at).slice(0, 16).replace('T', ' ')}</td><td>{who(r.by_user)}</td><td><Pill tone={r.action === 'DELETE' ? 'bad' : r.action === 'INSERT' ? 'good' : 'none'}>{r.action.toLowerCase()}</Pill> <span className="mini">{r.table_name}</span></td><td>{String(label(r)).slice(0, 80)}</td><td className="mini">{diff(r)}</td>
        <td>{r.table_name !== 'plan_status' && <div className="row" style={{ flexWrap: 'nowrap' }}><button className="btn sm" onClick={() => undo(r)}>Undo</button><button className="btn sm" onClick={() => undo(r, true)}>Redo</button></div>}</td></tr>)}
    </tbody></table></div>}
  </Page>;
}
