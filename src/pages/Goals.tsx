import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useData, useSave, byId, posName, type DB, type Row } from '../lib/data';
import { sb } from '../lib/supabase';
import { krState, objScore, objState, krsOf, childObjectives, fmt, pct, MONTHS, periodLabel, periodMonths, krTarget, krActual, monthlyValues, curMonth, qOfMonth, AGG_NAME, DIR_NAME, currentPeriod, orgScore, avg, type Period } from '../lib/calc';
import { Page, Cmd, Ring, Bar, Pill, Drawer, Empty, Seg, PeriodPicker, usePeriod, StatusStack, Modal, StatePill } from '../lib/ui';

export const MEASURE: Record<string, [string, string]> = { plan: ['₿', 'From the annual plan'], deliverables: ['✓', 'From deliverables'], children: ['↳', 'From the objectives below'], manual: ['✎', 'Checked in with evidence'] };
const LVL: Record<string, string> = { unit: 'Unit', department: 'Department', division: 'Division' };

export function unitGoalsTree(db: DB, unit: string) {
  const pillars = db.unit_pillars.filter(p => p.unit_id === unit).sort((a, b) => a.sort - b.sort);
  return pillars.map(p => ({ p, goals: db.unit_goals.filter(g => g.pillar_id === p.id).sort((a, b) => a.sort - b.sort) }));
}
export const topObjectives = (db: DB, goalId: string) => db.objectives.filter(o => o.unit_goal_id === goalId).sort((a, b) => a.sort - b.sort);
export const unlinked = (db: DB, unit: string) => db.objectives.filter(o => o.unit_id === unit && !o.unit_goal_id && !o.parent_objective_id && !o.parent_kr_id);
/** All objectives under a goal, at every level (for goal and pillar scores). */
export function goalScore(db: DB, goalId: string, p: Period) { return avg(topObjectives(db, goalId).map(o => objScore(db, o, p))); }
export function pillarScore(db: DB, pillarId: string, p: Period) { return avg(db.unit_goals.filter(g => g.pillar_id === pillarId).map(g => goalScore(db, g.id, p))); }
export function statusCounts(db: DB, krs: Row[], p: Period) {
  const c: Record<string, number> = { 'On track': 0, Behind: 0, 'Off track': 0, 'No update': 0, other: 0 };
  krs.forEach(k => { const s = krState(db, k, p).label; if (s in c) c[s]++; else c.other++; });
  return [{ label: 'On track', n: c['On track'], tone: 'good' }, { label: 'Behind', n: c.Behind, tone: 'warn' }, { label: 'Off track', n: c['Off track'], tone: 'bad' }, { label: 'No update / too early', n: c['No update'] + c.other, tone: 'none' }];
}
export const unitKrs = (db: DB, unit: string) => db.objectives.filter(o => o.unit_id === unit).flatMap(o => krsOf(db, o.id));

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
  const ks = krsOf(db, o.id); const kids = childObjectives(db, o.id).concat(db.objectives.filter(c => c.parent_kr_id && ks.some(k => k.id === c.parent_kr_id)));
  const org = byId(db.org_units, o.org_unit_id); const st = objState(db, o, p);
  return <div className="obj">
    <div className="objh"><Ring p={objScore(db, o, p)} size={40} />
      <div className="ot">{o.text}<div className="om"><span className="lvl">{LVL[o.level]}</span> {org?.name} · {posName(db, o.owner_position_id)}{o.weight_to_parent != null && (o.parent_objective_id || o.parent_kr_id) ? ` · weight ${fmt(Number(o.weight_to_parent))}%` : ''} · {o.status}</div></div>
      <StatePill s={st} />{extra?.(o)}
    </div>
    <div className="krl">{ks.map(k => <KrRow key={k.id} k={k} p={p} onOpen={onKr} />)}{!ks.length && !kids.length && <p className="note">No key results yet.</p>}</div>
    {kids.length > 0 && <div style={{ marginTop: 6 }}><button className="linkbtn" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} {kids.length} objective{kids.length > 1 ? 's' : ''} below</button>
      {open && <div className="kids">{kids.map(c => <ObjCard key={c.id} o={c} p={p} onKr={onKr} depth={depth + 1} extra={extra} />)}</div>}</div>}
  </div>;
}

