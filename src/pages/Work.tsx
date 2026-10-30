import { useMemo, useState } from 'react';
import { useData, useSave, byId, posName, type DB, type Row } from '../lib/data';
import { sb } from '../lib/supabase';
import { weekStart, weekNo, ymd, monthOf, MONTHS, krsOf } from '../lib/calc';
import { Page, Cmd, Seg, Pill, Empty, Modal, NumIn } from '../lib/ui';

const FY = '2026/27';
const ST = ['Not started', 'In progress', 'Done', 'Stuck'];
const tone = (s: string) => (s === 'Done' || s === 'accepted' ? 'good' : s === 'Stuck' || s === 'returned' ? 'bad' : s === 'In progress' || s === 'done' ? 'warn' : 'none');

/** Positions a person looks after: their own org unit and everything below it (whole unit for unit heads and planners). */
export function teamOf(db: DB, me: Row, all: boolean) {
  if (all) return db.positions.filter(p => p.unit_id === me.unit_id || (me.level === 'group'));
  const ids = new Set<string>([me.org_unit_id]);
  let grew = true; while (grew) { grew = false; db.org_units.forEach(u => { if (u.parent_id && ids.has(u.parent_id) && !ids.has(u.id)) { ids.add(u.id); grew = true; } }); }
  return db.positions.filter(p => ids.has(p.org_unit_id));
}

