import { useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useData, useSave, byId, posName, notifyPositions, managerOf, type DB, type Row } from '../lib/data';
import { Thread } from '../lib/social';
import { sb } from '../lib/supabase';
import { weekStart, weekLabel, ymd, monthOf, MONTHS, krsOf, cutoffOf, cutoffLabel, curMonth, FY, krState, pct, workStats, delivScore, periodLabel, currentPeriod, qOfMonth } from '../lib/calc';
import { Page, Seg, Pill, Empty, Modal, NumIn, Drawer, Bar, UnitPicker, StatePill } from '../lib/ui';
import { KrDrawer } from './Goals';

const ST = ['Not started', 'In progress', 'Done', 'Stuck'];
const tone = (s: string) => (s === 'Done' || s === 'accepted' ? 'good' : s === 'Stuck' || s === 'returned' ? 'bad' : s === 'In progress' || s === 'done' ? 'warn' : 'none');
const DSTATUS: Record<string, string> = { planned: 'Planned', done: 'Submitted — awaiting acceptance', accepted: 'Accepted', returned: 'Returned for rework', removed: 'Removed', transferred: 'Moved' };
const LEADS = ['unit_head', 'planning_head', 'super_admin', 'group_strategy', 'executive'];
const fmtD = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Positions a person looks after: their org unit and everything below it (the whole unit for unit heads and planners). */
export function teamOf(db: DB, me: Row, all: boolean, unit?: string | null) {
  if (all) return db.positions.filter(p => p.unit_id === (unit || me.unit_id) && p.holder_name);
  const ids = new Set<string>([me.org_unit_id]); let grew = true;
  while (grew) { grew = false; db.org_units.forEach(u => { if (u.parent_id && ids.has(u.parent_id) && !ids.has(u.id)) { ids.add(u.id); grew = true; } }); }
  return db.positions.filter(p => ids.has(p.org_unit_id) && p.holder_name);
}
/** "Deliverable → key result → objective" for an activity or deliverable. */
function linkPath(db: DB, a: Row) {
  const d = byId(db.deliverables, a.deliverable_id); const k = byId(db.key_results, a.key_result_id || d?.key_result_id); const o = k && byId(db.objectives, k.objective_id);
  return { d, k, o };
}

