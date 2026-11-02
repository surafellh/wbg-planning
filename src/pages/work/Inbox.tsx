/* WORK WINDOW — Inbox (managers): everything waiting for a decision, in one list. Me: my result and scorecard. Today: the start page. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useData, useSave, useTerms, byId, posName, notifyPositions, managerOf, type DB, type Row } from '../../lib/data';
import { sb } from '../../lib/supabase';
import { krsOf, krState, currentPeriod, periodLabel, pct, fmt, qMonths, qOfMonth, curMonth, MONTHS, personResult, bandOf, weekStart, ymd, weekLabel, workStats, cutoffOf } from '../../lib/calc';
import { Pill, Modal, Empty, Ring, Bar, NumIn, StatePill } from '../../lib/ui';
import { AcceptForm, teamOf, WeekReview, MyWeekCompact } from '../Work';
import { PersonDrawer } from '../Performance';

/** Build a proposed scorecard for a person for a quarter: their deliverables in the quarter and the key results they own. */
export async function proposeScorecard(db: DB, pos: Row, q: number, userId: string) {
  const ms = qMonths(q);
  const dels = db.deliverables.filter(d => d.owner_position_id === pos.id && ms.includes(d.month) && !['removed', 'transferred'].includes(d.status));
  const krs = db.key_results.filter(k => k.owner_position_id === pos.id);
  const items = [...dels.map(d => ({ item_type: 'deliverable', item_id: d.id, label: d.title })), ...krs.map(k => ({ item_type: 'kr', item_id: k.id, label: k.title }))];
  if (!items.length) return { error: 'No deliverables or key results for this person in Q' + q };
  const w = Math.round(100 / items.length * 100) / 100;
  const existing = db.scorecards.find(s => s.position_id === pos.id && s.quarter === q);
  const sc = existing ? await sb.from('scorecards').update({ status: 'Proposed', proposed_at: new Date().toISOString(), prepared_by: userId }).eq('id', existing.id).select('id').single()
    : await sb.from('scorecards').insert({ position_id: pos.id, fiscal_year: '2026/27', quarter: q, status: 'Proposed', proposed_at: new Date().toISOString(), prepared_by: userId }).select('id').single();
  if (sc.error) return { error: sc.error.message };
  await sb.from('scorecard_items').delete().eq('scorecard_id', sc.data.id);
  const r = await sb.from('scorecard_items').insert(items.map(i => ({ ...i, weight: w, scorecard_id: sc.data.id })));
  if (r.error) return { error: r.error.message };
  await notifyPositions(db, [pos.id], 'scorecard', `Your Q${q} scorecard is ready to agree`, '/me');
  return { error: null };
}

export function ScorecardEditor({ sc, onClose }: { sc: Row; onClose: () => void }) {
  const { db } = useData(); const save = useSave(); const [items, setItems] = useState<Row[]>(() => (db?.scorecard_items || []).filter(i => i.scorecard_id === sc.id).map(i => ({ ...i })));
  if (!db) return null; const tot = items.reduce((s, i) => s + (Number(i.weight) || 0), 0);
  return <Modal title={`Q${sc.quarter} scorecard · ${posName(db, sc.position_id)}`} onClose={onClose}>
    <div className="tw"><table className="t"><thead><tr><th>Item</th><th className="n">Weight %</th><th /></tr></thead><tbody>{items.map((i, n) => <tr key={i.id}><td>{i.item_type === 'kr' ? '◎ ' : '✓ '}{i.label}</td><td className="n"><NumIn value={i.weight} w={70} onChange={v => setItems(items.map((x, j) => j === n ? { ...x, weight: v } : x))} /></td><td><button className="btn sm" onClick={() => setItems(items.filter((_, j) => j !== n))}>×</button></td></tr>)}
      <tr className="b"><td>Total</td><td className="n" style={{ color: Math.round(tot) === 100 ? undefined : 'var(--bad)' }}>{fmt(tot, 1)}%</td><td /></tr></tbody></table></div>
    <div className="row end"><button className="btn" onClick={onClose}>Cancel</button><button className="btn pri" disabled={Math.round(tot) !== 100} onClick={async () => {
      await sb.from('scorecard_items').delete().eq('scorecard_id', sc.id);
      if (await save(() => sb.from('scorecard_items').insert(items.map(i => ({ scorecard_id: sc.id, item_type: i.item_type, item_id: i.item_id, label: i.label, weight: i.weight }))), ['scorecard_items'], 'Scorecard saved')) onClose(); }}>Save</button></div>
  </Modal>;
}

