import { useState } from 'react';
import { useData, useSave, byId, posName, type DB, type Row } from '../lib/data';
import { sb } from '../lib/supabase';
import { krProgress, objScore, statusOf, krsOf, childObjectives, lastCheckIn, currentQ, fmt, pct, MONTHS, qMonths, planBy, actualBy, money } from '../lib/calc';
import { Page, Cmd, Ring, Bar, Pill, Drawer, Empty, Seg } from '../lib/ui';

export const MEASURE: Record<string, [string, string]> = { plan: ['₿', 'From the annual plan'], deliverables: ['✓', 'From deliverables'], children: ['↳', 'From the objectives below'], manual: ['✎', 'Checked in with evidence'] };
const LVL: Record<string, string> = { unit: 'Unit', department: 'Department', division: 'Division' };

export function unitGoalsTree(db: DB, unit: string) {
  const pillars = db.unit_pillars.filter(p => p.unit_id === unit).sort((a, b) => a.sort - b.sort);
  return pillars.map(p => ({ p, goals: db.unit_goals.filter(g => g.pillar_id === p.id).sort((a, b) => a.sort - b.sort) }));
}
export const topObjectives = (db: DB, goalId: string) => db.objectives.filter(o => o.unit_goal_id === goalId).sort((a, b) => a.sort - b.sort);
export const unlinked = (db: DB, unit: string) => db.objectives.filter(o => o.unit_id === unit && !o.unit_goal_id && !o.parent_objective_id && !o.parent_kr_id);

export function KrRow({ k, onOpen }: { k: Row; onOpen: (id: string) => void }) {
  const { db } = useData(); if (!db) return null;
  const p = krProgress(db, k); const c = lastCheckIn(db, k.id); const [s, tone] = statusOf(p, k.confidence, db);
  return <div className="kr" onClick={() => onOpen(k.id)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpen(k.id); }}>
    <span className="ms" title={MEASURE[k.measure]?.[1]}>{MEASURE[k.measure]?.[0]}</span>
    <span>{k.title}<span className="note"> · {posName(db, k.owner_position_id)}</span></span>
    <span className="note hide-s">{k.measure === 'manual' && c ? `${fmt(Number(c.value), 1)} / ${fmt(Number(k.year_target), 1)} ${k.uom || ''}` : ''}</span>
    <span className="hide-s"><Bar p={p} /></span>
    <span className="hide-s"><Pill tone={tone}>{s}</Pill></span>
    <span className="w">{k.weight != null ? fmt(Number(k.weight)) + '%' : ''}</span>
  </div>;
}

export function ObjCard({ o, onKr, depth = 0, extra }: { o: Row; onKr: (id: string) => void; depth?: number; extra?: (o: Row) => React.ReactNode }) {
  const { db } = useData(); const [open, setOpen] = useState(depth < 1); if (!db) return null;
  const ks = krsOf(db, o.id); const kids = childObjectives(db, o.id).concat(db.objectives.filter(c => c.parent_kr_id && ks.some(k => k.id === c.parent_kr_id)));
  const org = byId(db.org_units, o.org_unit_id);
  return <div className="obj">
    <div className="objh"><Ring p={objScore(db, o)} size={40} />
      <div className="ot">{o.text}<div className="om"><span className="lvl">{LVL[o.level]}</span> {org?.name} · {posName(db, o.owner_position_id)}{o.weight_to_parent != null && (o.parent_objective_id || o.parent_kr_id) ? ` · weight ${fmt(Number(o.weight_to_parent))}%` : ''} · {o.status}</div></div>
      {extra?.(o)}
    </div>
    <div className="krl">{ks.map(k => <KrRow key={k.id} k={k} onOpen={onKr} />)}{!ks.length && !kids.length && <p className="note">No key results yet.</p>}</div>
    {kids.length > 0 && <div style={{ marginTop: 6 }}><button className="linkbtn" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} {kids.length} objective{kids.length > 1 ? 's' : ''} below</button>
      {open && <div className="kids">{kids.map(c => <ObjCard key={c.id} o={c} onKr={onKr} depth={depth + 1} extra={extra} />)}</div>}</div>}
  </div>;
}

