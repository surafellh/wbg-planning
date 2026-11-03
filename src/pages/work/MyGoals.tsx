/* WORK WINDOW — My goals: only what the person owns, simple updates, and a guided "new objective" flow. */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData, useSave, useTerms, byId, posName, notifyPositions, managerOf, type DB, type Row } from '../../lib/data';
import { sb } from '../../lib/supabase';
import { krState, objScore, krsOf, currentPeriod, periodLabel, pct, fmt, curMonth, qOfMonth, MONTHS, type Period } from '../../lib/calc';
import { HowItWorks, Bar, Pill, Modal, NumIn, StatePill, Empty } from '../../lib/ui';
import { Thread } from '../../lib/social';

const KIND: Record<string, { label: string; hint: string; aggregation: string; direction: string }> = {
  count: { label: 'Count up to a number', hint: 'e.g. 120 transformers produced, 4 trainings held', aggregation: 'sum', direction: 'increase' },
  level: { label: 'Reach a level', hint: 'e.g. on-time delivery up to 95%, competency 80%', aggregation: 'latest', direction: 'increase' },
  reduce: { label: 'Bring down to', hint: 'e.g. defects down to 1%, downtime under 3 days', aggregation: 'latest', direction: 'decrease' },
  keep: { label: 'Keep at a level', hint: 'e.g. stock accuracy kept at 98%', aggregation: 'average', direction: 'maintain' },
  done: { label: 'Get something done', hint: 'e.g. ISO certificate obtained, policy approved', aggregation: 'latest', direction: 'increase' },
};
const kindOf = (k: Row) => k.uom === 'done' ? 'done' : k.direction === 'decrease' ? 'reduce' : k.direction === 'maintain' ? 'keep' : k.aggregation === 'sum' ? 'count' : 'level';

/** One-screen update for a key result: the number now, confidence, a note. */
export function UpdateSheet({ k, onClose }: { k: Row; onClose: () => void }) {
  const { db, user } = useData(); const save = useSave(); const [v, setV] = useState<number | null>(null); const [conf, setConf] = useState(k.confidence || 'Medium'); const [note, setNote] = useState(''); const [m] = useState(curMonth());
  if (!db) return null; const s = krState(db, k, currentPeriod('Q')); const kind = kindOf(k);
  const q = kind === 'count' ? `How many in ${MONTHS[m - 1]}?` : kind === 'done' ? 'Is it done?' : 'Where is it now?';
  return <Modal title="Update" onClose={onClose}>
    <div><b style={{ fontSize: 17 }}>{k.title}</b><div className="note">{periodLabel(currentPeriod('Q'))} target {fmt(s.target, 1)} {k.uom !== 'done' ? k.uom || '' : ''} · so far {fmt(s.actual, 1)}</div></div>
    {kind === 'done' ? <div className="row"><button className={'btn big' + (v === 1 ? ' pri' : '')} onClick={() => setV(1)}>Yes, done</button><button className={'btn big' + (v === 0 ? ' pri' : '')} onClick={() => setV(0)}>Not yet</button></div>
      : <label className="f big">{q}<NumIn value={v} onChange={setV} w={180} /></label>}
    <div className="f"><span>How confident are you about the target?</span><div className="row">{[['High', '🙂 On course'], ['Medium', '😐 Some risk'], ['Low', '🙁 Unlikely']].map(([c, l]) => <button key={c} className={'btn' + (conf === c ? ' pri' : '')} onClick={() => setConf(c)}>{l}</button>)}</div></div>
    <label className="f">What happened? (optional)<textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="What moved it, what is in the way" /></label>
    <div className="row end"><button className="btn" onClick={onClose}>Cancel</button><button className="btn pri" disabled={v == null} onClick={async () => {
      if (await save(() => sb.from('check_ins').insert({ kr_id: k.id, month: m, quarter: qOfMonth(m), value: v, confidence: conf, note: note.trim() || null, created_by: user.id }), ['check_ins'], 'Updated')) { await sb.from('key_results').update({ confidence: conf }).eq('id', k.id); onClose(); } }}>Save update</button></div>
  </Modal>;
}