export function InboxPage() {
  const { role, db, user } = useData(); const head = role !== 'employee'; const tab = new URLSearchParams(location.search).get('tab') || (head ? 'decisions' : 'messages'); const [t2, setT2] = useState(tab);
  const unreadMsg = db ? db.messages.filter(m => m.to_user === user.id && !m.read_at).length : 0;
  return <div className="light"><div className="lhead"><div><h1>Inbox</h1><p>Decisions waiting for you, and messages.</p></div></div>
    <div className="tabs">{head && <button className={t2 === 'decisions' ? 'on' : ''} onClick={() => setT2('decisions')}>Decisions</button>}<button className={t2 === 'messages' ? 'on' : ''} onClick={() => setT2('messages')}>Messages{unreadMsg ? ` (${unreadMsg})` : ''}</button></div>
    {t2 === 'decisions' && head ? <Inbox embedded /> : <Messages />}</div>;
}

export function Inbox({ embedded }: { embedded?: boolean }) {
  const { db, me, role, user, can } = useData(); const save = useSave(); const { t } = useTerms();
  const [acc, setAcc] = useState<Row | null>(null); const [rev, setRev] = useState<Row | null>(null); const [sce, setSce] = useState<Row | null>(null); const [note, setNote] = useState<Record<string, string>>({});
  if (!db || !me) return null;
  const team = teamOf(db, me, ['unit_head', 'planning_head', 'super_admin', 'group_strategy', 'executive'].includes(role)).filter(p => p.id !== me.id);
  const ids = new Set(team.map(p => p.id)); const q = qOfMonth(curMonth()); const wk = ymd(weekStart(new Date(Date.now() - 7 * 864e5)));
  const objs = db.objectives.filter(o => o.status === 'Submitted' && (ids.has(o.owner_position_id) || (can('approve') && o.level !== 'individual')));
  const dels = db.deliverables.filter(d => d.status === 'done' && ids.has(d.owner_position_id));
  const weeks = db.week_reviews.filter(r => ids.has(r.position_id) && r.submitted_at && !r.feedback_at);
  const discuss = db.scorecards.filter(s => ids.has(s.position_id) && s.status === 'Discuss');
  const noCard = team.filter(p => p.level === 'employee' && !db.scorecards.some(s => s.position_id === p.id && s.quarter === q));
  const stuck = db.activities.filter(a => a.status === 'Stuck' && ids.has(a.owner_position_id));
  const total = objs.length + dels.length + weeks.length + discuss.length + stuck.length;
  async function decideObj(o: Row, ok: boolean) {
    const n = note[o.id]?.trim() || null; if (!ok && !n) { alert('Write a short note so they know what to change.'); return; }
    if (await save(() => sb.from('objectives').update({ status: ok ? 'Approved' : 'Returned', approved_by: ok ? user.id : null, approved_at: ok ? new Date().toISOString() : null, review_note: n }).eq('id', o.id), ['objectives'], ok ? 'Approved' : 'Returned'))
      await notifyPositions(db!, [o.owner_position_id], 'okr', `${ok ? 'Approved' : 'Returned'}: ${o.text}`, '/goals', n || undefined);
  }
  return <div className={embedded ? '' : 'light'}>
    <p className="note" style={{ marginBottom: 10 }}>{total ? `${total} things waiting for you` : 'Nothing waiting — all clear.'}</p>
    {objs.length > 0 && <section className="lsec"><h3>{t('objective', true)} to approve · {objs.length}</h3>{objs.map(o => <div key={o.id} className="lcard stack">
      <div className="row"><b style={{ flex: 1 }}>{o.text}</b><span className="note">{posName(db, o.owner_position_id)}</span></div>
      <ul className="mini" style={{ margin: 0 }}>{krsOf(db, o.id).map(k => <li key={k.id}>{k.title} — target {fmt(Number(k.year_target), 1)} {k.uom === 'done' ? '' : k.uom || ''}</li>)}</ul>
      <div className="mini">Supports: {byId(db.objectives, o.parent_objective_id)?.text || byId(db.key_results, o.parent_kr_id)?.title || byId(db.unit_goals, o.unit_goal_id)?.name || 'not linked'}</div>
      <div className="row"><input type="text" style={{ flex: 1 }} placeholder="Note (needed when returning)" value={note[o.id] || ''} onChange={e => setNote({ ...note, [o.id]: e.target.value })} /><button className="btn" onClick={() => decideObj(o, false)}>Return</button><button className="btn pri" onClick={() => decideObj(o, true)}>Approve</button></div></div>)}</section>}
    {dels.length > 0 && <section className="lsec"><h3>{t('deliverable', true)} to accept · {dels.length}</h3>{dels.map(d => <div key={d.id} className="lcard row"><span style={{ flex: 1 }}><b>{d.title}</b><div className="mini">{posName(db, d.owner_position_id)} · {MONTHS[d.month - 1]}{d.evidence_url ? ' · evidence attached' : ''}</div></span><button className="btn pri" onClick={() => setAcc(d)}>Review</button></div>)}</section>}
    {stuck.length > 0 && <section className="lsec"><h3>Stuck in your team · {stuck.length}</h3>{stuck.map(a => <div key={a.id} className="lcard row"><span style={{ flex: 1 }}><b>{a.title}</b><div className="mini">{posName(db, a.owner_position_id)} · {a.blocker || 'no reason given'}</div></span><Link className="btn sm" to="/week">Open week</Link></div>)}</section>}
    {weeks.length > 0 && <section className="lsec"><h3>Week summaries to read · {weeks.length}</h3>{weeks.map(r => <div key={r.id} className="lcard row"><span style={{ flex: 1 }}><b>{posName(db, r.position_id)}</b><div className="mini">{weekLabel(new Date(r.week_start + 'T00:00:00Z'))} · {(r.wins || '').slice(0, 90)}</div></span><button className="btn sm pri" onClick={() => setRev(r)}>Read & reply</button></div>)}</section>}
    {discuss.length > 0 && <section className="lsec"><h3>Scorecards to discuss · {discuss.length}</h3>{discuss.map(s => <div key={s.id} className="lcard row"><span style={{ flex: 1 }}><b>{posName(db, s.position_id)}</b><div className="mini">Q{s.quarter} · “{s.person_note}”</div></span><button className="btn sm" onClick={() => setSce(s)}>Adjust</button><button className="btn sm pri" onClick={async () => { if (await save(() => sb.from('scorecards').update({ status: 'Proposed', proposed_at: new Date().toISOString() }).eq('id', s.id), ['scorecards'], 'Sent again')) await notifyPositions(db, [s.position_id], 'scorecard', `Your Q${s.quarter} scorecard was updated — please agree`, '/me'); }}>Send again</button></div>)}</section>}
    {noCard.length > 0 && <section className="lsec"><h3>Q{q} scorecards not prepared · {noCard.length}</h3><div className="lcard"><p className="note">A scorecard lists the deliverables and {t('key_result', true).toLowerCase()} a person is measured on this quarter. Prepare it from what is already planned; they agree or ask to discuss.</p>
      <div className="row" style={{ flexWrap: 'wrap' }}>{noCard.slice(0, 30).map(p => <button key={p.id} className="btn sm" onClick={async () => { const r = await proposeScorecard(db, p, q, user.id); if (r.error) alert(r.error); else await save(() => Promise.resolve({ error: null }) as any, ['scorecards', 'scorecard_items'], `Scorecard sent to ${p.holder_name}`); }}>{p.holder_name}</button>)}</div></div></section>}
    {!total && !noCard.length && <Empty>All clear.</Empty>}
    {acc && <Modal title="Review deliverable" onClose={() => setAcc(null)}><AcceptForm d={acc} onDone={() => setAcc(null)} /></Modal>}
    {rev && <Modal title={`${posName(db, rev.position_id)} · ${weekLabel(new Date(rev.week_start + 'T00:00:00Z'))}`} onClose={() => setRev(null)} wide><MyWeekCompact who={byId(db.positions, rev.position_id)!} wk={rev.week_start} /><WeekReview me={byId(db.positions, rev.position_id)!} wk={rev.week_start} mine={false} /></Modal>}
    {sce && <ScorecardEditor sc={sce} onClose={() => setSce(null)} />}
    {wk && null}
  </div>;
}