export function KrDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { db, me, can, user } = useData(); const save = useSave();
  const [v, setV] = useState(''); const [conf, setConf] = useState('Medium'); const [note, setNote] = useState(''); const [cm, setCm] = useState('');
  if (!db) return null;
  const k = byId(db.key_results, id); if (!k) return null;
  const o = byId(db.objectives, k.objective_id);
  const p = krProgress(db, k); const [s, tone] = statusOf(p, k.confidence, db);
  const mayCheck = k.measure === 'manual' && (can('editOKR') || k.owner_position_id === me?.id);
  const hist = db.check_ins.filter(c => c.kr_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const comments = db.comments.filter(c => c.entity_type === 'kr' && c.entity_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const link = db.kr_plan_links.find(l => l.kr_id === id);
  const q = currentQ(db);
  return <Drawer title="Key result" onClose={onClose}>
    <div><b style={{ fontSize: 16 }}>{k.title}</b><div className="note">{o?.text}</div></div>
    <div className="row"><Pill tone={tone}>{s}</Pill><Bar p={p} /><b>{pct(p)}</b><span className="note">confidence {k.confidence || '—'} · weight {fmt(Number(k.weight))}%</span></div>
    <div className="g2">
      <div><h4>How it is measured</h4><div>{MEASURE[k.measure]?.[0]} {MEASURE[k.measure]?.[1]}</div>
        {link && <div className="note">{({ rev: 'Revenue', cos: 'Cost of sales', opex: 'Operating expenses', capex: 'Capital spending', proj: 'Projects' } as any)[link.section]} {link.metric} · {(link.line_groups || []).join(', ') || 'all lines'}</div>}</div>
      <div><h4>Target</h4><div>{fmt(Number(k.baseline), 1)} → {fmt(Number(k.year_target), 1)} {k.uom}</div><div className="note">Owner: {posName(db, k.owner_position_id)}</div></div>
    </div>
    {link && o && <div className="tw"><table className="t"><thead><tr><th>Quarter</th><th className="n">Plan</th><th className="n">Actual</th></tr></thead><tbody>
      {[1, 2, 3, 4].map(qq => { const pl = planBy(db, o.unit_id, link.section, qMonths(qq), link.line_groups, false, link.metric); const a = actualBy(db, o.unit_id, link.section, qMonths(qq), link.line_groups); return <tr key={qq}><td>Q{qq}</td><td className="n">{money(pl)}</td><td className="n">{money(a)}</td></tr>; })}
    </tbody></table></div>}
    {k.erp_kr_text && <div className="note">From the ERP: {k.erp_kr_text}</div>}
    {mayCheck && <div className="card stack"><h3>Check in</h3>
      <div className="g2"><label className="f">Value to date ({k.uom})<input type="text" inputMode="decimal" value={v} onChange={e => setV(e.target.value)} /></label>
        <label className="f">Confidence the target will be met<select value={conf} onChange={e => setConf(e.target.value)}><option>High</option><option>Medium</option><option>Low</option></select></label></div>
      <label className="f">What moved it, what is in the way<textarea rows={2} value={note} onChange={e => setNote(e.target.value)} /></label>
      <div className="row end"><button className="btn pri" disabled={v.trim() === '' || isNaN(Number(v))} onClick={async () => {
        const ok = await save(() => sb.from('check_ins').insert({ kr_id: id, quarter: q, value: Number(v), confidence: conf, note: note.trim() || null, created_by: user.id }), ['check_ins'], 'Check-in saved');
        if (ok) { await sb.from('key_results').update({ confidence: conf }).eq('id', id); setV(''); setNote(''); }
      }}>Save check-in</button></div></div>}
    <div><h4>Check-ins</h4>{hist.length ? hist.map(c => <div className="lg" key={c.id}><small>{c.created_at.slice(0, 10)} · Q{c.quarter} · confidence {c.confidence}</small><div><b>{fmt(Number(c.value), 1)}</b> {k.uom}{c.note ? ' — ' + c.note : ''}</div></div>) : <p className="note">{k.measure === 'manual' ? 'No check-ins yet.' : 'This key result updates itself.'}</p>}</div>
    <div><h4>Comments</h4>
      <div className="row"><textarea rows={2} value={cm} onChange={e => setCm(e.target.value)} placeholder="Ask, update or decide" /><button className="btn sm pri" disabled={!cm.trim()} onClick={async () => { if (await save(() => sb.from('comments').insert({ entity_type: 'kr', entity_id: id, body: cm.trim(), created_by: user.id }), ['comments'])) setCm(''); }}>Post</button></div>
      {comments.map(c => <div className="lg" key={c.id}><small>{c.created_at.slice(0, 16).replace('T', ' ')} · {db.profiles.find(p => p.id === c.created_by)?.full_name || 'someone'}</small><div>{c.body}</div></div>)}</div>
  </Drawer>;
}

export function GoalsMap() {
  const { db, unit } = useData(); const [kr, setKr] = useState<string | null>(null);
  if (!db || !unit) return <Page title="Strategy map"><Empty>No unit selected.</Empty></Page>;
  const tree = unitGoalsTree(db, unit); const loose = unlinked(db, unit);
  return <Page title="Strategy map" desc="Pillar → strategic goal → objectives → key results, with scores." help={<>
    <h3>Reading the map</h3><ul><li><b>Pillar</b> (black band) → the unit's own <b>strategic goal</b> (↗ shows the Group goal it serves) → <b>objectives</b> with their score ring → <b>key results</b>.</li>
      <li>The symbol at the start of a key result shows how it is measured: ₿ from the annual plan, ✓ from deliverables, ↳ from the objectives below, ✎ checked in with evidence.</li>
      <li>Status: On track at 95% or more · Behind from 70% to 95%, or when the owner's confidence is Low · Off track below 70%.</li>
      <li>"Show objectives below" opens the department and division objectives that deliver it, with their weights.</li></ul>
    <h3>Scores</h3><p>Objective score = Σ (key-result weight × progress, capped at 100%) ÷ Σ weights. An objective with no key results takes the weighted score of the objectives below it. Goal score = average of its objectives.</p>
    <p>Objectives brought over from the ERP keep their owner, weights and progress. Ones not yet linked to a goal are listed at the bottom so the unit can link them in Plan → OKR plan.</p></>}>
    <Cmd />
    {!tree.length && !loose.length && <Empty>No strategy or OKRs loaded for this unit yet.</Empty>}
    {tree.map(({ p, goals }) => <section className="pil" key={p.id}>
      <div className="pilh">{p.code} · {p.name}{p.description && <small>{p.description}</small>}</div>
      {goals.map(g => { const os = topObjectives(db, g.id); const gs = os.map(o => objScore(db, o)).filter(x => x != null) as number[]; const gg = byId(db.group_goals, g.group_goal_id);
        return <div className="goal" key={g.id}><div className="goalh"><Ring p={gs.length ? gs.reduce((a, b) => a + b, 0) / gs.length : null} size={34} />{g.code} {g.name}{gg && <span className="gg">↗ Group {gg.code} {gg.name}</span>}</div>
          {os.map(o => <ObjCard key={o.id} o={o} onKr={setKr} />)}{!os.length && <p className="note">No objectives yet.</p>}</div>; })}
    </section>)}
    {loose.length > 0 && <section className="pil"><div className="pilh" style={{ background: 'var(--warn)' }}>Not linked to a goal yet · {loose.length}</div>
      {loose.map(o => <ObjCard key={o.id} o={o} onKr={setKr} />)}</section>}
    {kr && <KrDrawer id={kr} onClose={() => setKr(null)} />}
  </Page>;
}

export function GoalsQuarter() {
  const { db, unit } = useData(); const [kr, setKr] = useState<string | null>(null); const [lvl, setLvl] = useState<'unit' | 'all'>('unit');
  if (!db || !unit) return null;
  const objs = db.objectives.filter(o => o.unit_id === unit && (lvl === 'all' || o.level === 'unit'));
  const q = currentQ(db);
  return <Page title="By quarter" desc="Every key result with its year target, quarter targets and status." help={<p>Each row is a key result. Quarter targets come from the OKR plan; key results measured from the annual plan take their quarter figures from the revenue plan or budget, so they move when the plan is rescoped. Click a row for its detail and check-ins.</p>}>
    <Cmd right={<Seg value={lvl} options={[['unit', 'Unit objectives'], ['all', 'All levels']]} onChange={setLvl} />} />
    <div className="tw"><table className="t"><thead><tr><th>Objective / key result</th><th>Owner</th><th className="n">Year target</th>{[1, 2, 3, 4].map(x => <th key={x} className="n">Q{x}{x === q ? ' (now)' : ''}</th>)}<th>Progress</th><th>Status</th></tr></thead><tbody>
      {objs.map(o => [<tr key={o.id} className="g"><td colSpan={8}>{o.text} <span className="note">· {pct(objScore(db, o))}</span></td></tr>,
        ...krsOf(db, o.id).map(k => { const p = krProgress(db, k); const [s, tone] = statusOf(p, k.confidence, db);
          return <tr key={k.id} className="click" onClick={() => setKr(k.id)}><td className="ind">{MEASURE[k.measure]?.[0]} {k.title}</td><td>{posName(db, k.owner_position_id)}</td><td className="n">{fmt(Number(k.year_target), 1)} {k.uom}</td>
            {[1, 2, 3, 4].map(x => { const t = db.kr_targets.find(t => t.kr_id === k.id && t.quarter === x); return <td key={x} className="n">{t ? fmt(Number(t.target), 1) : '—'}</td>; })}
            <td><Bar p={p} /></td><td><Pill tone={tone}>{s}</Pill></td></tr>; })])}
    </tbody></table></div>
    {kr && <KrDrawer id={kr} onClose={() => setKr(null)} />}
  </Page>;
}

export function GroupView() {
  const { db, setUnit } = useData(); if (!db) return null;
  const pillars = db.group_pillars.slice().sort((a, b) => a.sort - b.sort);
  return <Page title="Group view" desc="Each Group goal, the unit goals that serve it, and how they are doing." help={<p>For each Group goal: the unit goals linked to it and their scores (average of their objectives). A Group goal no pilot unit serves is flagged, so Group Strategy can assign it or pause it. Links marked "to confirm" were proposed from the strategy documents and should be confirmed with the unit.</p>}>
    {pillars.map(p => <section className="pil" key={p.id}><div className="pilh">{p.code} · {p.name}</div>
      <div className="tw" style={{ marginTop: 8 }}><table className="t"><thead><tr><th>Group goal</th><th>Served by</th><th>Score</th></tr></thead><tbody>
        {db.group_goals.filter(g => g.pillar_id === p.id).sort((a, b) => a.sort - b.sort).map(g => { const ugs = db.unit_goals.filter(u => u.group_goal_id === g.id);
          return <tr key={g.id}><td>{g.code} {g.name}</td><td>{ugs.length ? ugs.map(u => { const os = topObjectives(db, u.id); const sc = os.map(o => objScore(db, o)).filter(x => x != null) as number[];
            return <div key={u.id} className="row"><button className="linkbtn" onClick={() => setUnit(u.unit_id)}>{byId(db.org_units, u.unit_id)?.name}</button><span>{u.name}</span>{!u.link_confirmed && <Pill tone="warn">to confirm</Pill>}<span className="note">{pct(sc.length ? sc.reduce((a, b) => a + b, 0) / sc.length : null)}</span></div>; }) : <Pill tone="bad">No unit serving it</Pill>}</td>
            <td><Bar p={(() => { const v = ugs.flatMap(u => topObjectives(db, u.id).map(o => objScore(db, o))).filter(x => x != null) as number[]; return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; })()} /></td></tr>; })}
      </tbody></table></div></section>)}
    <p className="note">Months: {MONTHS.join(' · ')} (each starts on the Ethiopian month).</p>
  </Page>;
}