function GoalCard({ o, p, mine }: { o: Row; p: Period; mine: boolean }) {
  const { db, user } = useData(); const save = useSave(); const { t } = useTerms(); const nav = useNavigate(); const [upd, setUpd] = useState<Row | null>(null); const [talk, setTalk] = useState(false);
  if (!db) return null; const ks = krsOf(db, o.id); const sc = objScore(db, o, p);
  const parent = byId(db.objectives, o.parent_objective_id) || byId(db.objectives, byId(db.key_results, o.parent_kr_id)?.objective_id); const goal = byId(db.unit_goals, o.unit_goal_id);
  const editable = mine && o.status !== 'Approved';
  return <div className="goalcard">
    <div className="row"><b style={{ flex: 1, fontSize: 15.5 }}>{o.text}</b>{o.status !== 'Approved' && <Pill tone={o.status === 'Returned' ? 'bad' : o.status === 'Submitted' ? 'info' : 'none'}>{o.status === 'Submitted' ? 'Waiting for approval' : o.status}</Pill>}<span className="big-pct">{pct(sc)}</span></div>
    <div className="mini">{parent ? `Supports: ${parent.text}` : goal ? `Supports: ${goal.name}` : 'Not linked yet'}{o.review_note && o.status === 'Returned' ? ` · Note from your manager: ${o.review_note}` : ''}</div>
    <Bar p={sc} />
    <div className="stack" style={{ gap: 2, marginTop: 6 }}>{ks.map(k => { const s = krState(db, k, p); return <div key={k.id} className="krline">
      <span style={{ flex: 1 }}>{k.title}<div className="mini">{fmt(s.actual, 1)} of {fmt(s.target, 1)} {k.uom === 'done' ? '' : k.uom || ''} · {periodLabel(p)}</div></span><StatePill s={s} />
      {k.measure === 'manual' && (k.owner_position_id === o.owner_position_id || mine) && <button className="btn sm pri" onClick={() => setUpd(k)}>Update</button>}</div>; })}
      {!ks.length && <p className="note">No {t('key_result', true).toLowerCase()} yet.</p>}</div>
    <div className="row" style={{ marginTop: 8 }}>
      {editable && <button className="btn sm" onClick={() => nav('/goals/new?edit=' + o.id)}>Edit</button>}
      {editable && o.status !== 'Submitted' && <button className="btn sm pri" onClick={async () => { const me = byId(db.positions, o.owner_position_id); if (await save(() => sb.from('objectives').update({ status: 'Submitted', submitted_at: new Date().toISOString() }).eq('id', o.id), ['objectives'], 'Sent for approval')) await notifyPositions(db, [me && managerOf(db, me)?.id], 'okr', `${me?.holder_name} submitted an ${t('objective').toLowerCase()} for approval: ${o.text}`, '/inbox'); }}>Submit for approval</button>}
      <button className="linkbtn" onClick={() => setTalk(!talk)}>{talk ? 'Hide comments' : `Comments (${db.comments.filter(c => c.entity_type === 'objective' && c.entity_id === o.id).length})`}</button>
      {editable && o.status === 'Draft' && <><span className="sp" /><button className="linkbtn" style={{ color: 'var(--bad)' }} onClick={() => { if (confirm('Delete this draft?')) save(() => sb.from('objectives').delete().eq('id', o.id), ['objectives', 'key_results'], 'Deleted'); }}>Delete draft</button></>}
    </div>
    {talk && <div style={{ marginTop: 8 }}><Thread entity="objective" id={o.id} link="/goals" title={o.text} /></div>}
    {upd && <UpdateSheet k={upd} onClose={() => setUpd(null)} />}
    {user && null}
  </div>;
}