export function Me() {
  const { db, me } = useData(); const save = useSave(); const [why, setWhy] = useState(''); const [det, setDet] = useState(false); if (!db || !me) return null;
  const p = currentPeriod('Q'); const r = personResult(db, me, p); const sc = db.scorecards.find(s => s.position_id === me.id && s.quarter === p.n); const items = sc ? db.scorecard_items.filter(i => i.scorecard_id === sc.id) : [];
  const months = Array.from({ length: curMonth() }, (_, i) => personResult(db, me, { t: 'M', n: i + 1 }).R);
  return <div className="light narrow">
    <div className="lhead"><div><h1>My performance</h1><p>{periodLabel(p)} · measured against this quarter's targets</p></div></div>
    <div className="lcard row" style={{ gap: 20 }}><Ring p={r.R} size={92} /><div className="stack" style={{ gap: 4 }}><b style={{ fontSize: 20 }}>{pct(r.R)} · {bandOf(r.R, db)}</b>
      <div className="note">{Math.round(r.s * 100)}% from {byId(db.org_units, me.org_unit_id)?.name} ({pct(r.org)}) + {Math.round((1 - r.s) * 100)}% from my own work ({pct(r.personal)})</div><div className="mini">{r.basis}</div><button className="linkbtn" onClick={() => setDet(true)}>See the details</button></div></div>
    <section className="lsec"><h3>My Q{p.n} scorecard</h3>
      {!sc ? <div className="lcard"><p className="note">Your manager hasn't prepared this quarter's scorecard yet. Until then your result uses your deliverables and the results you own.</p></div> :
        <div className="lcard stack"><div className="row"><span style={{ flex: 1 }}>{items.length} items</span><Pill tone={sc.status === 'Agreed' ? 'good' : sc.status === 'Discuss' ? 'warn' : 'info'}>{sc.status === 'Proposed' ? 'Waiting for you' : sc.status}</Pill></div>
          <div className="stack" style={{ gap: 2 }}>{items.map(i => { const k = i.item_type === 'kr' ? byId(db.key_results, i.item_id) : null; const d = i.item_type === 'deliverable' ? byId(db.deliverables, i.item_id) : null;
            return <div key={i.id} className="krline"><span style={{ flex: 1 }}>{i.label}<div className="mini">{d ? `${MONTHS[d.month - 1]} deliverable · ${d.status}` : k ? 'Key result' : ''}</div></span>{k && <StatePill s={krState(db, k, p)} />}<b>{fmt(Number(i.weight), 0)}%</b></div>; })}</div>
          {sc.status === 'Proposed' && <><input type="text" placeholder="If something should change, say what (for Discuss)" value={why} onChange={e => setWhy(e.target.value)} />
            <div className="row end"><button className="btn" disabled={!why.trim()} onClick={async () => { if (await save(() => sb.from('scorecards').update({ status: 'Discuss', person_note: why.trim() }).eq('id', sc.id), ['scorecards'], 'Sent back to discuss')) await notifyPositions(db, [managerOf(db, me)?.id], 'scorecard', `${me.holder_name} wants to discuss the Q${p.n} scorecard`, '/inbox', why.trim()); }}>Discuss</button>
              <button className="btn pri big" onClick={async () => { if (await save(() => sb.from('scorecards').update({ status: 'Agreed', agreed_at: new Date().toISOString() }).eq('id', sc.id), ['scorecards'], 'Agreed')) await notifyPositions(db, [managerOf(db, me)?.id], 'scorecard', `${me.holder_name} agreed the Q${p.n} scorecard`, '/inbox'); }}>I agree</button></div></>}</div>}</section>
    <section className="lsec"><h3>By month</h3><div className="lcard row" style={{ alignItems: 'flex-end', gap: 14 }}>{months.map((v, i) => <div key={i} style={{ textAlign: 'center', flex: 1 }}><div style={{ height: 80, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}><div style={{ width: 22, height: Math.max(2, (v || 0) * 80), background: 'var(--accent)', borderRadius: 4 }} title={pct(v)} /></div><small>{MONTHS[i]}</small><div className="mini">{pct(v)}</div></div>)}</div></section>
    {det && <PersonDrawer pos={me} p={p} onClose={() => setDet(false)} />}
  </div>;
}

export function Today() {
  const { db, me, role } = useData(); const { t } = useTerms(); if (!db || !me) return null;
  const ws = weekStart(new Date()); const wk = ymd(ws); const acts = db.activities.filter(a => a.owner_position_id === me.id && a.week_start === wk); const st = workStats(db, new Set([me.id]), wk);
  const p = currentPeriod('Q'); const myKrs = db.key_results.filter(k => k.owner_position_id === me.id);
  const toUpdate = myKrs.filter(k => k.measure === 'manual' && !db.check_ins.some(c => c.kr_id === k.id && c.created_at > new Date(Date.now() - 30 * 864e5).toISOString()));
  const dels = db.deliverables.filter(d => d.owner_position_id === me.id && d.month === curMonth() && d.status !== 'removed'); const r = personResult(db, me, p);
  const lead = role !== 'employee'; const team = lead ? teamOf(db, me, ['unit_head', 'planning_head', 'super_admin', 'group_strategy', 'executive'].includes(role)).filter(x => x.id !== me.id) : []; const tids = new Set(team.map(x => x.id));
  const waiting = db.objectives.filter(o => o.status === 'Submitted' && tids.has(o.owner_position_id)).length + db.deliverables.filter(d => d.status === 'done' && tids.has(d.owner_position_id)).length + db.week_reviews.filter(x => tids.has(x.position_id) && x.submitted_at && !x.feedback_at).length;
  const sc = db.scorecards.find(s => s.position_id === me.id && s.quarter === p.n && s.status === 'Proposed'); const cut = cutoffOf(ws);
  const h = new Date().getHours(); const hello = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return <div className="light">
    <div className="lhead"><div><h1>{hello}, {(me.holder_name || '').split(' ')[0]}</h1><p>{weekLabel(ws)} · update your week by Saturday 2:00 PM{new Date() < cut ? '' : ''}</p></div></div>
    {sc && <Link to="/me" className="lbanner">Your Q{p.n} scorecard is ready — review and agree →</Link>}
    {lead && waiting > 0 && <Link to="/inbox" className="lbanner">{waiting} things in your inbox waiting for a decision →</Link>}
    <div className="tiles3">
      <Link to="/record?tab=week" className="ltile"><small>This week</small><b>{acts.length ? `${st.done} of ${acts.length} done` : 'Not planned yet'}</b><Bar p={st.completion} /><span>{acts.length ? 'Update my week →' : 'Plan my week →'}</span></Link>
      <Link to="/strategy" className="ltile"><small>My department's {t('key_result', true).toLowerCase()}</small><b>{toUpdate.length ? `${toUpdate.length} to update` : myKrs.length ? 'All up to date' : 'None yet'}</b><span>See how we are doing →</span></Link>
      <Link to="/plan?tab=deliverables" className="ltile"><small>{MONTHS[curMonth() - 1]} {t('deliverable', true).toLowerCase()}</small><b>{dels.length ? `${dels.filter(d => d.status === 'accepted').length} of ${dels.length} accepted` : 'None this month'}</b><span>Open →</span></Link>
    </div>
    {acts.length > 0 && <section className="lsec"><h3>This week's priorities</h3><div className="lcard">{acts.filter(a => a.status !== 'Done').sort((a, b) => Number(b.top) - Number(a.top)).slice(0, 5).map(a => <div key={a.id} className="krline"><span style={{ flex: 1 }}>{a.top ? '★ ' : ''}{a.title}</span><Pill tone={a.status === 'Stuck' ? 'bad' : a.status === 'In progress' ? 'warn' : 'none'}>{a.status}</Pill><span className="mini">{a.pct}%</span></div>)}{acts.every(a => a.status === 'Done') && <p className="note">Everything done this week.</p>}</div></section>}
    {toUpdate.length > 0 && <section className="lsec"><h3>Needs an update</h3><div className="lcard">{toUpdate.slice(0, 5).map(k => <div key={k.id} className="krline"><span style={{ flex: 1 }}>{k.title}</span><Link className="btn sm pri" to="/record?tab=krs">Update</Link></div>)}</div></section>}
    <section className="lsec"><h3>My result · {periodLabel(p)}</h3><Link to="/me" className="lcard row" style={{ textDecoration: 'none', color: 'inherit', gap: 16 }}><Ring p={r.R} size={56} /><span><b>{pct(r.R)} · {bandOf(r.R, db)}</b><div className="mini">{r.basis}</div></span></Link></section>
  </div>;
}

/** Direct messages between colleagues. */
export function Messages() {
  const { db, user, reload } = useData(); const [withU, setWith] = useState<string>(''); const [txt, setTxt] = useState(''); const [q, setQ] = useState('');
  if (!db) return null;
  const nameOf = (u: string) => db.positions.find(p => p.user_id === u)?.holder_name || db.profiles.find(p => p.id === u)?.full_name || db.profiles.find(p => p.id === u)?.email || 'Someone';
  const mine = db.messages.filter(m => m.from_user === user.id || m.to_user === user.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const convs = Array.from(new Set(mine.map(m => m.from_user === user.id ? m.to_user : m.from_user))).map(u => ({ u, last: mine.filter(m => m.from_user === u || m.to_user === u).slice(-1)[0], unread: mine.filter(m => m.from_user === u && !m.read_at).length })).sort((a, b) => b.last.created_at.localeCompare(a.last.created_at));
  const people = db.positions.filter(p => p.user_id && p.user_id !== user.id && (!q || (p.holder_name || '').toLowerCase().includes(q.toLowerCase())));
  const thread = mine.filter(m => m.from_user === withU || m.to_user === withU);
  async function open(u: string) { setWith(u); const ids = mine.filter(m => m.from_user === u && !m.read_at).map(m => m.id); if (ids.length) { await sb.from('messages').update({ read_at: new Date().toISOString() }).in('id', ids); await reload(['messages']); } }
  async function send() { const b = txt.trim(); if (!b || !withU) return; const { error } = await sb.from('messages').insert({ from_user: user.id, to_user: withU, body: b }); if (!error) { setTxt(''); await sb.rpc('notify', { user_ids: [withU], kind: 'message', title: `Message from ${nameOf(user.id)}`, body: b.slice(0, 140), link: '/inbox?tab=messages' }); await reload(['messages']); } }
  return <div className="chat"><div className="chatl"><input type="text" placeholder="Find a colleague to message" value={q} onChange={e => setQ(e.target.value)} />
    {q ? people.slice(0, 20).map(p => <button key={p.id} className="chatc" onClick={() => { open(p.user_id); setQ(''); }}><b>{p.holder_name}</b><small>{p.title}</small></button>)
      : convs.length ? convs.map(c => <button key={c.u} className={'chatc' + (withU === c.u ? ' on' : '')} onClick={() => open(c.u)}><b>{nameOf(c.u)}{c.unread ? ` (${c.unread})` : ''}</b><small>{c.last.body.slice(0, 50)}</small></button>) : <p className="note" style={{ padding: 10 }}>No conversations yet — find a colleague above.</p>}</div>
    <div className="chatr">{!withU ? <p className="note" style={{ padding: 20 }}>Choose a conversation.</p> : <><div className="chath"><b>{nameOf(withU)}</b></div>
      <div className="chatm">{thread.map(m => <div key={m.id} className={'msg' + (m.from_user === user.id ? ' me' : '')}><div>{m.body}</div><small>{m.created_at.slice(5, 16).replace('T', ' ')}</small></div>)}</div>
      <div className="row" style={{ padding: 10 }}><input type="text" style={{ flex: 1 }} value={txt} onChange={e => setTxt(e.target.value)} placeholder="Write a message" onKeyDown={e => { if (e.key === 'Enter') send(); }} /><button className="btn pri" onClick={send} disabled={!txt.trim()}>Send</button></div></>}</div></div>;
}
