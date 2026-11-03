/* WORK WINDOW — Inbox (managers): everything waiting for a decision, in one list. Me: my result and scorecard. Today: the start page. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useData, useSave, useTerms, byId, posName, notifyPositions, managerOf, canEnterActuals, moduleOn, type DB, type Row } from '../../lib/data';
import { sb } from '../../lib/supabase';
import { krsOf, krState, currentPeriod, periodLabel, pct, fmt, qMonths, qOfMonth, curMonth, MONTHS, personResult, bandOf, weekStart, ymd, weekLabel, workStats, cutoffOf, cutoffLabel } from '../../lib/calc';
import { HowItWorks, Pill, Modal, Empty, Ring, Bar, NumIn, StatePill } from '../../lib/ui';
import { AcceptForm, teamOf, WeekReview, MyWeekCompact } from '../Work';
import { PersonDrawer } from '../Performance';
import { weeksOfMonth } from './Plan';
import { StatusBar } from '../OkrPlan';

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
  const { role, db, user } = useData(); const head = role !== 'employee'; const msgs = moduleOn(db, 'messages'); const tab = new URLSearchParams(location.search).get('tab') || 'decisions'; const [t2, setT2] = useState(tab);
  const unreadMsg = db ? db.messages.filter(m => m.to_user === user.id && !m.read_at).length : 0;
  return <div className="light"><div className="lhead"><div><h1>Inbox</h1><p>{head ? 'Decisions waiting for you, and messages.' : 'What is waiting for you, and messages.'}<HowItWorks><h3>What this page is for</h3><p>Everything that needs a reply from you. <b>Decisions</b> (leaders): deliverables to accept, plans and proposals to confirm, rescope and target-change requests, position claims, ERP OKRs to replan. <b>For me</b>: replies, returned items and mentions. <b>Messages</b>: conversations with colleagues. Notification types can be switched off in Studio → Configuration.</p></HowItWorks></p></div></div>
    <div className="tabs"><button className={t2 === 'decisions' ? 'on' : ''} onClick={() => setT2('decisions')}>{head ? 'Decisions' : 'For me'}</button>{msgs && <button className={t2 === 'messages' ? 'on' : ''} onClick={() => setT2('messages')}>Messages{unreadMsg ? ` (${unreadMsg})` : ''}</button>}</div>
    {t2 === 'decisions' ? (head ? <Inbox embedded /> : <ForMe />) : <Messages />}</div>;
}
/** Team members: what is waiting for them — scorecard to agree, returned deliverables, feedback, notifications. */
function ForMe() {
  const { db, me } = useData(); const { t } = useTerms(); if (!db || !me) return null;
  const q = qOfMonth(curMonth()); const sc = db.scorecards.find(s => s.position_id === me.id && s.quarter === q && s.status === 'Proposed');
  const returned = db.deliverables.filter(d => d.owner_position_id === me.id && d.status === 'returned');
  const fb = db.week_reviews.filter(r => r.position_id === me.id && r.feedback_at).sort((a, b) => b.feedback_at.localeCompare(a.feedback_at)).slice(0, 5);
  const notes = db.notifications.filter(n => n.user_id === me.user_id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 15);
  return <div>
    {sc && <Link to="/me" className="lbanner">Your Q{q} scorecard is ready — review and agree →</Link>}
    {returned.length > 0 && <section className="lsec"><h3>{t('deliverable', true)} returned to you · {returned.length}</h3>{returned.map(d => <div key={d.id} className="lcard row"><span style={{ flex: 1 }}><b>{d.title}</b><div className="mini">{d.feedback || 'See the feedback'}</div></span><Link className="btn sm pri" to="/record?tab=deliverables">Fix & deliver again</Link></div>)}</section>}
    {fb.length > 0 && <section className="lsec"><h3>Feedback on your weeks</h3>{fb.map(r => <div key={r.id} className="lcard"><b>{weekLabel(new Date(r.week_start + 'T00:00:00Z'))}</b> {r.rating ? '★'.repeat(r.rating) : ''}<div className="mini">{r.feedback}</div></div>)}</section>}
    <section className="lsec"><h3>Recent notifications</h3>{notes.length ? <div className="lcard">{notes.map(n => <div key={n.id} className="krline"><span style={{ flex: 1 }}>{n.title}{n.body && <div className="mini">{n.body}</div>}</span>{n.link && <Link className="mini" to={n.link}>Open →</Link>}</div>)}</div> : <Empty>Nothing new.</Empty>}</section>
  </div>;
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
  const proposed = db.deliverables.filter(d => d.source === 'proposed' && d.status !== 'removed' && ids.has(d.owner_position_id));
  const erp = db.deliverables.filter(d => d.source === 'erp' && d.status !== 'removed' && (ids.has(d.owner_position_id) || d.owner_position_id === me.id));
  const rescopes = can('approve') ? db.rescopes.filter(r => r.status === 'Submitted') : [];
  const fwReq = can('finalApprove') && db.settings.framework_request?.status === 'Pending' ? 1 : 0;
  const claims = can('settings') ? db.position_claims.filter(c => c.status === 'Pending') : [];
  const total = objs.length + dels.length + weeks.length + discuss.length + stuck.length + proposed.length + rescopes.length + fwReq + claims.length;
  async function decideObj(o: Row, ok: boolean) {
    const n = note[o.id]?.trim() || null; if (!ok && !n) { alert('Write a short note so they know what to change.'); return; }
    if (await save(() => sb.from('objectives').update({ status: ok ? 'Approved' : 'Returned', approved_by: ok ? user.id : null, approved_at: ok ? new Date().toISOString() : null, review_note: n }).eq('id', o.id), ['objectives'], ok ? 'Approved' : 'Returned'))
      await notifyPositions(db!, [o.owner_position_id], 'okr', `${ok ? 'Approved' : 'Returned'}: ${o.text}`, '/strategy', n || undefined);
  }
  return <div className={embedded ? '' : 'light'}>
    <p className="note" style={{ marginBottom: 10 }}>{total ? `${total} things waiting for you` : 'Nothing waiting — all clear.'}</p>
    {objs.length > 0 && <section className="lsec"><h3>{t('objective', true)} to approve · {objs.length}</h3>{objs.map(o => <div key={o.id} className="lcard stack">
      <div className="row"><b style={{ flex: 1 }}>{o.text}</b><span className="note">{posName(db, o.owner_position_id)}</span></div>
      <ul className="mini" style={{ margin: 0 }}>{krsOf(db, o.id).map(k => <li key={k.id}>{k.title} — target {fmt(Number(k.year_target), 1)} {k.uom === 'done' ? '' : k.uom || ''}</li>)}</ul>
      <div className="mini">Supports: {byId(db.objectives, o.parent_objective_id)?.text || byId(db.key_results, o.parent_kr_id)?.title || byId(db.unit_goals, o.unit_goal_id)?.name || 'not linked'}</div>
      <div className="row"><input type="text" style={{ flex: 1 }} placeholder="Note (needed when returning)" value={note[o.id] || ''} onChange={e => setNote({ ...note, [o.id]: e.target.value })} /><button className="btn" onClick={() => decideObj(o, false)}>Return</button><button className="btn pri" onClick={() => decideObj(o, true)}>Approve</button></div></div>)}</section>}
    {rescopes.length > 0 && <section className="lsec"><h3>Plan change requests to approve · {rescopes.length}</h3>{rescopes.map(r => <div key={r.id} className="lcard row"><span style={{ flex: 1 }}><b>{r.kind === 'okr_targets' ? 'Key-result target changes' : 'Rescope'} · {byId(db.org_units, r.unit_id)?.name}</b><div className="mini">{r.note || r.trigger} · {String(r.created_at || '').slice(0, 10)}</div></span><Link className="btn sm pri" to="/studio/rescope">Review</Link></div>)}</section>}
    {fwReq > 0 && <section className="lsec"><h3>Framework change request</h3><div className="lcard row"><span style={{ flex: 1 }}>Switch to <b>{db.settings.framework_request.type}</b> requested on {String(db.settings.framework_request.at).slice(0, 10)}</span><Link className="btn sm pri" to="/studio/framework">Review</Link></div></section>}
    {claims.length > 0 && <section className="lsec"><h3>Position claims to confirm · {claims.length}</h3><div className="lcard row"><span style={{ flex: 1 }}>People asking to be linked to a leadership position.</span><Link className="btn sm pri" to="/studio/people">Review</Link></div></section>}
    {proposed.length > 0 && <section className="lsec"><h3>{t('deliverable', true)} proposed by your team · {proposed.length}</h3><div className="lcard row"><span style={{ flex: 1 }}>{proposed.slice(0, 4).map(d => `${d.title} (${posName(db, d.owner_position_id)})`).join(' · ')}{proposed.length > 4 ? ' …' : ''}</span>
      <button className="btn sm" onClick={() => save(() => sb.from('deliverables').update({ source: 'plan' }).in('id', proposed.map(d => d.id)), ['deliverables'], 'Confirmed')}>Confirm all</button><Link className="btn sm pri" to="/plan?tab=deliverables">Review in Plan</Link></div></section>}
    {erp.length > 0 && <section className="lsec"><h3>{t('deliverable', true)} to replan · {erp.length}</h3><div className="lcard row"><span style={{ flex: 1 }}>Brought over from personal OKRs in the ERP. Link each to a {t('key_result').toLowerCase()}, set month and weight, or remove it.</span><Link className="btn sm pri" to="/plan?tab=deliverables">Replan</Link></div></section>}
    {dels.length > 0 && <section className="lsec"><h3>{t('deliverable', true)} to accept · {dels.length}</h3>{dels.map(d => <div key={d.id} className="lcard row"><span style={{ flex: 1 }}><b>{d.title}</b><div className="mini">{posName(db, d.owner_position_id)} · {MONTHS[d.month - 1]}{d.evidence_url ? ' · evidence attached' : ''}</div></span><button className="btn pri" onClick={() => setAcc(d)}>Review</button></div>)}</section>}
    {stuck.length > 0 && <section className="lsec"><h3>Stuck in your team · {stuck.length}</h3>{stuck.map(a => <div key={a.id} className="lcard row"><span style={{ flex: 1 }}><b>{a.title}</b><div className="mini">{posName(db, a.owner_position_id)} · {a.blocker || 'no reason given'}</div></span><Link className="btn sm" to="/record?tab=team">Open team week</Link></div>)}</section>}
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
    <div className="lhead"><div><h1>My performance</h1><p>{periodLabel(p)} · measured against this quarter's targets<HowItWorks><h3>What this page is for</h3><p>Your result for the period you choose. <b>Result = organisation part × its weight + your personal part × the rest.</b> Leaders carry the score of the organisation they lead (unit, department or division); team members are measured on their own work only. The personal part comes from your agreed scorecard, otherwise from accepted deliverables, otherwise from the key results you own. Weights are set in Studio → Configuration → Scoring.</p></HowItWorks></p></div></div>
    <div className="lcard row" style={{ gap: 20 }}><Ring p={r.R} size={92} /><div className="stack" style={{ gap: 4 }}><b style={{ fontSize: 20 }}>{pct(r.R)} · {bandOf(r.R, db)}</b>
      <div className="note">{r.s ? <>{Math.round(r.s * 100)}% from {r.orgLabel} ({pct(r.org)}) + {Math.round((1 - r.s) * 100)}% from my own work ({pct(r.personal)})</> : <>From my own work ({pct(r.personal)})</>}</div><div className="mini">{r.basis}</div><button className="linkbtn" onClick={() => setDet(true)}>See the details</button></div></div>
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

type Step = { label: string; done: boolean | null; detail: string; to: string; who?: string };
/** The cycle checklist for a person: what their role has to do this month/week, what is done, and a link to do it. */
function cycleSteps(db: DB, me: Row, role: string, t: (k: string, pl?: boolean) => string): Step[] {
  const cm = curMonth(); const q = qOfMonth(cm); const wk = ymd(weekStart(new Date())); const cut = cutoffOf(weekStart(new Date())).toISOString();
  const head = role !== 'employee'; const out: Step[] = [];
  if (role === 'executive') {
    // top management does not plan deliverables or weeks here: it reviews the Group and gives final approval
    const end = db.plan_status.filter(s => s.status === 'Endorsed').length; const rs = db.rescopes.filter(r => r.status === 'Submitted').length;
    out.push({ label: 'Give final approval to endorsed plans', done: end === 0, detail: end ? `${end} waiting — listed below` : 'Nothing waiting', to: '/today' });
    out.push({ label: `Review Group performance for Q${q}`, done: null, detail: 'Every unit, its objectives, financials and people', to: '/insights/group' });
    if (rs) out.push({ label: 'Rescopes under review', done: null, detail: `${rs} submitted — Group Strategy decides`, to: '/insights/reports' });
    return out;
  }
  const myDel = db.deliverables.filter(d => d.owner_position_id === me.id && d.month === cm && d.status !== 'removed');
  const acts = db.activities.filter(a => a.owner_position_id === me.id && a.week_start === wk);
  const mk = weeksOfMonth(cm).map(w => ymd(w)); const monthLocked = db.activities.some(a => a.owner_position_id === me.id && a.locked && mk.includes(a.week_start));
  const wr = db.week_reviews.find(r => r.position_id === me.id && r.week_start === wk);
  const sc = db.scorecards.find(s => s.position_id === me.id && s.quarter === q);
  if (head) {
    const led = headedOrgsT(db, me, role);
    const krs = db.key_results.filter(k => (k.state || 'active') === 'active' && db.objectives.some(o => o.id === k.objective_id && led.has(o.org_unit_id) && o.status !== 'Archived' && o.level !== 'individual'));
    const manual = krs.filter(k => k.measure === 'manual' || k.measure === 'deliverables');
    const withT = manual.filter(k => db.kr_targets.some(x => x.kr_id === k.id && x.quarter === q) || db.kr_month_targets.some(x => x.kr_id === k.id && qOfMonth(x.month) === q) || k.year_target != null);
    out.push({ label: `Set Q${q} targets for your ${t('key_result', true).toLowerCase()}`, done: manual.length ? withT.length === manual.length : null, detail: manual.length ? `${withT.length} of ${manual.length} have targets` : `No ${t('key_result', true).toLowerCase()} yet — add them in the objective planner`, to: manual.length ? '/plan?tab=targets' : '/studio/okr', who: 'Head' });
    const team = teamOf(db, me, ['unit_head', 'planning_head', 'super_admin', 'group_strategy', 'executive'].includes(role)).filter(x => x.id !== me.id && x.holder_name);
    const planned = team.filter(p => db.deliverables.some(d => d.owner_position_id === p.id && d.month === cm && d.status !== 'removed'));
    out.push({ label: `Plan ${MONTHS[cm - 1]} ${t('deliverable', true).toLowerCase()} with your team`, done: team.length ? planned.length === team.length : null, detail: `${planned.length} of ${team.length} people have ${t('deliverable', true).toLowerCase()} this month`, to: '/plan?tab=deliverables', who: 'Head' });
    const erp = db.deliverables.filter(d => d.source === 'erp' && d.status !== 'removed' && (team.some(p => p.id === d.owner_position_id) || d.owner_position_id === me.id)).length;
    if (erp) out.push({ label: 'Replan the deliverables brought over from personal ERP OKRs', done: false, detail: `${erp} still to replan`, to: '/plan?tab=deliverables', who: 'Head' });
    const man = krs.filter(k => k.measure === 'manual'); const fresh = man.filter(k => db.check_ins.some(c => c.kr_id === k.id && c.created_at > new Date(Date.now() - 30 * 864e5).toISOString()));
    if (man.length) out.push({ label: `Record progress on your ${t('key_result', true).toLowerCase()}`, done: fresh.length === man.length, detail: `${fresh.length} of ${man.length} updated in the last 30 days`, to: '/record?tab=krs', who: 'Head' });
    const waiting = db.deliverables.filter(d => d.status === 'done' && team.some(p => p.id === d.owner_position_id)).length;
    out.push({ label: `Accept or return delivered ${t('deliverable', true).toLowerCase()}`, done: waiting === 0, detail: waiting ? `${waiting} waiting for you` : 'Nothing waiting', to: '/record?tab=deliverables', who: 'Head' });
    const emp = team.filter(p => p.level === 'employee'); const cards = emp.filter(p => db.scorecards.some(s => s.position_id === p.id && s.quarter === q));
    if (emp.length) out.push({ label: `Prepare Q${q} scorecards`, done: cards.length === emp.length, detail: `${cards.length} of ${emp.length} prepared`, to: '/inbox', who: 'Head' });
  }
  out.push({ label: `Your ${MONTHS[cm - 1]} ${t('deliverable', true).toLowerCase()}`, done: myDel.length > 0, detail: myDel.length ? `${myDel.length} planned · ${myDel.filter(d => d.status === 'accepted').length} accepted` : head ? 'None for you this month' : 'None yet — propose them or ask your manager', to: '/plan?tab=deliverables' });
  out.push({ label: `Plan your ${MONTHS[cm - 1]} weeks and submit the month plan`, done: monthLocked || null, detail: monthLocked ? 'Submitted' : 'Plan activities week by week from your deliverables', to: '/plan?tab=week' });
  out.push({ label: `Update this week by ${cutoffLabel()}`, done: acts.length ? acts.every(a => (a.updated_at || a.created_at) <= cut && (a.status !== 'Not started' || (a.updated_at || '') > (a.created_at || ''))) : false, detail: acts.length ? `${acts.filter(a => a.status === 'Done').length} of ${acts.length} done` : 'No activities this week yet', to: '/record?tab=week' });
  out.push({ label: 'Submit your week summary', done: !!wr?.submitted_at, detail: wr?.submitted_at ? 'Submitted' : 'Wins, blockers, asks — at the bottom of Record → This week', to: '/record?tab=week' });
  const due = myDel.filter(d => d.status === 'planned' || d.status === 'returned');
  if (myDel.length) out.push({ label: `Deliver your ${t('deliverable', true).toLowerCase()} with evidence`, done: due.length === 0, detail: due.length ? `${due.length} not delivered yet` : 'All delivered', to: '/record?tab=deliverables' });
  out.push({ label: `Agree your Q${q} scorecard`, done: sc ? sc.status === 'Agreed' : null, detail: !sc ? 'Not prepared yet by your manager' : sc.status === 'Agreed' ? 'Agreed' : sc.status === 'Proposed' ? 'Waiting for you' : 'Under discussion', to: '/me' });
  if (canEnterActuals(db, me, role) && db.plan_lines.some(l => l.unit_id === me.unit_id)) { const u = me.unit_id; const lm = Math.max(1, cm - 1); const has = db.actuals.some(a => a.unit_id === u && a.month === lm);
    out.push({ label: `Enter ${MONTHS[lm - 1]} financial actuals`, done: has, detail: has ? 'Entered' : 'Revenue, cost of sales and budget lines', to: '/record?tab=finance', who: 'Finance' }); }
  return out;
}
const headedOrgsT = (db: DB, me: Row, role: string) => { const ids = new Set<string>(); const root = me.level === 'unit' || ['unit_head', 'planning_head', 'super_admin', 'group_strategy', 'executive'].includes(role) ? me.unit_id : me.org_unit_id; ids.add(root); let grew = true; while (grew) { grew = false; db.org_units.forEach(u => { if (u.parent_id && ids.has(u.parent_id) && !ids.has(u.id)) { ids.add(u.id); grew = true; } }); } return ids; };

export function Today() {
  const ctx = useData(); const { db, me, role } = ctx; const { t } = useTerms(); if (!db || !me) return null;
  const ws = weekStart(new Date()); const wk = ymd(ws); const acts = db.activities.filter(a => a.owner_position_id === me.id && a.week_start === wk); const st = workStats(db, new Set([me.id]), wk);
  const p = currentPeriod('Q');
  const scopeOrgs = role !== 'employee' ? headedOrgsT(db, me, role) : new Set<string>([me.org_unit_id]);
  const deptKrs = db.key_results.filter(k => (k.state || 'active') === 'active' && db.objectives.some(o => o.id === k.objective_id && scopeOrgs.has(o.org_unit_id) && o.status !== 'Archived' && o.level !== 'individual'));
  const sts = deptKrs.map(k => krState(db, k, p)); const onT = sts.filter(s => s.tone === 'good').length, off = sts.filter(s => s.tone === 'bad').length;
  const dels = db.deliverables.filter(d => d.owner_position_id === me.id && d.month === curMonth() && d.status !== 'removed'); const r = personResult(db, me, p);
  const sc = db.scorecards.find(s => s.position_id === me.id && s.quarter === p.n && s.status === 'Proposed');
  const steps = cycleSteps(db, me, role, t); const open = steps.filter(s => s.done === false);
  const h = new Date().getHours(); const hello = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return <div className="light">
    <div className="lhead"><div><h1>{hello}{me.holder_name ? ', ' + me.holder_name.split(' ')[0] : ''}</h1><p>{weekLabel(ws)} · {me.title} · {byId(db.org_units, me.org_unit_id)?.name}<HowItWorks><h3>What this page is for</h3><p>Your starting point each day: this week's plan and its status, your organisation's key results, this month's deliverables, and a checklist of the planning steps due now (targets, deliverables, week plan, updates before the cut-off). Click any card to go to the page where you act on it.</p></HowItWorks></p></div></div>
    {(() => { const { can } = ctx; const waiting = db.plan_status.filter(s => (s.status === 'Endorsed' && can('finalApprove')) || (s.status === 'Submitted' && can('approve')));
      return waiting.length > 0 && <section className="lsec"><h3>Plans waiting for your approval · {waiting.length}</h3>{waiting.map(s => <div key={s.unit_id + s.plan_kind + (s.period || '')}><div className="mini" style={{ margin: '6px 0 2px' }}>{byId(db.org_units, s.unit_id)?.name}</div><StatusBar unit={s.unit_id} kind={s.plan_kind} period={s.period || ''} label={s.plan_kind === 'okr' ? 'OKR plan 2026/27' : s.plan_kind === 'annual' ? 'Annual plan 2026/27' : s.plan_kind} /></div>)}</section>; })()}
    {(() => { const { can } = ctx; const waiting = db.plan_status.filter(s => (s.status === 'Endorsed' && can('finalApprove')) || (s.status === 'Submitted' && can('approve')));
      return waiting.length > 0 && <section className="lsec"><h3>Plans waiting for your approval · {waiting.length}</h3>{waiting.map(s => <div key={s.unit_id + s.plan_kind + (s.period || '')}><div className="mini" style={{ margin: '6px 0 2px' }}>{byId(db.org_units, s.unit_id)?.name}</div><StatusBar unit={s.unit_id} kind={s.plan_kind} period={s.period || ''} label={s.plan_kind === 'okr' ? 'OKR plan 2026/27' : s.plan_kind === 'annual' ? 'Annual plan 2026/27' : s.plan_kind} /></div>)}</section>; })()}
    {sc && <Link to="/me" className="lbanner">Your Q{p.n} scorecard is ready — review and agree →</Link>}
    <div className="tiles3">
      <Link to="/record?tab=week" className="ltile"><small>This week</small><b>{acts.length ? `${st.done} of ${acts.length} done` : 'Not planned yet'}</b><Bar p={st.completion} /><span>{acts.length ? 'Update my week →' : 'Plan my week →'}</span></Link>
      <Link to="/strategy" className="ltile"><small>{role !== 'employee' && scopeOrgs.size > 1 ? `${byId(db.org_units, me.org_unit_id)?.name} and below` : byId(db.org_units, me.org_unit_id)?.name} · {t('key_result', true).toLowerCase()}</small><b>{deptKrs.length ? (onT + off ? `${onT} on track · ${off} off track` : `${deptKrs.length} ${t('key_result', true).toLowerCase()} · no update yet`) : `No ${t('key_result', true).toLowerCase()} of its own`}</b><span>How we are doing →</span></Link>
      <Link to="/plan?tab=deliverables" className="ltile"><small>{MONTHS[curMonth() - 1]} {t('deliverable', true).toLowerCase()}</small><b>{dels.length ? `${dels.filter(d => d.status === 'accepted').length} of ${dels.length} accepted` : 'None this month'}</b><span>Open →</span></Link>
    </div>
    <section className="lsec"><h3>My checklist · {open.length ? `${open.length} to do` : 'all done'}</h3><div className="lcard checklist">
      {steps.map((s, i) => <Link key={i} to={s.to} className={'todoitem' + (s.done ? ' ok' : s.done === false ? ' todo' : '')}><span className="tick">{s.done ? '✓' : s.done === false ? '○' : '–'}</span><span style={{ flex: 1 }}><b>{s.label}</b><div className="mini">{s.detail}</div></span>{s.who && <span className="mini">{s.who}</span>}<span className="mini">→</span></Link>)}</div></section>
    {acts.length > 0 && <section className="lsec"><h3>This week's priorities</h3><div className="lcard">{acts.filter(a => a.status !== 'Done').sort((a, b) => Number(b.top) - Number(a.top)).slice(0, 5).map(a => <div key={a.id} className="krline"><span style={{ flex: 1 }}>{a.top ? '★ ' : ''}{a.title}</span><Pill tone={a.status === 'Stuck' ? 'bad' : a.status === 'In progress' ? 'warn' : 'none'}>{a.status}</Pill><span className="mini">{a.pct}%</span></div>)}{acts.every(a => a.status === 'Done') && <p className="note">Everything done this week.</p>}</div></section>}
    <section className="lsec"><h3>My result · {periodLabel(p)}</h3><Link to="/me" className="lcard row" style={{ textDecoration: 'none', color: 'inherit', gap: 16 }}><Ring p={r.R} size={56} /><span><b>{pct(r.R)} · {bandOf(r.R, db)}</b><div className="mini">{r.s ? `${Math.round(r.s * 100)}% ${r.orgLabel} + ${Math.round((1 - r.s) * 100)}% my work · ` : ''}{r.basis}</div></span></Link></section>
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