export default function Work() {
  const { db, me, role, unit, can, user } = useData(); const save = useSave();
  const [view, setView] = useState<'week' | 'month'>('week');
  const [ws, setWs] = useState(() => weekStart(new Date()));
  const [who, setWho] = useState<'me' | 'team'>('me');
  const [add, setAdd] = useState<Row | null>(null);
  const [dm, setDm] = useState<Row | null>(null);
  const month = monthOf(FY, ws);
  const lead = role !== 'employee';
  const team = useMemo(() => (db && me ? teamOf(db, me, ['unit_head', 'planning_head', 'super_admin', 'group_strategy', 'executive'].includes(role)).filter(p => !unit || p.unit_id === unit || me.level !== 'group') : []), [db, me, role, unit]);
  if (!db || !me) return null;
  const people = who === 'me' ? [me] : team;
  const ids = new Set(people.map(p => p.id));
  const wk = ymd(ws);
  const acts = db.activities.filter(a => a.week_start === wk && ids.has(a.owner_position_id));
  const prevWk = ymd(new Date(ws.getTime() - 7 * 864e5));
  const carry = db.activities.filter(a => a.week_start === prevWk && a.owner_position_id === me.id && !['Done', 'Closed'].includes(a.status) && !db.activities.some(b => b.week_start === wk && b.title === a.title && b.owner_position_id === me.id));
  const dels = db.deliverables.filter(d => d.month === month && ids.has(d.owner_position_id) && d.status !== 'removed');
  const myDels = db.deliverables.filter(d => d.owner_position_id === me.id && d.month === month && d.status !== 'removed');
  const upd = (a: Row, patch: Row) => save(() => sb.from('activities').update(patch).eq('id', a.id), ['activities']);
  const updD = (d: Row, patch: Row, msg?: string) => save(() => sb.from('deliverables').update(patch).eq('id', d.id), ['deliverables'], msg);
  const now = new Date(); const cutoff = new Date(ws.getTime() + 7 * 864e5); cutoff.setUTCHours(11, 0, 0, 0); // Saturday 14:00 EAT = 11:00 UTC
  return <Page title="Work" desc="This week's activities and this month's deliverables — the weekly tracker, joined to the plan." help={<>
    <h3>Week</h3><p>Weeks run Saturday to Friday and are numbered from 1 in each month. Add the week's activities, link each to a deliverable where it helps, and update status and % done before the <b>Saturday 2:00 PM</b> cut-off. Mark up to three as top priorities. Unfinished activities from last week can be carried over in one click.</p>
    <h3>Month</h3><p>Deliverables are the concrete outputs that move a key result, each due in a month with a weight. The owner marks a deliverable done with evidence; their manager accepts or returns it. Accepted deliverables feed the key result (when it is measured from deliverables) and the owner's personal score.</p>
    <p>Managers switch to <b>Team</b> to see everyone they look after.</p></>}>
    <Cmd right={<>
      <Seg value={view} options={[['week', 'Week'], ['month', 'Month']]} onChange={setView} />
      {lead && <Seg value={who} options={[['me', 'Mine'], ['team', 'Team']]} onChange={setWho} />}
      <button className="btn sm" onClick={() => setWs(new Date(ws.getTime() - (view === 'week' ? 7 : 30) * 864e5))}>‹</button>
      <b>{view === 'week' ? `${MONTHS[month - 1]} week ${weekNo(FY, ws)} · from ${wk}` : `${MONTHS[month - 1]} ${FY}`}</b>
      <button className="btn sm" onClick={() => setWs(new Date(ws.getTime() + (view === 'week' ? 7 : 30) * 864e5))}>›</button>
      <button className="btn sm" onClick={() => setWs(weekStart(new Date()))}>Today</button></>} />
    {view === 'week' && <>
      {now < cutoff && now > new Date(ws.getTime()) && <div className="banner">Update by Saturday 2:00 PM ({ymd(cutoff)}).</div>}
      <div className="row" style={{ marginBottom: 10 }}><button className="btn pri" onClick={() => setAdd({ week_start: wk, status: 'Not started', pct: 0 })}>+ Activity</button>
        {carry.length > 0 && <button className="btn" onClick={() => save(() => sb.from('activities').insert(carry.map(a => ({ unit_id: a.unit_id, owner_position_id: me.id, week_start: wk, title: a.title, deliverable_id: a.deliverable_id, status: a.status === 'Stuck' ? 'Stuck' : 'In progress', pct: a.pct, top: a.top, created_by: user.id }))), ['activities'], `${carry.length} carried over`)}>Carry over {carry.length} unfinished</button>}</div>
      {people.map(p => { const mine = acts.filter(a => a.owner_position_id === p.id).sort((a, b) => Number(b.top) - Number(a.top)); if (who === 'team' && !mine.length) return null;
        return <div key={p.id} className="card"><div className="row"><h3>{p.holder_name || p.title}</h3><span className="note">{p.title}</span><span className="sp" />{who === 'team' && <span className="note">{mine.filter(a => a.status === 'Done').length}/{mine.length} done</span>}</div>
          {mine.length ? <div className="tw" style={{ marginTop: 8 }}><table className="t"><thead><tr><th>Activity</th><th>Deliverable</th><th>Status</th><th className="n">% done</th><th /></tr></thead><tbody>
            {mine.map(a => { const editable = a.owner_position_id === me.id || can('managePeople'); return <tr key={a.id}><td>{a.top ? '★ ' : ''}{a.title}{a.note && <div className="note">{a.note}</div>}</td><td className="note">{byId(db.deliverables, a.deliverable_id)?.title || (a.unplanned ? 'Unplanned' : '—')}</td>
              <td>{editable ? <select value={a.status} onChange={e => upd(a, { status: e.target.value, pct: e.target.value === 'Done' ? 100 : a.pct })}>{ST.map(s => <option key={s}>{s}</option>)}</select> : <Pill tone={tone(a.status)}>{a.status}</Pill>}</td>
              <td className="n">{editable ? <NumIn value={Number(a.pct)} w={60} onChange={v => upd(a, { pct: Math.max(0, Math.min(100, v || 0)), status: v === 100 ? 'Done' : a.status === 'Not started' && v ? 'In progress' : a.status })} /> : a.pct + '%'}</td>
              <td>{editable && <div className="row"><button className="btn sm" onClick={() => upd(a, { top: !a.top })}>{a.top ? 'Unstar' : '★'}</button><button className="btn sm danger" onClick={() => save(() => sb.from('activities').delete().eq('id', a.id), ['activities'])}>×</button></div>}</td></tr>; })}
          </tbody></table></div> : <p className="note">No activities this week yet.</p>}</div>; })}
      {who === 'team' && !acts.length && <Empty>No team activities this week yet.</Empty>}
    </>}
    {view === 'month' && <>
      {lead && <div className="row" style={{ marginBottom: 10 }}><button className="btn pri" onClick={() => setDm({ month, status: 'planned', unit_id: me.unit_id || unit })}>+ Deliverable</button></div>}
      {!dels.length ? <Empty>No deliverables for {MONTHS[month - 1]}.{lead ? ' Add the outputs that will move each key result this month.' : ''}</Empty> :
        <div className="tw"><table className="t"><thead><tr><th>Deliverable</th><th>Owner</th><th>Key result</th><th className="n">Target</th><th className="n">Weight</th><th>Status</th><th /></tr></thead><tbody>
          {dels.map(d => { const own = d.owner_position_id === me.id; const mgr = can('managePeople') && !own;
            return <tr key={d.id}><td>{d.title}{d.evidence_url && <div><a href={d.evidence_url} target="_blank" rel="noreferrer">evidence</a></div>}</td><td>{posName(db, d.owner_position_id)}</td><td className="note">{byId(db.key_results, d.key_result_id)?.title || '—'}</td>
              <td className="n">{d.target != null ? `${d.target} ${d.uom || ''}` : ''}</td><td className="n">{d.weight != null ? d.weight + '%' : ''}</td><td><Pill tone={tone(d.status)}>{d.status}</Pill></td>
              <td><div className="row">{own && ['planned', 'returned'].includes(d.status) && <button className="btn sm pri" onClick={() => { const ev = prompt('Link to evidence (optional)') ?? ''; updD(d, { status: 'done', evidence_url: ev || null }, 'Marked done'); }}>Done</button>}
                {mgr && d.status === 'done' && <><button className="btn sm pri" onClick={() => updD(d, { status: 'accepted', actual: d.target }, 'Accepted')}>Accept</button><button className="btn sm" onClick={() => updD(d, { status: 'returned' }, 'Returned')}>Return</button></>}
                {lead && <button className="btn sm" onClick={() => setDm(d)}>Edit</button>}</div></td></tr>; })}
        </tbody></table></div>}
      {!lead && myDels.length === 0 && <p className="note">Your manager adds your deliverables during quarter planning.</p>}
    </>}
    {add && <Modal title="New activity" onClose={() => setAdd(null)}>
      <label className="f">Activity<input type="text" value={add.title || ''} onChange={e => setAdd({ ...add, title: e.target.value })} /></label>
      <label className="f">Deliverable it moves<select value={add.deliverable_id || ''} onChange={e => setAdd({ ...add, deliverable_id: e.target.value || null, unplanned: !e.target.value })}><option value="">Unplanned / none</option>{myDels.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}</select></label>
      <label className="row"><input type="checkbox" checked={!!add.top} onChange={e => setAdd({ ...add, top: e.target.checked })} /> Top priority this week</label>
      <div className="row end"><button className="btn" onClick={() => setAdd(null)}>Cancel</button><button className="btn pri" disabled={!add.title?.trim()} onClick={async () => { if (await save(() => sb.from('activities').insert({ ...add, title: add.title.trim(), unit_id: me.unit_id || unit, owner_position_id: me.id, created_by: user.id }), ['activities'], 'Activity added')) setAdd(null); }}>Add</button></div></Modal>}
    {dm && <DelModal init={dm} team={team.length ? team : [me]} onClose={() => setDm(null)} />}
  </Page>;
}