function Comments({ entity, id }: { entity: string; id: string }) {
  const { db, user } = useData(); const save = useSave(); const [t, setT] = useState(''); if (!db) return null;
  const list = db.comments.filter(c => c.entity_type === entity && c.entity_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  return <div className="stack" style={{ gap: 6 }}>{list.map(c => <div key={c.id} className="lg"><small>{c.created_at.slice(0, 16).replace('T', ' ')} · {db.profiles.find(p => p.id === c.created_by)?.full_name || 'someone'}</small><div>{c.body}</div></div>)}
    <div className="row"><input type="text" style={{ flex: 1 }} value={t} onChange={e => setT(e.target.value)} placeholder="Comment, ask, @mention by name" onKeyDown={async e => { if (e.key === 'Enter' && t.trim()) { if (await save(() => sb.from('comments').insert({ entity_type: entity, entity_id: id, body: t.trim(), created_by: user.id }), ['comments'])) setT(''); } }} /></div></div>;
}

export function ActivityRow({ a, editable, onOpen }: { a: Row; editable: boolean; onOpen: (a: Row) => void }) {
  const { db } = useData(); const save = useSave(); if (!db) return null;
  const upd = (patch: Row) => save(() => sb.from('activities').update(patch).eq('id', a.id), ['activities']);
  const { d, k } = linkPath(db, a); const nc = db.comments.filter(c => c.entity_type === 'activity' && c.entity_id === a.id).length;
  return <div className={'act' + (a.status === 'Done' ? ' done' : '') + (a.status === 'Stuck' ? ' stuck' : '')}>
    <input type="checkbox" className="chk" aria-label="Done" disabled={!editable} checked={a.status === 'Done'} onChange={e => upd({ status: e.target.checked ? 'Done' : 'In progress', pct: e.target.checked ? 100 : Math.min(Number(a.pct) || 0, 90) })} />
    <div className="click" onClick={() => onOpen(a)}><div className="t">{a.top ? '★ ' : ''}{a.title}</div>
      <div className="l">{d ? `↳ ${d.title}` : k ? `↳ ${k.title}` : a.unplanned ? 'Unplanned' : 'Not linked'}{a.blocker ? ` · ⚠ ${a.blocker}` : ''}{nc ? ` · 💬 ${nc}` : ''}{a.due_date ? ` · due ${a.due_date.slice(5)}` : ''}</div></div>
    {editable ? <select value={a.status} onChange={e => { const s = e.target.value; if (s === 'Stuck') onOpen({ ...a, _block: true }); else upd({ status: s, pct: s === 'Done' ? 100 : a.pct, blocker: s === 'Stuck' ? a.blocker : null }); }}>{ST.map(s => <option key={s}>{s}</option>)}</select> : <Pill tone={tone(a.status)}>{a.status}</Pill>}
    <div className="row" style={{ gap: 4 }}>{editable ? <><input type="range" min={0} max={100} step={10} value={Number(a.pct) || 0} aria-label="% done" onChange={e => upd({ pct: Number(e.target.value), status: Number(e.target.value) === 100 ? 'Done' : a.status === 'Not started' && Number(e.target.value) > 0 ? 'In progress' : a.status === 'Done' ? 'In progress' : a.status })} style={{ width: 70 }} /><span className="mini">{a.pct || 0}%</span></> : <Bar p={(Number(a.pct) || 0) / 100} />}</div>
    <span className="mini">{posName(db, a.owner_position_id).split(' ')[0]}</span>
    <div className="row" style={{ gap: 4 }}>{editable && <button className="btn sm" title="Top priority" onClick={() => upd({ top: !a.top })}>{a.top ? '★' : '☆'}</button>}<button className="btn sm" onClick={() => onOpen(a)}>Open</button></div>
  </div>;
}

export function ActivityDrawer({ a0, onClose, canEdit }: { a0: Row; onClose: () => void; canEdit: boolean }) {
  const { db, units } = useData(); const save = useSave(); const [f, setF] = useState<Row>({ ...a0 });
  if (!db) return null; const a = byId(db.activities, a0.id) || a0; const { d, k, o } = linkPath(db, a);
  const myDels = db.deliverables.filter(x => x.owner_position_id === a.owner_position_id && x.status !== 'removed' && Math.abs(x.month - monthOf(FY, new Date(a.week_start))) <= 1);
  const krs = db.objectives.filter(x => x.unit_id === a.unit_id).flatMap(x => krsOf(db, x.id));
  const upd = (patch: Row, msg?: string) => save(() => sb.from('activities').update(patch).eq('id', a.id), ['activities'], msg);
  const next = ymd(new Date(new Date(a.week_start + 'T00:00:00Z').getTime() + 7 * 864e5));
  return <Drawer title="Activity" onClose={onClose}>
    {canEdit ? <label className="f">Activity<input type="text" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} onBlur={() => f.title.trim() && f.title !== a.title && upd({ title: f.title.trim() })} /></label> : <b>{a.title}</b>}
    <div className="note">{posName(db, a.owner_position_id)} · {weekLabel(new Date(a.week_start + 'T00:00:00Z'))}</div>
    <div className="card stack" style={{ padding: 12 }}><h4>Linked to</h4>
      {o && <div className="mini">Objective: {o.text}</div>}{k && <div className="mini">Key result: {k.title}</div>}{d && <div className="mini">Deliverable: {d.title} ({MONTHS[d.month - 1]})</div>}
      {canEdit && <div className="g2"><label className="f">Deliverable<select value={a.deliverable_id || ''} onChange={e => upd({ deliverable_id: e.target.value || null, unplanned: !e.target.value && !a.key_result_id })}><option value="">—</option>{myDels.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select></label>
        <label className="f">Or key result<select value={a.key_result_id || ''} onChange={e => upd({ key_result_id: e.target.value || null, unplanned: !e.target.value && !a.deliverable_id })}><option value="">—</option>{krs.map(x => <option key={x.id} value={x.id}>{x.title.slice(0, 90)}</option>)}</select></label></div>}</div>
    {canEdit && <div className="g3"><label className="f">Status<select value={a.status} onChange={e => upd({ status: e.target.value, pct: e.target.value === 'Done' ? 100 : a.pct })}>{ST.map(s => <option key={s}>{s}</option>)}</select></label>
      <label className="f">% done<NumIn value={Number(a.pct)} onChange={v => upd({ pct: Math.max(0, Math.min(100, v || 0)) })} /></label>
      <label className="f">Due<input type="text" placeholder="YYYY-MM-DD" defaultValue={a.due_date || ''} onBlur={e => upd({ due_date: e.target.value || null })} /></label></div>}
    <div className={'card stack' + (a.status === 'Stuck' || a0._block ? '' : '')} style={{ padding: 12, background: a.status === 'Stuck' || a0._block ? 'var(--bad-soft)' : undefined }}><h4>Blocker</h4>
      {canEdit ? <><label className="f">What is in the way<textarea rows={2} value={f.blocker || ''} onChange={e => setF({ ...f, blocker: e.target.value })} /></label>
        <label className="f">Help needed from<select value={f.help_from_unit || ''} onChange={e => setF({ ...f, help_from_unit: e.target.value || null })}><option value="">My own team</option>{db.org_units.filter(u => u.kind === 'unit').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        <div className="row"><button className="btn sm pri" disabled={!f.blocker?.trim()} onClick={async () => { await upd({ status: 'Stuck', blocker: f.blocker.trim(), help_from_unit: f.help_from_unit || null }, 'Marked stuck — your manager will see it'); const me2 = byId(db.positions, a.owner_position_id); const targets = [me2 && managerOf(db, me2)?.id, ...(f.help_from_unit ? db.positions.filter(x => x.org_unit_id === f.help_from_unit && x.level !== 'employee').map(x => x.id) : [])]; await notifyPositions(db, targets, 'blocker', `Stuck: ${a.title} — ${f.blocker.trim()}`, '/inbox'); }}>Mark stuck</button>{a.status === 'Stuck' && <button className="btn sm" onClick={() => upd({ status: 'In progress', blocker: null, help_from_unit: null }, 'Unblocked')}>Resolved</button>}</div></>
        : a.blocker ? <div>{a.blocker}{a.help_from_unit && <div className="mini">Needs help from {byId(db.org_units, a.help_from_unit)?.name}</div>}</div> : <p className="note">No blocker.</p>}
      {!canEdit && a.status === 'Stuck' && <button className="btn sm" onClick={() => upd({ status: 'In progress', blocker: null }, 'Unblocked')}>Mark resolved</button>}
      {units.length === 0 && null}</div>
    <div><h4>Comments</h4><Thread entity="activity" id={a.id} link="/week" title={a.title} /></div>
    {canEdit && <div className="row"><button className="btn sm" onClick={() => upd({ week_start: next }, 'Moved to next week').then(onClose)}>Move to next week</button><span className="sp" /><button className="btn sm danger" onClick={async () => { if (confirm('Delete this activity?') && await save(() => sb.from('activities').delete().eq('id', a.id), ['activities'], 'Deleted')) onClose(); }}>Delete</button></div>}
  </Drawer>;
}

export function WeekReview({ me, wk, mine }: { me: Row; wk: string; mine: boolean }) {
  const { db, user, can } = useData(); const save = useSave();
  const r = db?.week_reviews.find(x => x.position_id === me.id && x.week_start === wk) || {} as Row;
  const [f, setF] = useState<Row>({ wins: r.wins || '', blockers: r.blockers || '', asks: r.asks || '' });
  if (!db) return null;
  const put = (patch: Row, msg: string) => save(() => sb.from('week_reviews').upsert({ position_id: me.id, unit_id: me.unit_id, week_start: wk, ...f, ...patch }, { onConflict: 'position_id,week_start' }), ['week_reviews'], msg);
  return <div className="card stack"><div className="row"><h3 style={{ flex: 1 }}>Week summary</h3>{r.submitted_at ? <Pill tone="good">Submitted {r.submitted_at.slice(5, 16).replace('T', ' ')}</Pill> : <Pill tone="warn">Not submitted</Pill>}</div>
    {(['wins', 'blockers', 'asks'] as const).map(k => <label key={k} className="f">{({ wins: 'Wins — what got done that matters', blockers: 'Blockers — what slowed us', asks: 'Asks — help or decisions needed' })[k]}<textarea rows={2} value={f[k]} disabled={!mine} onChange={e => setF({ ...f, [k]: e.target.value })} /></label>)}
    {mine && <div className="row end"><button className="btn" onClick={() => put({}, 'Saved')}>Save</button><button className="btn pri" onClick={() => put({ submitted_at: new Date().toISOString() }, 'Week submitted to your manager').then(() => notifyPositions(db, [managerOf(db, me)?.id], 'week', `${me.holder_name} submitted the week summary`, '/inbox'))}>Submit week</button></div>}
    {(r.feedback || r.rating) && <div className="banner good"><b>Manager feedback</b> {r.rating ? '★'.repeat(r.rating) : ''} {r.feedback}</div>}
    {!mine && can('managePeople') && <FeedbackBox me={me} wk={wk} r={r} userId={user.id} />}
  </div>;
}
function FeedbackBox({ me, wk, r, userId }: { me: Row; wk: string; r: Row; userId: string }) {
  const save = useSave(); const { db } = useData(); const useDataDb = { current: db }; const [fb, setFb] = useState(r.feedback || ''); const [rt, setRt] = useState<number>(r.rating || 0);
  return <div className="stack"><label className="f">Feedback to {me.holder_name}<textarea rows={2} value={fb} onChange={e => setFb(e.target.value)} /></label>
    <div className="row"><span className="mini">Rating</span>{[1, 2, 3, 4, 5].map(n => <button key={n} className={'btn sm' + (rt >= n ? ' pri' : '')} onClick={() => setRt(n)}>★</button>)}<span className="sp" />
      <button className="btn sm pri" onClick={() => save(() => sb.from('week_reviews').upsert({ position_id: me.id, unit_id: me.unit_id, week_start: wk, feedback: fb || null, rating: rt || null, feedback_by: userId, feedback_at: new Date().toISOString() }, { onConflict: 'position_id,week_start' }), ['week_reviews'], 'Feedback sent').then(() => notifyPositions(useDataDb.current!, [me.id], 'feedback', `Feedback on your week ${rt ? '★'.repeat(rt) : ''}`, '/week', fb || undefined))}>Send feedback</button></div></div>;
}

export function MyWeek({ who, ws, setWs }: { who: Row; ws: Date; setWs: (d: Date) => void }) {
  const { db, me, user, can } = useData(); const save = useSave(); const [open, setOpen] = useState<Row | null>(null);
  const [t, setT] = useState(''); const [link, setLink] = useState(''); if (!db || !me) return null;
  const mine = who.id === me.id; const editable = mine || can('managePeople'); const wk = ymd(ws); const month = monthOf(FY, new Date(ws.getTime() + 3 * 864e5));
  const acts = db.activities.filter(a => a.week_start === wk && a.owner_position_id === who.id).sort((a, b) => Number(b.top) - Number(a.top) || a.created_at.localeCompare(b.created_at));
  const prevWk = ymd(new Date(ws.getTime() - 7 * 864e5));
  const carry = db.activities.filter(a => a.week_start === prevWk && a.owner_position_id === who.id && !['Done', 'Closed'].includes(a.status) && !acts.some(b => b.title === a.title));
  const myDels = db.deliverables.filter(d => d.owner_position_id === who.id && d.month === month && d.status !== 'removed');
  const myKrs = db.key_results.filter(k => k.owner_position_id === who.id);
  const groups = new Map<string, Row[]>(); acts.forEach(a => { const key = a.deliverable_id || a.key_result_id || '_'; groups.set(key, [...(groups.get(key) || []), a]); });
  const cutoff = cutoffOf(ws); const now = new Date(); const ws2 = workStats(db, new Set([who.id]), wk);
  async function add() {
    if (!t.trim()) return; const [kind, id] = link.split(':');
    if (await save(() => sb.from('activities').insert({ title: t.trim(), unit_id: who.unit_id, owner_position_id: who.id, week_start: wk, status: 'Not started', pct: 0, deliverable_id: kind === 'd' ? id : null, key_result_id: kind === 'k' ? id : null, unplanned: !link, created_by: user.id }), ['activities'])) setT('');
  }
  return <div className="drill" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)' }}>
    <div className="stack">
      <div className="row"><button className="btn sm" onClick={() => setWs(new Date(ws.getTime() - 7 * 864e5))}>‹</button><b>{weekLabel(ws)}</b><span className="note">{fmtD(ws)} – {fmtD(new Date(ws.getTime() + 6 * 864e5))}</span><button className="btn sm" onClick={() => setWs(new Date(ws.getTime() + 7 * 864e5))}>›</button><button className="btn sm" onClick={() => setWs(weekStart(new Date()))}>This week</button><span className="sp" />
        {now < cutoff && now >= ws ? <Pill tone="warn">Update by {cutoffLabel()} · {Math.max(0, Math.ceil((cutoff.getTime() - now.getTime()) / 864e5))} day(s)</Pill> : now >= cutoff ? <Pill>Week closed</Pill> : null}</div>
      {editable && <div className="card" style={{ padding: 10 }}><div className="row"><input type="text" style={{ flex: 1, minWidth: 200 }} placeholder={`Add an activity for ${mine ? 'this week' : who.holder_name} — press Enter`} value={t} onChange={e => setT(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} />
        <select value={link} onChange={e => setLink(e.target.value)} aria-label="Link to"><option value="">Not linked (unplanned)</option>{myDels.length > 0 && <optgroup label={`Deliverables · ${MONTHS[month - 1]}`}>{myDels.map(d => <option key={d.id} value={'d:' + d.id}>{d.title}</option>)}</optgroup>}{myKrs.length > 0 && <optgroup label="My key results">{myKrs.map(k => <option key={k.id} value={'k:' + k.id}>{k.title.slice(0, 70)}</option>)}</optgroup>}</select>
        <button className="btn pri" onClick={add}>Add</button></div>
        {carry.length > 0 && <div className="row" style={{ marginTop: 8 }}><span className="note">{carry.length} unfinished from last week.</span><button className="btn sm" onClick={() => save(() => sb.from('activities').insert(carry.map(a => ({ unit_id: a.unit_id, owner_position_id: who.id, week_start: wk, title: a.title, deliverable_id: a.deliverable_id, key_result_id: a.key_result_id, unplanned: a.unplanned, status: a.status === 'Stuck' ? 'Stuck' : 'In progress', blocker: a.blocker, pct: a.pct, top: a.top, created_by: user.id }))), ['activities'], `${carry.length} carried over`)}>Carry them over</button></div>}</div>}
      {!acts.length ? <Empty>No activities this week yet{editable ? ' — add the first one above.' : '.'}</Empty> :
        Array.from(groups.entries()).map(([key, list]) => { const d = byId(db.deliverables, key); const k = d ? byId(db.key_results, d.key_result_id) : byId(db.key_results, key);
          return <div key={key} className="card" style={{ padding: 0 }}><div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}><b>{d ? d.title : k ? k.title : 'Not linked to the plan'}</b>
            <div className="mini">{d ? `Deliverable · ${MONTHS[d.month - 1]} · ${DSTATUS[d.status]}${k ? ' · KR: ' + k.title : ''}` : k ? `Key result · ${pct(krState(db, k).progress)} of ${periodLabel(currentPeriod('Q'))} target` : 'Unplanned work — link it to a deliverable so it counts toward the plan'}</div></div>
            {list.map(a => <ActivityRow key={a.id} a={a} editable={editable} onOpen={setOpen} />)}</div>; })}
    </div>
    <div className="stack">
      <div className="card"><h3>This week</h3><div className="g2" style={{ marginTop: 8 }}><div className="tile"><div className="tv">{pct(ws2.completion)}</div><div className="tl">Done</div></div><div className={'tile ' + (ws2.stuck ? 'bad' : '')}><div className="tv">{ws2.stuck}</div><div className="tl">Stuck</div></div></div>
        <div className="mini" style={{ marginTop: 8 }}>{acts.filter(a => a.top).length}/3 top priorities set · {acts.filter(a => !a.deliverable_id && !a.key_result_id).length} not linked to the plan</div></div>
      <WeekReview me={who} wk={wk} mine={mine} />
      <div className="card"><h3>{MONTHS[month - 1]} deliverables</h3>{myDels.length ? myDels.map(d => <div key={d.id} className="lg row"><span style={{ flex: 1 }}>{d.title}<div className="mini">{db.activities.filter(a => a.deliverable_id === d.id).length} activities</div></span><Pill tone={tone(d.status)}>{DSTATUS[d.status]?.split(' —')[0]}</Pill></div>) : <p className="note">None for this month.</p>}<Link to="/deliverables">Open month →</Link></div>
    </div>
    {open && <ActivityDrawer a0={open} canEdit={editable} onClose={() => setOpen(null)} />}
  </div>;
}

export function MonthView({ people, lead }: { people: Row[]; lead: boolean }) {
  const { db, me, can, unit } = useData(); const save = useSave(); const [m, setM] = useState(curMonth()); const [dm, setDm] = useState<Row | null>(null); const [acc, setAcc] = useState<Row | null>(null);
  if (!db || !me) return null; const ids = new Set(people.map(p => p.id));
  const dels = db.deliverables.filter(d => d.month === m && ids.has(d.owner_position_id) && d.status !== 'removed');
  const byKr = new Map<string, Row[]>(); dels.forEach(d => byKr.set(d.key_result_id || '_', [...(byKr.get(d.key_result_id || '_') || []), d]));
  const ds = delivScore(db, ids, { t: 'M', n: m });
  return <div className="stack">
    <div className="row"><button className="btn sm" onClick={() => setM(Math.max(1, m - 1))}>‹</button><b>{MONTHS[m - 1]} {FY}</b><button className="btn sm" onClick={() => setM(Math.min(12, m + 1))}>›</button><span className="sp" />{lead && <button className="btn pri" onClick={() => setDm({ month: m, status: 'planned', unit_id: me.unit_id || unit })}>+ Deliverable</button>}</div>
    <div className="kpis"><div className="tile"><div className="tv">{ds.total}</div><div className="tl">Deliverables</div></div><div className="tile"><div className="tv">{ds.accepted}</div><div className="tl">Accepted</div></div><div className="tile warn"><div className="tv">{ds.done}</div><div className="tl">Waiting for acceptance</div></div><div className="tile"><div className="tv">{pct(ds.score)}</div><div className="tl">Month score (due items)</div></div></div>
    {lead && dels.length > 0 && !dels.some(d => d.status === 'done') && <div className="banner"><span>Nothing is waiting for your review in {MONTHS[m - 1]}. <b>Review & accept</b> appears on a deliverable once its owner submits it (Record → Deliverables → Mine → Submit). If the work is done but they have not submitted it, use <b>Accept directly</b>.</span></div>}
    {!dels.length ? <Empty>No deliverables for {MONTHS[m - 1]}.{lead ? ' Add the outputs that will move each key result this month.' : ' Your manager sets them during quarter and month planning.'}</Empty> :
      Array.from(byKr.entries()).map(([kid, list]) => { const k = byId(db.key_results, kid);
        return <div key={kid} className="card" style={{ padding: 0 }}><div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}><b>{k ? k.title : 'Not linked to a key result'}</b>{k && <div className="mini">{byId(db.objectives, k.objective_id)?.text}</div>}</div>
          <div className="tw" style={{ border: 0, borderRadius: 0 }}><table className="t"><tbody>{list.map(d => { const own = d.owner_position_id === me.id; const mgr = can('managePeople') && !own; const na = db.activities.filter(a => a.deliverable_id === d.id);
            return <tr key={d.id}><td style={{ width: '40%' }}><b>{d.title}</b>{d.target != null && <div className="mini">Target {d.target} {d.uom || ''}</div>}{d.evidence_url && <div><a href={d.evidence_url} target="_blank" rel="noreferrer">evidence</a></div>}{d.feedback && <div className="mini">Feedback: {d.feedback}</div>}</td>
              <td>{posName(db, d.owner_position_id)}<div className="mini">{na.length} activities · {na.filter(a => a.status === 'Done').length} done</div></td><td className="n">{d.weight != null ? d.weight + '%' : ''}</td>
              <td><Pill tone={tone(d.status)}>{DSTATUS[d.status]}</Pill>{d.rating ? <div className="mini">{'★'.repeat(d.rating)}</div> : null}</td>
              <td><div className="row" style={{ justifyContent: 'flex-end' }}>{own && ['planned', 'returned'].includes(d.status) && <button className="btn sm pri" onClick={() => { const ev = prompt('Link to evidence (optional)') ?? ''; save(() => sb.from('deliverables').update({ status: 'done', evidence_url: ev || null, done_at: new Date().toISOString() }).eq('id', d.id), ['deliverables'], 'Delivered — sent for acceptance').then(() => { const o = byId(db.positions, d.owner_position_id); return notifyPositions(db, [o && managerOf(db, o)?.id], 'deliverable', `${o?.holder_name} delivered: ${d.title}`, '/inbox'); }); }}>Submit</button>}
                {mgr && d.status === 'done' && <button className="btn sm pri" onClick={() => setAcc(d)}>Review & accept</button>}
                {mgr && ['planned', 'returned'].includes(d.status) && <button className="btn sm" onClick={() => setAcc(d)} data-tip="Accept it now — for when the work is done but the person has not submitted it in the app">Accept directly</button>}
                {lead && <button className="btn sm" onClick={() => setDm(d)}>Edit</button>}</div></td></tr>; })}</tbody></table></div></div>; })}
    {dm && <DelModal init={dm} team={people} onClose={() => setDm(null)} />}
    {acc && <Modal title="Review deliverable" onClose={() => setAcc(null)}><AcceptForm d={acc} onDone={() => setAcc(null)} /></Modal>}
  </div>;
}
export function AcceptForm({ d, onDone }: { d: Row; onDone: () => void }) {
  const save = useSave(); const { db } = useData(); const [rt, setRt] = useState(4); const [fb, setFb] = useState(''); const [act, setAct] = useState<number | null>(d.target);
  return <div className="stack"><b>{d.title}</b>{d.evidence_url && <a href={d.evidence_url} target="_blank" rel="noreferrer">Open evidence</a>}
    {d.target != null && <label className="f">Actual delivered ({d.uom || 'value'})<NumIn value={act} onChange={setAct} /></label>}
    <div className="row"><span className="mini">Quality</span>{[1, 2, 3, 4, 5].map(n => <button key={n} className={'btn sm' + (rt >= n ? ' pri' : '')} onClick={() => setRt(n)}>★</button>)}</div>
    <label className="f">Feedback<textarea rows={2} value={fb} onChange={e => setFb(e.target.value)} /></label>
    <div className="row end"><button className="btn" onClick={async () => { if (await save(() => sb.from('deliverables').update({ status: 'returned', feedback: fb || null }).eq('id', d.id), ['deliverables'], 'Returned for rework')) { if (db) await notifyPositions(db, [d.owner_position_id], 'deliverable', `Returned for rework: ${d.title}`, '/deliverables', fb || undefined); onDone(); } }}>Return for rework</button>
      <button className="btn pri" onClick={async () => { if (await save(() => sb.from('deliverables').update({ status: 'accepted', rating: rt, feedback: fb || null, actual: act, accepted_at: new Date().toISOString() }).eq('id', d.id), ['deliverables'], 'Accepted')) { if (db) await notifyPositions(db, [d.owner_position_id], 'deliverable', `Accepted ${'★'.repeat(rt)}: ${d.title}`, '/deliverables', fb || undefined); onDone(); } }}>Accept</button></div></div>;
}
export function DelModal({ init, team, onClose }: { init: Row; team: Row[]; onClose: () => void }) {
  const { db, user, unit } = useData(); const save = useSave(); const [f, setF] = useState<Row>(init); if (!db) return null;
  const u = f.unit_id || unit; const krs = db.objectives.filter(o => o.unit_id === u).flatMap(o => krsOf(db, o.id));
  const set = (k: string, v: any) => setF(x => ({ ...x, [k]: v }));
  return <Modal title={f.id ? 'Edit deliverable' : 'New deliverable'} onClose={onClose}>
    <label className="f">Deliverable — a concrete output<input type="text" value={f.title || ''} onChange={e => set('title', e.target.value)} /></label>
    <label className="f">Key result it moves<select value={f.key_result_id || ''} onChange={e => set('key_result_id', e.target.value || null)}><option value="">—</option>{krs.map(k => <option key={k.id} value={k.id}>{k.title.slice(0, 100)}</option>)}</select></label>
    <div className="g3"><label className="f">Owner<select value={f.owner_position_id || ''} onChange={e => set('owner_position_id', e.target.value)}><option value="">—</option>{team.map(p => <option key={p.id} value={p.id}>{p.holder_name || p.title}</option>)}</select></label>
      <label className="f">Month<select value={f.month} onChange={e => set('month', Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
      <label className="f">Weight in the person's month (%)<NumIn value={f.weight} onChange={v => set('weight', v)} /></label></div>
    <div className="g2"><label className="f">Target (optional)<NumIn value={f.target} onChange={v => set('target', v)} /></label><label className="f">Unit<input type="text" value={f.uom || ''} onChange={e => set('uom', e.target.value)} /></label></div>
    <div className="row end">{f.id && <button className="btn danger" onClick={async () => { if (await save(() => sb.from('deliverables').update({ status: 'removed' }).eq('id', f.id), ['deliverables'], 'Removed')) onClose(); }}>Remove</button>}<span className="sp" />
      <button className="btn" onClick={onClose}>Cancel</button><button className="btn pri" disabled={!f.title?.trim() || !f.owner_position_id} onClick={async () => {
        const row = { unit_id: u, key_result_id: f.key_result_id || null, owner_position_id: f.owner_position_id, month: f.month, title: f.title.trim(), target: f.target ?? null, weight: f.weight ?? null, uom: f.uom || null };
        if (await save(() => f.id ? sb.from('deliverables').update(row).eq('id', f.id) : sb.from('deliverables').insert({ ...row, status: 'planned', created_by: user.id }), ['deliverables'], 'Deliverable saved')) onClose(); }}>Save</button></div>
  </Modal>;
}

export function CheckIns({ people, lead }: { people: Row[]; lead: boolean }) {
  const { db, me } = useData(); const [kr, setKr] = useState<string | null>(null); if (!db || !me) return null;
  const ids = new Set(people.map(p => p.id)); const p = currentPeriod('Q');
  const krs = db.key_results.filter(k => k.measure === 'manual' && (lead ? ids.has(k.owner_position_id) : k.owner_position_id === me.id));
  const last = (id: string) => db.check_ins.filter(c => c.kr_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const rows = krs.map(k => ({ k, s: krState(db, k, p), c: last(k.id) })).sort((a, b) => (a.c?.created_at || '').localeCompare(b.c?.created_at || ''));
  return <div className="stack"><p className="note">Key results updated by check-in, oldest update first. {periodLabel(p)} progress is pace-adjusted: {pct(rows[0]?.s.expected)} of the quarter has passed.</p>
    {!rows.length ? <Empty>No key results to check in{lead ? ' for your team' : ''}. Key results measured from the plan or deliverables update themselves.</Empty> :
      <div className="tw"><table className="t"><thead><tr><th>Key result</th><th>Owner</th><th>Last check-in</th><th className="n">{periodLabel(p)} actual / target</th><th>Progress</th><th>Status</th><th /></tr></thead><tbody>
        {rows.map(({ k, s, c }) => <tr key={k.id}><td>{k.title}<div className="mini">{byId(db.objectives, k.objective_id)?.text}</div></td><td>{posName(db, k.owner_position_id)}</td><td>{c ? `${c.created_at.slice(0, 10)} (${c.month ? MONTHS[c.month - 1] : 'Q' + c.quarter})` : <Pill tone="warn">never</Pill>}</td>
          <td className="n">{s.actual ?? '—'} / {s.target != null ? Math.round(s.target * 100) / 100 : '—'} {k.uom}</td><td><Bar p={s.progress} /></td><td><StatePill s={s} /></td><td><button className="btn sm pri" onClick={() => setKr(k.id)}>Check in</button></td></tr>)}
      </tbody></table></div>}
    {kr && <KrDrawer id={kr} onClose={() => setKr(null)} />}
  </div>;
}

export function TeamView({ people, ws, setWs }: { people: Row[]; ws: Date; setWs: (d: Date) => void }) {
  const { db } = useData(); const [pick, setPick] = useState<Row | null>(null); if (!db) return null;
  const wk = ymd(ws); const cut = cutoffOf(ws).toISOString(); const tot = workStats(db, new Set(people.map(p => p.id)), wk);
  const pend = db.deliverables.filter(d => d.status === 'done' && people.some(p => p.id === d.owner_position_id));
  const rows = people.map(p => { const a = db.activities.filter(x => x.owner_position_id === p.id && x.week_start === wk); const r = db.week_reviews.find(x => x.position_id === p.id && x.week_start === wk);
    return { p, a, done: a.filter(x => x.status === 'Done').length, stuck: a.filter(x => x.status === 'Stuck').length, onTime: a.length > 0 && a.every(x => (x.updated_at || x.created_at) <= cut), comp: a.length ? a.reduce((s, x) => s + (x.status === 'Done' ? 100 : Number(x.pct) || 0), 0) / a.length / 100 : null, r }; })
    .sort((a, b) => b.a.length - a.a.length);
  return <div className="stack">
    <div className="row"><button className="btn sm" onClick={() => setWs(new Date(ws.getTime() - 7 * 864e5))}>‹</button><b>{weekLabel(ws)}</b><button className="btn sm" onClick={() => setWs(new Date(ws.getTime() + 7 * 864e5))}>›</button><button className="btn sm" onClick={() => setWs(weekStart(new Date()))}>This week</button></div>
    <div className="kpis"><div className="tile"><div className="tv">{tot.people}/{people.length}</div><div className="tl">People with activities</div></div><div className="tile"><div className="tv">{pct(tot.completion)}</div><div className="tl">Work done</div><div className="ts">{tot.done}/{tot.total} activities</div></div>
      <div className={'tile ' + (tot.stuck ? 'bad' : '')}><div className="tv">{tot.stuck}</div><div className="tl">Stuck</div></div><div className="tile"><div className="tv">{rows.filter(r => r.r?.submitted_at).length}</div><div className="tl">Week summaries submitted</div></div>
      <div className={'tile ' + (pend.length ? 'warn' : '')}><div className="tv">{pend.length}</div><div className="tl">Deliverables to accept</div></div></div>
    <div className="tw"><table className="t"><thead><tr><th>Person</th><th className="n">Activities</th><th>Done</th><th className="n">Stuck</th><th>Updated by cut-off</th><th>Summary</th><th>Feedback</th></tr></thead><tbody>
      {rows.map(r => <tr key={r.p.id} className="click" onClick={() => setPick(r.p)}><td><b>{r.p.holder_name}</b><div className="mini">{r.p.title}</div></td><td className="n">{r.a.length}</td><td><Bar p={r.comp} /> {pct(r.comp)}</td><td className="n">{r.stuck || ''}</td>
        <td>{r.a.length ? (r.onTime ? <Pill tone="good">yes</Pill> : <Pill tone="warn">late</Pill>) : <Pill tone="bad">no plan</Pill>}</td><td>{r.r?.submitted_at ? <Pill tone="good">submitted</Pill> : <span className="note">—</span>}</td><td>{r.r?.rating ? '★'.repeat(r.r.rating) : <span className="note">give</span>}</td></tr>)}
    </tbody></table></div>
    {pick && <Drawer title={pick.holder_name} onClose={() => setPick(null)}><MyWeekCompact who={pick} wk={wk} /><WeekReview me={pick} wk={wk} mine={false} /></Drawer>}
  </div>;
}
export function MyWeekCompact({ who, wk }: { who: Row; wk: string }) {
  const { db, can } = useData(); const [open, setOpen] = useState<Row | null>(null); if (!db) return null;
  const acts = db.activities.filter(a => a.week_start === wk && a.owner_position_id === who.id);
  return <div className="card" style={{ padding: 0 }}>{acts.length ? acts.map(a => <ActivityRow key={a.id} a={a} editable={can('managePeople')} onOpen={setOpen} />) : <p className="note" style={{ padding: 12 }}>No activities this week.</p>}{open && <ActivityDrawer a0={open} canEdit={can('managePeople')} onClose={() => setOpen(null)} />}</div>;
}

export function Blockers({ people }: { people: Row[] }) {
  const { db, unit, me } = useData(); const [open, setOpen] = useState<Row | null>(null); if (!db || !me) return null;
  const ids = new Set(people.map(p => p.id)); const myUnit = me.unit_id || unit;
  const stuck = db.activities.filter(a => a.status === 'Stuck' && (ids.has(a.owner_position_id) || a.help_from_unit === myUnit)).sort((a, b) => a.week_start.localeCompare(b.week_start));
  return <div className="stack"><p className="note">Activities marked stuck in your team, plus anything other units need from {byId(db.org_units, myUnit)?.name}. Oldest first.</p>
    {!stuck.length ? <Empty>Nothing is stuck.</Empty> : <div className="tw"><table className="t"><thead><tr><th>Activity</th><th>Blocker</th><th>Owner</th><th>Needs</th><th>Since</th><th /></tr></thead><tbody>
      {stuck.map(a => <tr key={a.id}><td>{a.title}<div className="mini">{byId(db.org_units, a.unit_id)?.name}</div></td><td>{a.blocker || '—'}</td><td>{posName(db, a.owner_position_id)}</td><td>{a.help_from_unit ? byId(db.org_units, a.help_from_unit)?.name : 'Own team'}</td><td>{weekLabel(new Date(a.week_start + 'T00:00:00Z'))}</td><td><button className="btn sm" onClick={() => setOpen(a)}>Open</button></td></tr>)}
    </tbody></table></div>}
    {open && <ActivityDrawer a0={open} canEdit={false} onClose={() => setOpen(null)} />}
  </div>;
}

export default function Work() {
  const { db, me, role, unit } = useData(); const [sp, setSp] = useSearchParams();
  const lead = role !== 'employee'; const tab = sp.get('tab') || 'week'; const setTab = (t: string) => setSp({ tab: t });
  const [ws, setWs] = useState(() => weekStart(new Date())); const [scope, setScope] = useState<'me' | 'team'>('me'); const [pid, setPid] = useState<string>('');
  const team = useMemo(() => (db && me ? teamOf(db, me, LEADS.includes(role), unit) : []), [db, me, role, unit]);
  if (!db || !me) return null;
  const who = (pid && byId(db.positions, pid)) || me;
  const people = scope === 'team' || tab === 'team' ? team : [me];
  const tabs: [string, string][] = [['week', 'My week'], ['month', 'Month'], ['checkin', 'Check-ins'], ...(lead ? [['team', 'Team'] as [string, string]] : []), ['blockers', 'Blockers']];
  const nStuck = db.activities.filter(a => a.status === 'Stuck' && (team.some(p => p.id === a.owner_position_id))).length;
  return <Page title="Work" desc="Weekly activities, monthly deliverables and check-ins — the plan turned into daily work." help={<>
    <h3>How work connects to the plan</h3><p>Strategic goal → objective → key result → <b>deliverable</b> (a concrete output due in a month) → <b>activities</b> (what you do this week). Linking an activity to a deliverable or key result is what makes your week count toward the plan; unlinked work is shown as unplanned.</p>
    <h3>Week</h3><ul><li>Weeks run Saturday to Friday and are numbered from 1 in each month. Update before the <b>Saturday 2:00 PM</b> cut-off.</li><li>Tick an activity when done, set % done with the slider, star up to three top priorities, carry over last week's unfinished work in one click.</li><li>Mark an activity <b>stuck</b> with what is in the way and which unit you need help from — it shows on the Blockers tab for your manager and that unit.</li><li>End the week with a short summary (wins, blockers, asks) and submit it; your manager replies with feedback and a rating.</li></ul>
    <h3>Month</h3><p>Deliverables move from Planned → Submitted (with evidence) → Accepted (with a quality rating) or Returned. Accepted deliverables feed key results measured from deliverables and your personal score.</p>
    <h3>Team</h3><p>Who planned their week, how much is done, who updated before the cut-off, stuck items and summaries — click a person to see their week and give feedback.</p></>}>
    <div className="cmdbar">{tab !== 'week' && lead && tab !== 'team' && <Seg value={scope} options={[['me', 'Mine'], ['team', 'My team']]} onChange={setScope} />}
      {tab === 'week' && lead && team.length > 1 && <label className="scope"><span>Week of</span><select value={pid} onChange={e => setPid(e.target.value)}><option value="">Me</option>{team.filter(p => p.id !== me.id).map(p => <option key={p.id} value={p.id}>{p.holder_name}</option>)}</select></label>}
      {role !== 'employee' && LEADS.includes(role) && <UnitPicker />}</div>
    <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}{k === 'blockers' && nStuck ? ` (${nStuck})` : ''}</button>)}</div>
    {tab === 'week' && <MyWeek who={who} ws={ws} setWs={setWs} />}
    {tab === 'month' && <MonthView people={people} lead={lead} />}
    {tab === 'checkin' && <CheckIns people={people} lead={lead && scope === 'team'} />}
    {tab === 'team' && lead && <TeamView people={team} ws={ws} setWs={setWs} />}
    {tab === 'blockers' && <Blockers people={team.length ? team : [me]} />}
    <p className="mini" style={{ marginTop: 16 }}>Quarter {qOfMonth(curMonth())} · {MONTHS[curMonth() - 1]} {FY}</p>
  </Page>;
}