export function MyGoals() {
  const { db, me } = useData(); const { t } = useTerms(); const [showTeam, setShowTeam] = useState(false); if (!db || !me) return null;
  const p = currentPeriod('Q');
  const mine = db.objectives.filter(o => o.owner_position_id === me.id);
  const elsewhere = db.key_results.filter(k => k.owner_position_id === me.id && !mine.some(o => o.id === k.objective_id));
  const parents = new Set(mine.map(o => o.parent_objective_id).filter(Boolean)); const myOrgObjs = db.objectives.filter(o => (o.org_unit_id === me.org_unit_id || parents.has(o.id)) && o.level !== 'individual' && o.owner_position_id !== me.id);
  const need = [...mine.flatMap(o => krsOf(db, o.id)), ...elsewhere].filter(k => k.measure === 'manual' && !db.check_ins.some(c => c.kr_id === k.id && c.created_at > new Date(Date.now() - 30 * 864e5).toISOString())).length;
  return <div className="light">
    <div className="lhead"><div><h1>My {t('objective', true).toLowerCase()}</h1><p>{periodLabel(p)} · {mine.length} {t('objective', mine.length !== 1).toLowerCase()}{need ? ` · ${need} to update` : ''}<HowItWorks><h3>What this page is for</h3><p>Personal objectives you set with your manager, if your organisation uses them. Organisation objectives are planned in Studio → Objective planner; your day-to-day contribution is through deliverables and weekly activities.</p></HowItWorks></p></div><Link className="btn pri big" to="/goals/new">+ New {t('objective').toLowerCase()}</Link></div>
    {!mine.length && !elsewhere.length && <Empty>You have no {t('objective', true).toLowerCase()} yet. Start with "New {t('objective').toLowerCase()}" — it takes about two minutes.</Empty>}
    <div className="stack">{mine.map(o => <GoalCard key={o.id} o={o} p={p} mine />)}</div>
    {elsewhere.length > 0 && <><h3 className="lsub">{t('key_result', true)} you own in others' {t('objective', true).toLowerCase()}</h3>
      <div className="goalcard">{elsewhere.map(k => <KrOnly key={k.id} k={k} p={p} />)}</div></>}
    {myOrgObjs.length > 0 && <><button className="linkbtn lsub" onClick={() => setShowTeam(!showTeam)}>{showTeam ? 'Hide' : 'Show'} what my team is working toward ({myOrgObjs.length})</button>
      {showTeam && <div className="stack">{myOrgObjs.map(o => <GoalCard key={o.id} o={o} p={p} mine={false} />)}</div>}</>}
  </div>;
}
function KrOnly({ k, p }: { k: Row; p: Period }) {
  const { db } = useData(); const [u, setU] = useState(false); if (!db) return null; const s = krState(db, k, p);
  return <div className="krline"><span style={{ flex: 1 }}>{k.title}<div className="mini">{byId(db.objectives, k.objective_id)?.text} · {fmt(s.actual, 1)} of {fmt(s.target, 1)}</div></span><StatePill s={s} />{k.measure === 'manual' && <button className="btn sm pri" onClick={() => setU(true)}>Update</button>}{u && <UpdateSheet k={k} onClose={() => setU(false)} />}</div>;
}