function DelModal({ init, team, onClose }: { init: Row; team: Row[]; onClose: () => void }) {
  const { db, user, unit } = useData(); const save = useSave(); const [f, setF] = useState<Row>(init); if (!db) return null;
  const u = f.unit_id || unit; const krs = db.objectives.filter(o => o.unit_id === u).flatMap(o => krsOf(db, o.id));
  const set = (k: string, v: any) => setF(x => ({ ...x, [k]: v }));
  return <Modal title={f.id ? 'Edit deliverable' : 'New deliverable'} onClose={onClose}>
    <label className="f">Deliverable<input type="text" value={f.title || ''} onChange={e => set('title', e.target.value)} /></label>
    <label className="f">Key result it moves<select value={f.key_result_id || ''} onChange={e => set('key_result_id', e.target.value || null)}><option value="">—</option>{krs.map(k => <option key={k.id} value={k.id}>{k.title.slice(0, 100)}</option>)}</select></label>
    <div className="g4"><label className="f">Owner<select value={f.owner_position_id || ''} onChange={e => set('owner_position_id', e.target.value)}><option value="">—</option>{team.map(p => <option key={p.id} value={p.id}>{p.holder_name || p.title}</option>)}</select></label>
      <label className="f">Month<select value={f.month} onChange={e => set('month', Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
      <label className="f">Target<NumIn value={f.target} onChange={v => set('target', v)} /></label><label className="f">Weight (%)<NumIn value={f.weight} onChange={v => set('weight', v)} /></label></div>
    <div className="row end">{f.id && <button className="btn danger" onClick={async () => { if (await save(() => sb.from('deliverables').update({ status: 'removed' }).eq('id', f.id), ['deliverables'], 'Removed')) onClose(); }}>Remove</button>}<span className="sp" />
      <button className="btn" onClick={onClose}>Cancel</button><button className="btn pri" disabled={!f.title?.trim() || !f.owner_position_id} onClick={async () => {
        const row = { unit_id: u, key_result_id: f.key_result_id || null, owner_position_id: f.owner_position_id, month: f.month, title: f.title.trim(), target: f.target ?? null, weight: f.weight ?? null, uom: f.uom || null };
        if (await save(() => f.id ? sb.from('deliverables').update(row).eq('id', f.id) : sb.from('deliverables').insert({ ...row, status: 'planned', created_by: user.id }), ['deliverables'], 'Deliverable saved')) onClose(); }}>Save</button></div>
  </Modal>;
}