/** Key-result detail: targets and actuals by month and quarter, check-in, history, comments. */
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
function IdentityModal({ unit, onClose }: { unit: string; onClose: () => void }) {
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
  const nObj = db.objectives.filter(o => o.unit_id === unit).length;
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

export function GoalsMap() {
  const { db, unit } = useData(); const [kr, setKr] = useState<string | null>(null); const [p, setP] = usePeriod(); const [lvl, setLvl] = useState<'all' | 'off'>('all');
  if (!db || !unit) return <Page title="Strategy map"><Empty>No unit selected.</Empty></Page>;
  const tree = unitGoalsTree(db, unit); const loose = unlinked(db, unit);
  const show = (o: Row) => lvl === 'all' || (objState(db, o, p).tone === 'bad');
  return <Page title="Strategy map" desc="Pillar → strategic goal → objectives → key results, with progress for the period you choose." help={<>
    <h3>Reading the map</h3><ul><li><b>Pillar</b> (black band) → the unit's own <b>strategic goal</b> (↗ shows the Group goal it serves) → <b>objectives</b> with their score ring → <b>key results</b>.</li>
      <li>Every figure is for the period chosen at the top — a month, quarter, half or the year — against that period's target, not the annual total.</li>
      <li>₿ from the annual plan · ✓ from deliverables · ↳ from the objectives below · ✎ checked in with evidence.</li>
      <li><b>Status is judged on pace.</b> Halfway through a quarter, a key result at 50% of its quarter target is on track. The rule is set in Settings → Rules.</li></ul></>}>
    <Cmd right={<><Seg value={lvl} options={[['all', 'All'], ['off', 'Off track only']]} onChange={setLvl} /><PeriodPicker value={p} onChange={setP} /></>} />
    {!tree.length && !loose.length && <Empty>No strategy or OKRs loaded for this unit yet.</Empty>}
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
  const { db, unit } = useData(); const [kr, setKr] = useState<string | null>(null); const [lvl, setLvl] = useState<'unit' | 'all'>('unit'); const [view, setView] = useState<'Q' | 'M'>('Q');
  if (!db || !unit) return null;
  const objs = db.objectives.filter(o => o.unit_id === unit && (lvl === 'all' || o.level === 'unit'));
  const cols: Period[] = view === 'Q' ? [1, 2, 3, 4].map(n => ({ t: 'Q', n })) : Array.from({ length: 12 }, (_, i) => ({ t: 'M', n: i + 1 }));
  return <Page title="Targets & progress" desc="Every key result with its target and actual for each quarter or month." help={<p>Each cell shows actual / target for that period, coloured by status. Targets come from the OKR plan (annual, quarterly or monthly entry); key results measured from the annual plan take theirs from the revenue plan or budget. Click a row for detail and check-ins.</p>}>
    <Cmd right={<><Seg value={view} options={[['Q', 'Quarters'], ['M', 'Months']]} onChange={setView} /><Seg value={lvl} options={[['unit', 'Unit objectives'], ['all', 'All levels']]} onChange={setLvl} /></>} />
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
  const { db, setUnit } = useData(); const [p, setP] = usePeriod(); if (!db) return null;
  const pillars = db.group_pillars.slice().sort((a, b) => a.sort - b.sort); const st = db.strategy_statements.find(s => s.unit_id === db.org_units.find(x => x.kind === 'group')?.id);
  const gScore = (g: Row) => avg(db.unit_goals.filter(u => u.group_goal_id === g.id).map(u => goalScore(db, u.id, p)));
  return <Page title="Group view" desc="Group pillars and goals, the unit goals that serve them, and how they are doing." help={<p>For each Group goal: the unit goals linked to it and their scores for the period. A Group goal no unit serves is flagged so Group Strategy can assign it or pause it. Links marked "to confirm" were proposed from the strategy documents.</p>}>
    <div className="cmdbar"><span className="sp" /><PeriodPicker value={p} onChange={setP} /></div>
    {st && <div className="ident" style={{ marginBottom: 14 }}><div className="card"><h4>Group vision</h4><div className="big">{st.vision}</div></div><div className="card"><h4>Group mission</h4><div>{st.mission}</div></div></div>}
    <div className="pilgrid" style={{ marginBottom: 16 }}>{pillars.map(pil => { const gs = db.group_goals.filter(g => g.pillar_id === pil.id); return <div key={pil.id} className="pilcard"><div className="ph"><Ring p={avg(gs.map(gScore))} size={42} /><b>{pil.code} · {pil.name}</b></div>{pil.description && <div className="note">{pil.description}</div>}<div className="mini">{gs.length} goals · {gs.filter(g => db.unit_goals.some(u => u.group_goal_id === g.id)).length} served by a unit</div></div>; })}</div>
    {pillars.map(pil => <section className="pil" key={pil.id}><div className="pilh">{pil.code} · {pil.name}</div>
      <div className="tw" style={{ marginTop: 8 }}><table className="t"><thead><tr><th>Group goal</th><th>Served by</th><th>{periodLabel(p)}</th></tr></thead><tbody>
        {db.group_goals.filter(g => g.pillar_id === pil.id).sort((a, b) => a.sort - b.sort).map(g => { const ugs = db.unit_goals.filter(u => u.group_goal_id === g.id);
          return <tr key={g.id}><td>{g.code} {g.name}</td><td>{ugs.length ? ugs.map(u => <div key={u.id} className="row"><Link to="/insights/map" onClick={() => setUnit(u.unit_id)}>{byId(db.org_units, u.unit_id)?.name}</Link><span>{u.name}</span>{!u.link_confirmed && <Pill tone="warn">to confirm</Pill>}<span className="note">{pct(goalScore(db, u.id, p))}</span></div>) : <Pill tone="bad">No unit serving it</Pill>}</td>
            <td><Bar p={gScore(g)} /></td></tr>; })}
      </tbody></table></div></section>)}
    <p className="note">Months {MONTHS.join(' · ')} start on the Ethiopian month. Period months: {periodMonths(p).map(x => MONTHS[x - 1]).join(', ')}.</p>
  </Page>;
}