/* ---------------- guided new objective ---------------- */
type KrDraft = { id?: string; title: string; kind: string; base: number | null; target: number | null; uom: string; when: 'quarter' | 'year'; weight?: number | null };
export function NewObjective() {
  const { db, me, role, user } = useData(); const save = useSave(); const { t } = useTerms(); const nav = useNavigate();
  const editId = new URLSearchParams(location.search).get('edit'); const ex = editId && db ? byId(db.objectives, editId) : null;
  const [step, setStep] = useState(1);
  const [sup, setSup] = useState<string>(ex ? (ex.parent_kr_id ? 'k:' + ex.parent_kr_id : ex.parent_objective_id ? 'o:' + ex.parent_objective_id : ex.unit_goal_id ? 'g:' + ex.unit_goal_id : '') : '');
  const [text, setText] = useState(ex?.text || ''); const [q, setQ] = useState('');
  const [krs, setKrs] = useState<KrDraft[]>(() => ex && db ? krsOf(db, ex.id).map(k => ({ id: k.id, title: k.title, kind: kindOf(k), base: k.baseline, target: k.target_mode === 'quarterly' ? Number(db.kr_targets.find(x => x.kr_id === k.id && x.quarter === qOfMonth(curMonth()))?.target ?? k.year_target) : k.year_target, uom: k.uom === 'done' ? '' : k.uom || '', when: k.target_mode === 'quarterly' ? 'quarter' : 'year', weight: k.weight })) : [{ title: '', kind: 'count', base: null, target: null, uom: '', when: 'quarter' }]);
  if (!db || !me) return null;
  const isHead = role !== 'employee'; const cq = qOfMonth(curMonth());
  // What can it support? My org's objectives and key results, the level above, and (for heads) the unit's strategic goals.
  const orgIds = new Set<string>(); let o = byId(db.org_units, me.org_unit_id); let depth = 0; while (o && depth < 3) { orgIds.add(o.id); o = byId(db.org_units, o.parent_id); depth++; }
  const cands = db.objectives.filter(x => orgIds.has(x.org_unit_id) && x.level !== 'individual' && x.id !== editId).filter(x => !q || x.text.toLowerCase().includes(q.toLowerCase()));
  const goals = isHead ? db.unit_goals.filter(g => g.unit_id === me.unit_id) : [];
  const supLabel = (() => { const [k, id] = sup.split(':'); if (k === 'o') return byId(db.objectives, id)?.text; if (k === 'k') return byId(db.key_results, id)?.title; if (k === 'g') return byId(db.unit_goals, id)?.name; return null; })();
  const valid2 = text.trim().length > 5; const valid3 = krs.length > 0 && krs.every(k => k.title.trim() && (k.kind === 'done' || k.target != null));
  const setK = (i: number, patch: Partial<KrDraft>) => setKrs(krs.map((k, j) => j === i ? { ...k, ...patch } : k));
  async function finish(submit: boolean) {
    const [kk, sid] = sup.split(':'); const org = byId(db!.org_units, me!.org_unit_id);
    const level = role === 'employee' ? 'individual' : org?.kind === 'unit' ? 'unit' : org?.kind === 'division' ? 'division' : 'department';
    const row: Row = { unit_id: me!.unit_id, org_unit_id: me!.org_unit_id, level, text: text.trim(), owner_position_id: me!.id, unit_goal_id: kk === 'g' ? sid : null, parent_objective_id: kk === 'o' ? sid : null, parent_kr_id: kk === 'k' ? sid : null, status: submit ? 'Submitted' : 'Draft', submitted_at: submit ? new Date().toISOString() : null, origin: 'app' };
    const r = ex ? await sb.from('objectives').update(row).eq('id', ex.id).select('id').single() : await sb.from('objectives').insert(row).select('id').single();
    if (r.error) { alert(r.error.message); return; }
    const oid = r.data.id; const w = Math.round(100 / krs.length * 100) / 100;
    const keep = new Set(krs.map(k => k.id).filter(Boolean)); if (ex) for (const k of krsOf(db!, ex.id)) if (!keep.has(k.id)) await sb.from('key_results').delete().eq('id', k.id);
    for (const [i, k] of krs.entries()) {
      const K = KIND[k.kind]; const target = k.kind === 'done' ? 1 : k.target;
      const kr: Row = { objective_id: oid, title: k.title.trim(), uom: k.kind === 'done' ? 'done' : k.uom || null, aggregation: K.aggregation, direction: K.direction, kr_type: K.aggregation === 'sum' ? 'cumulative' : 'level', lower_is_better: K.direction === 'decrease', baseline: k.kind === 'done' ? 0 : k.base, year_target: target, target_mode: k.when === 'quarter' ? 'quarterly' : 'annual', weight: k.weight ?? w, measure: 'manual', owner_position_id: me!.id, sort: i };
      const kr2 = k.id ? await sb.from('key_results').update(kr).eq('id', k.id).select('id').single() : await sb.from('key_results').insert(kr).select('id').single();
      if (kr2.error) { alert(kr2.error.message); return; }
      await sb.from('kr_targets').delete().eq('kr_id', kr2.data.id);
      if (k.when === 'quarter') await sb.from('kr_targets').insert({ kr_id: kr2.data.id, quarter: cq, target });
    }
    await save(() => Promise.resolve({ error: null }) as any, ['objectives', 'key_results', 'kr_targets'], submit ? 'Sent for approval' : 'Saved as draft');
    if (submit) await notifyPositions(db!, [managerOf(db!, me!)?.id], 'okr', `${me!.holder_name} submitted an ${t('objective').toLowerCase()} for approval: ${text.trim()}`, '/inbox');
    nav('/goals');
  }
  const mgr = managerOf(db, me);
  return <div className="light narrow">
    <div className="lhead"><div><h1>{ex ? 'Edit' : 'New'} {t('objective').toLowerCase()}</h1><p>Step {step} of 4</p></div><Link to="/goals" className="btn">Cancel</Link></div>
    <div className="steps">{['What it supports', `Your ${t('objective').toLowerCase()}`, 'How you will measure it', 'Check and send'].map((l, i) => <div key={l} className={'step' + (step === i + 1 ? ' on' : step > i + 1 ? ' done' : '')}><i>{step > i + 1 ? '✓' : i + 1}</i>{l}</div>)}</div>
    {step === 1 && <div className="lcard stack">
      <h2>What will this help achieve?</h2><p className="note">Pick the {t('objective').toLowerCase()} or {t('key_result').toLowerCase()} of your team or department that your work moves forward. This is how your work adds up to the strategy.</p>
      <input type="text" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} />
      <div className="choices">{cands.map(x => <div key={x.id}><label className={'choice' + (sup === 'o:' + x.id ? ' on' : '')}><input type="radio" name="sup" checked={sup === 'o:' + x.id} onChange={() => setSup('o:' + x.id)} /><span><b>{x.text}</b><small>{byId(db.org_units, x.org_unit_id)?.name} · {posName(db, x.owner_position_id)}</small></span></label>
        {krsOf(db, x.id).map(k => <label key={k.id} className={'choice sub' + (sup === 'k:' + k.id ? ' on' : '')}><input type="radio" name="sup" checked={sup === 'k:' + k.id} onChange={() => setSup('k:' + k.id)} /><span>{k.title}</span></label>)}</div>)}
        {goals.length > 0 && <><h4 style={{ marginTop: 10 }}>Or a {t('goal').toLowerCase()} directly</h4>{goals.map(g => <label key={g.id} className={'choice' + (sup === 'g:' + g.id ? ' on' : '')}><input type="radio" name="sup" checked={sup === 'g:' + g.id} onChange={() => setSup('g:' + g.id)} /><span><b>{g.code} {g.name}</b><small>{byId(db.unit_pillars, g.pillar_id)?.name}</small></span></label>)}</>}
        {!cands.length && !goals.length && <p className="note">Nothing to link to yet — you can continue and your manager will link it.</p>}</div>
      <div className="row end"><button className="btn pri big" onClick={() => setStep(2)}>{sup ? 'Next' : 'Skip for now'}</button></div></div>}
    {step === 2 && <div className="lcard stack">
      <h2>What do you want to achieve?</h2>{supLabel && <p className="note">Supports: {supLabel}</p>}
      <textarea className="bigin" rows={3} autoFocus value={text} onChange={e => setText(e.target.value)} placeholder="Write it in plain words, starting with a verb" />
      <div className="tips"><b>Good examples</b><span>Deliver all warehouse orders on time</span><span>Cut transformer defects in half</span><span>Get the procurement process ERP-ready</span></div>
      <div className="row end"><button className="btn" onClick={() => setStep(1)}>Back</button><button className="btn pri big" disabled={!valid2} onClick={() => setStep(3)}>Next</button></div></div>}
    {step === 3 && <div className="lcard stack">
      <h2>How will you know you got there?</h2><p className="note">Add 1 to 4 measurable results. Keep them few and clear.</p>
      {krs.map((k, i) => <div key={i} className="krdraft">
        <div className="row"><b style={{ flex: 1 }}>Result {i + 1}</b>{krs.length > 1 && <button className="linkbtn" onClick={() => setKrs(krs.filter((_, j) => j !== i))}>Remove</button>}</div>
        <input type="text" placeholder="What you will measure, e.g. Orders delivered on time" value={k.title} onChange={e => setK(i, { title: e.target.value })} />
        <div className="kinds">{Object.entries(KIND).map(([key, K]) => <button key={key} type="button" className={'kind' + (k.kind === key ? ' on' : '')} onClick={() => setK(i, { kind: key })}><b>{K.label}</b><small>{K.hint}</small></button>)}</div>
        {k.kind !== 'done' && <div className="g4">
          {k.kind !== 'count' && <label className="f">Where it is now<NumIn value={k.base} onChange={v => setK(i, { base: v })} /></label>}
          <label className="f">{k.kind === 'count' ? 'Target' : k.kind === 'reduce' ? 'Bring it down to' : k.kind === 'keep' ? 'Keep it at' : 'Reach'}<NumIn value={k.target} onChange={v => setK(i, { target: v })} /></label>
          <label className="f">Unit<input type="text" value={k.uom} onChange={e => setK(i, { uom: e.target.value })} placeholder="%, units, days…" /></label>
          <label className="f">By<select value={k.when} onChange={e => setK(i, { when: e.target.value as 'quarter' | 'year' })}><option value="quarter">End of Q{cq}</option><option value="year">End of the year</option></select></label></div>}
        {k.kind === 'done' && <label className="f" style={{ maxWidth: 220 }}>By<select value={k.when} onChange={e => setK(i, { when: e.target.value as 'quarter' | 'year' })}><option value="quarter">End of Q{cq}</option><option value="year">End of the year</option></select></label>}
      </div>)}
      {krs.length < 4 && <button className="btn" onClick={() => setKrs([...krs, { title: '', kind: 'count', base: null, target: null, uom: '', when: 'quarter' }])}>+ Add another result</button>}
      <div className="row end"><button className="btn" onClick={() => setStep(2)}>Back</button><button className="btn pri big" disabled={!valid3} onClick={() => setStep(4)}>Next</button></div></div>}
    {step === 4 && <div className="lcard stack">
      <h2>Check and send</h2>
      <div className="review"><small>Supports</small><div>{supLabel || 'Not linked — your manager will link it'}</div><small>{t('objective')}</small><div><b>{text}</b></div><small>{t('key_result', true)}</small>
        <ul>{krs.map((k, i) => <li key={i}>{k.title} — {k.kind === 'done' ? 'done' : `${KIND[k.kind].label.toLowerCase()} ${k.target} ${k.uom}`} by {k.when === 'quarter' ? `end of Q${cq}` : 'end of the year'}{k.base != null && k.kind !== 'count' && k.kind !== 'done' ? ` (now ${k.base})` : ''}</li>)}</ul></div>
      <p className="note">{mgr ? `${mgr.holder_name || mgr.title} will be asked to approve it.` : 'Group Strategy will be asked to approve it.'} You can keep it as a draft and send it later.</p>
      <div className="row end"><button className="btn" onClick={() => setStep(3)}>Back</button><button className="btn" onClick={() => finish(false)}>Save as draft</button><button className="btn pri big" onClick={() => finish(true)}>Send for approval</button></div></div>}
    {user && null}
  </div>;
}
export type { DB };
