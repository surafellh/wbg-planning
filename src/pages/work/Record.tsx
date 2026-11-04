/* WORK WINDOW — Record actuals: this week's activities, deliverables delivered, key-result progress, financial actuals.
   Spreadsheet form; "Save" writes everything at once. */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useData, useSave, useTerms, byId, posName, notifyPositions, managerOf, canEnterActuals, moduleOn, type Row } from '../../lib/data';
import { sb } from '../../lib/supabase';
import { cutoffLabel, FY, monthStart, MONTHS, curMonth, qOfMonth, weekStart, weekLabel, ymd, cutoffOf, krState, currentPeriod, krTarget, monthlyValues, linesOf, planBy, actualBy, lineActual, lineVals, lineQty, sum, money, fmt, pct } from '../../lib/calc';
import { HowItWorks, Seg, Empty, Pill, UnitPicker, Modal } from '../../lib/ui';
import { Sheet, useDraft, type Col } from '../../lib/sheet';
import { teamOf, WeekReview, TeamView, MonthView, CheckIns, Blockers } from '../Work';
import { isHead, SaveBar, headedOrgs, useDetail, DetailToggle, PRI, orgOf, depOpts } from './Plan';

const LEADS = ['unit_head', 'planning_head', 'super_admin', 'group_strategy', 'executive'];
const ST: [string, string][] = [['Not started', 'Not started'], ['In progress', 'In progress'], ['Done', 'Done'], ['Stuck', 'Blocked'], ['Delayed', 'Delayed'], ['Closed', 'Closed — will not be done']];

function ThisWeek() {
  const { db, me, role } = useData(); const save = useSave(); const { t } = useTerms(); const [ws, setWs] = useState(() => weekStart(new Date())); const [scope, setScope] = useState<'me' | 'team'>('me'); const [busy, setBusy] = useState(false); const [detail, setDetail] = useDetail('week');
  const head = isHead(role); const team = useMemo(() => db && me ? (head ? teamOf(db, me, LEADS.includes(role)) : [me]) : [], [db, me, head, role]);
  const wk = ymd(ws); const people = useMemo(() => scope === 'me' ? [me!] : team, [scope, me, team]);
  const name = (u: string) => db?.positions.find(p => p.user_id === u)?.holder_name || db?.profiles.find(p => p.id === u)?.full_name || '';
  const source = useMemo(() => { if (!db || !me) return []; const ids = new Set(people.map(p => p?.id));
    return db.activities.filter(a => ids.has(a.owner_position_id) && a.week_start === wk).sort((a, b) => Number(b.top) - Number(a.top) || (a.priority || 9) - (b.priority || 9))
      .map(a => ({ id: a.id, code: a.code || '', title: a.title, kind: a.kind || (a.unplanned ? 'Unplanned' : 'Task'), del: byId(db.deliverables, a.deliverable_id)?.title || (a.unplanned ? 'Unplanned' : ''), owner: a.owner_position_id, due: a.due_date || '', priority: a.priority != null ? String(a.priority) : '',
        prev: a.prev_status ? `${a.prev_status}${a.prev_pct != null ? ' ' + a.prev_pct + '%' : ''}` : '', status: a.status, pct: a.pct, target: a.target, uom: a.uom || '', actual: a.actual, done: a.done_at ? String(a.done_at).slice(0, 10) : '',
        blocker: a.blocker || '', help: a.help_from_unit || '', evidence: a.evidence_url || '', note: a.note || '', carried: a.carried_count || 0, upd: a.updated_at ? `${name(a.updated_by) || ''} ${String(a.updated_at).slice(5, 16).replace('T', ' ')}`.trim() : '' })); }, [db, me, people, wk]);
  const d = useDraft(source, [source]);
  if (!db || !me) return null;
  const prevWk = ymd(new Date(ws.getTime() - 7 * 864e5)); const carry = db.activities.filter(a => a.owner_position_id === me.id && a.week_start === prevWk && !['Done', 'Closed'].includes(a.status) && !db.activities.some(b => b.week_start === wk && b.owner_position_id === me.id && (b.carried_from === a.id || (a.code && b.code === a.code) || b.title === a.title)));
  const mode = db.settings.work_rules?.activities || 'both';
  const cut = cutoffOf(ws); const now = new Date(); const closed = now > cut && !head; // after the cut-off the week is closed for team members
  const canRow = (r: Row) => !closed && ((r.owner || me.id) === me.id || (head && mode !== 'members'));
  const cols: Col[] = [
    ...(detail ? [{ key: 'code', label: 'Ref', type: 'ro' as const, width: 74 }] : []),
    { key: 'title', label: 'Activity / task', type: 'text', width: 260, editable: r => canRow(r) && r.kind === 'Unplanned', tip: 'Planned tasks are renamed in Plan → Weekly activities; unplanned ones can be renamed here.' },
    { key: 'del', label: t('deliverable'), type: 'ro', width: 180 },
    ...(scope === 'team' ? [{ key: 'owner', label: 'Owner', type: 'ro' as const, width: 130, fmt: (v: any) => posName(db, v) }] : []),
    ...(detail ? [{ key: 'dept', label: 'Department', type: 'ro' as const, width: 120, fmt: (_: any, r: Row) => orgOf(db, r.owner) }, { key: 'priority', label: 'Priority', type: 'ro' as const, width: 75, fmt: (v: any) => PRI.find(x => x[0] === v)?.[1] || '' }] : []),
    { key: 'due', label: 'Due date', type: 'date', width: 115, editable: canRow, tip: 'Move it if the task is rescheduled.' },
    ...(detail ? [{ key: 'prev', label: 'Previous status', type: 'ro' as const, width: 120, tip: 'Status at the end of last week, for tasks carried over.' }] : []),
    { key: 'status', label: 'Status', type: 'select', options: ST, width: 120, editable: canRow, tip: 'Done = finished. Blocked = cannot move without help. Delayed = behind its due date but moving. Closed = will no longer be done.' },
    { key: 'pct', label: '% complete', type: 'number', width: 90, editable: canRow },
    ...(detail ? [{ key: 'target', label: 'Target', type: 'ro' as const, width: 75 }, { key: 'actual', label: 'Actual', type: 'number' as const, width: 80, editable: canRow, tip: 'For target-based tasks: what was reached this week.' }, { key: 'uom', label: 'Unit', type: 'ro' as const, width: 60 },
      { key: 'done', label: 'Completed on', type: 'ro' as const, width: 105 }] : []),
    { key: 'blocker', label: 'Blocker / dependency', type: 'text', width: 200, editable: canRow, tip: 'What is in the way. Writing a blocker marks the activity Blocked and tells your manager.' },
    { key: 'help', label: 'Help from', type: 'select', options: depOpts(db, me), width: 160, editable: canRow, tip: 'The department or unit whose help you need — their head is notified.' },
    ...(detail ? [{ key: 'evidence', label: 'Evidence link', type: 'text' as const, width: 170, editable: canRow, tip: 'Link to the file, photo or document that shows it is done.' }] : []),
    { key: 'note', label: 'Notes', type: 'text', width: 200, editable: canRow },
    ...(detail ? [{ key: 'carried', label: 'Carried', type: 'ro' as const, width: 70, fmt: (v: any) => v ? `${v} wk` : '' }, { key: 'upd', label: 'Updated by', type: 'ro' as const, width: 150 }] : [])];
  async function doSave() {
    setBusy(true); let err: string | null = null; const stuckNew: Row[] = [];
    for (const r of d.all.filter(r => r._dirty)) {
      if (r._deleted) { await sb.from('activities').delete().eq('id', r.id); continue; }
      let status = r.status; let p = Math.max(0, Math.min(100, Number(r.pct) || 0)); if (p === 100 && status !== 'Closed') status = 'Done'; if (status === 'Done') p = 100; if (r.blocker?.trim() && !['Done', 'Closed'].includes(status)) status = 'Stuck';
      if (status === 'Not started' && p > 0) status = 'In progress';
      const s0 = source.find(x => x.id === r.id); if (status === 'Stuck' && s0?.status !== 'Stuck') stuckNew.push(r);
      const x = await sb.from('activities').update({ title: r.title, status, pct: p, due_date: r.due || null, actual: r.actual ?? null, blocker: r.blocker?.trim() || null, help_from_unit: r.help || null, evidence_url: r.evidence || null, note: r.note || null }).eq('id', r.id); err = err || x.error?.message || null;
    }
    for (const r of stuckNew) { const o = byId(db!.positions, r.owner); await notifyPositions(db!, [o && managerOf(db!, o)?.id, ...(r.help ? db!.positions.filter(x => x.org_unit_id === r.help && x.level !== 'employee').map(x => x.id) : [])], 'blocker', `Blocked: ${r.title} — ${r.blocker}`, '/inbox'); }
    await save(() => Promise.resolve({ error: err }) as any, ['activities'], 'Week updated'); setBusy(false);
  }
  async function carryOver() {
    await save(() => sb.from('activities').insert(carry.map(a => ({ unit_id: a.unit_id, owner_position_id: me!.id, week_start: wk, code: a.code, title: a.title, kind: a.kind, category: a.category, deliverable_id: a.deliverable_id, key_result_id: a.key_result_id, unplanned: a.unplanned, priority: a.priority, due_date: a.due_date, outcome: a.outcome, target: a.target, uom: a.uom, weight: a.weight, help_from_unit: a.help_from_unit, dependency: a.dependency,
      status: a.status === 'Stuck' ? 'Stuck' : a.status === 'Not started' ? 'Not started' : 'In progress', blocker: a.blocker, pct: a.pct, top: a.top, prev_status: a.status, prev_pct: a.pct, carried_from: a.id, carried_count: (a.carried_count || 0) + 1 }))), ['activities'], `${carry.length} carried over`);
  }
  return <div className="stack">
    <div className="row"><button className="btn sm" onClick={() => setWs(new Date(ws.getTime() - 7 * 864e5))}>‹</button><b>{weekLabel(ws)}</b><button className="btn sm" onClick={() => setWs(new Date(ws.getTime() + 7 * 864e5))}>›</button><button className="btn sm" onClick={() => setWs(weekStart(new Date()))}>This week</button>
      {now < cut && now >= ws && <Pill tone="warn">Update by {cutoffLabel()}</Pill>}{closed && <Pill tone="none">Closed after {cutoffLabel()} — ask your manager to change it</Pill>}<span className="sp" /><DetailToggle v={detail} set={setDetail} />{head && <Seg value={scope} options={[['me', 'Mine'], ['team', 'My team']]} onChange={setScope} />}</div>
    {carry.length > 0 && scope === 'me' && <div className="banner">{carry.length} unfinished from last week. <button className="btn sm" onClick={carryOver}>Carry them over</button> <span className="mini">They keep their reference code and show last week's status.</span></div>}
    {!d.rows.length ? <Empty>No activities planned for this week. <Link to="/plan?tab=week">Plan them in Plan → Weekly activities</Link>, or add one below.</Empty> : <Sheet cols={cols} rows={d.rows} onChange={d.change} />}
    {scope === 'me' && !closed && <QuickAdd wk={wk} />}
    <SaveBar dirty={d.dirty} onSave={doSave} onDiscard={d.reset} busy={busy} />
    {scope === 'me' && <WeekReview me={me} wk={wk} mine />}
  </div>;
}
/** Add an unplanned activity to this week without leaving Record. */
function QuickAdd({ wk }: { wk: string }) {
  const { db, me, user } = useData(); const save = useSave(); const [t, setT] = useState(''); const [del, setDel] = useState('');
  if (!db || !me) return null; const dels = db.deliverables.filter(d => d.owner_position_id === me.id && d.month === curMonth() && d.status !== 'removed');
  return <div className="row"><input type="text" style={{ flex: 1 }} placeholder="Add an activity to this week (e.g. something unplanned that came up)" value={t} onChange={e => setT(e.target.value)} />
    <select value={del} onChange={e => setDel(e.target.value)} aria-label="Deliverable"><option value="">Unplanned / no deliverable</option>{dels.map(d => <option key={d.id} value={d.id}>{d.title.slice(0, 50)}</option>)}</select>
    <button className="btn" disabled={!t.trim()} onClick={async () => { if (await save(() => sb.from('activities').insert({ unit_id: me.unit_id, owner_position_id: me.id, week_start: wk, title: t.trim(), deliverable_id: del || null, key_result_id: byId(db.deliverables, del)?.key_result_id || null, unplanned: !del, kind: 'Unplanned', status: 'In progress', pct: 0, created_by: user.id }), ['activities'], 'Added')) setT(''); }}>Add</button></div>;
}

function DeliverablesRec() {
  const { db, me, role } = useData(); const [scope, setScope] = useState<'me' | 'team'>('me'); const head = isHead(role);
  const team = useMemo(() => db && me && head ? teamOf(db, me, LEADS.includes(role)).filter(p => p.id !== me.id) : [], [db, me, head, role]);
  const waiting = db ? db.deliverables.filter(d => d.status === 'done' && team.some(p => p.id === d.owner_position_id)).length : 0;
  return <div className="stack">{head && <div className="row"><span className="sp" /><Seg value={scope} options={[['me', 'Mine'], ['team', `My team — review & accept${waiting ? ` (${waiting} waiting)` : ''}`]]} onChange={setScope} /></div>}
    {scope === 'me' ? <MyDeliverables /> : <MonthView people={team} lead />}</div>;
}
function MyDeliverables() {
  const { db, me, role } = useData(); const save = useSave(); const { t } = useTerms(); const [m, setM] = useState(curMonth()); const [busy, setBusy] = useState(false); const [sub, setSub] = useState<Row | null>(null); const [bulk, setBulk] = useState(false);
  const source = useMemo(() => db && me ? db.deliverables.filter(x => x.owner_position_id === me.id && x.month === m && x.status !== 'removed').map(x => ({ id: x.id, code: x.code || '', kind: x.kind || '', due: x.due_date || '', uom: x.uom || '', weight: x.weight, title: x.title, kr: byId(db.key_results, x.key_result_id)?.title || '', target: x.target, actual: x.actual, status: x.status === 'done' || x.status === 'accepted' ? 'done' : 'planned', state: x.status, evidence: x.evidence_url || '', note: x.note || '', feedback: x.feedback || '' })) : [], [db, me, m]);
  const d = useDraft(source, [source]);
  if (!db || !me) return null;
  const open = (r: Row) => r.state !== 'accepted';
  const cols: Col[] = [{ key: 'code', label: 'Ref', type: 'ro', width: 74 }, { key: 'title', label: t('deliverable'), type: 'ro', width: 240 }, { key: 'kind', label: 'Result type', type: 'ro', width: 110 }, { key: 'kr', label: t('key_result'), type: 'ro', width: 190 }, { key: 'due', label: 'Due', type: 'ro', width: 95 },
    { key: 'acts', label: 'Weekly tasks', type: 'ro', width: 110, fmt: (_, r) => { const a = db.activities.filter(x => x.deliverable_id === r.id); return a.length ? `${a.filter(x => x.status === 'Done').length} / ${a.length} done` : '—'; }, tip: 'Weekly activities linked to this deliverable.' },
    { key: 'target', label: 'Target', type: 'ro', width: 75 }, { key: 'actual', label: 'Achieved', type: 'number', width: 90, editable: open, tip: 'For target-based deliverables: the number reached.' }, { key: 'uom', label: 'Unit', type: 'ro', width: 60 }, { key: 'weight', label: 'Weight %', type: 'ro', width: 75 },
    { key: 'evidence', label: 'Evidence link', type: 'text', width: 200, editable: open, tip: 'A link to the document, photo or file that shows it is done.' }, { key: 'note', label: 'Note', type: 'text', width: 180, editable: open },
    { key: 'state', label: 'Status', type: 'ro', width: 130, sticky: 'right', fmt: (v, r) => v === 'accepted' ? <Pill tone="good">Accepted</Pill> : v === 'done' ? <span className="row" style={{ gap: 4 }}><Pill tone="warn">Submitted</Pill><button className="btn xs" data-tip="Take it back before your manager reviews it" onClick={() => withdraw(r.id)}>↶</button></span> : <button className="btn sm pri" onClick={() => setSub(byId(db.deliverables, r.id)!)}>{v === 'returned' ? 'Resubmit' : 'Submit'}</button> }];
  async function withdraw(id: string) { await save(() => sb.from('deliverables').update({ status: 'planned', done_at: null }).eq('id', id), ['deliverables'], 'Submission withdrawn'); }
  const toSubmit = d.rows.filter(r => r.state === 'planned' || r.state === 'returned');
  async function doSave() {
    setBusy(true); let err: string | null = null; const sent: Row[] = [];
    for (const r of d.all.filter(r => r._dirty)) { const s0 = source.find(x => x.id === r.id)!; const toDone = r.status === 'done' && s0.status !== 'done';
      const x = await sb.from('deliverables').update({ actual: r.actual ?? null, evidence_url: r.evidence || null, note: r.note || null, ...(toDone ? { status: 'done', done_at: new Date().toISOString() } : r.status === 'planned' && s0.state === 'done' ? { status: 'planned' } : {}) }).eq('id', r.id);
      err = err || x.error?.message || null; if (toDone) sent.push(r); }
    if (sent.length) await notifyPositions(db!, [managerOf(db!, me!)?.id], 'deliverable', `${me!.holder_name} delivered ${sent.length} deliverable(s) for acceptance`, '/inbox');
    await save(() => Promise.resolve({ error: err }) as any, ['deliverables'], 'Saved'); setBusy(false);
  }
  return <div className="stack"><div className="row"><p className="note" style={{ flex: 1 }}>When a deliverable is done, click <b>Submit</b> at the right end of its row (or submit several at once). Your manager accepts it or returns it with feedback.</p>{toSubmit.length > 1 && <button className="btn sm" onClick={() => setBulk(true)}>Submit several ({toSubmit.length})</button>}<select value={m} onChange={e => setM(Number(e.target.value))}>{MONTHS.map((x, i) => <option key={x} value={i + 1}>{x}{i + 1 === curMonth() ? ' (now)' : ''}</option>)}</select></div>
    {!d.rows.length ? <Empty>No {t('deliverable', true).toLowerCase()} for {MONTHS[m - 1]}.</Empty> : <Sheet cols={cols} rows={d.rows} onChange={d.change} />}
    {d.rows.some(r => r.feedback) && <div className="card"><h4>Feedback</h4>{d.rows.filter(r => r.feedback).map(r => <div key={r.id} className="lg"><b>{r.title}</b> — {r.feedback}</div>)}</div>}
    <SaveBar dirty={d.dirty} onSave={doSave} onDiscard={d.reset} busy={busy} />{role && null}
    {sub && <SubmitModal d={sub} onClose={() => setSub(null)} />}
    {bulk && <BulkSubmit ids={toSubmit.map(r => r.id)} onClose={() => setBulk(false)} />}</div>;
}

/** Submit several deliverables at once (one evidence link and note for all, optional). */
function BulkSubmit({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const { db, me } = useData(); const save = useSave(); const [pick, setPick] = useState<Set<string>>(new Set()); const [ev, setEv] = useState(''); const [note, setNote] = useState(''); if (!db || !me) return null;
  const items = ids.map(id => byId(db.deliverables, id)!).filter(Boolean);
  async function go() {
    const sel = Array.from(pick); const ok = await save(async () => { for (const id of sel) { const x = byId(db!.deliverables, id)!; const r = await sb.from('deliverables').update({ status: 'done', done_at: new Date().toISOString(), evidence_url: ev.trim() || x.evidence_url || null, note: note.trim() || x.note || null }).eq('id', id); if (r.error) return r; } return { error: null }; }, ['deliverables'], `${sel.length} submitted — your manager has been told`);
    if (ok) { await notifyPositions(db!, [managerOf(db!, me!)?.id], 'deliverable', `${me!.holder_name} submitted ${sel.length} deliverables for acceptance`, '/record?tab=deliverables'); onClose(); }
  }
  return <Modal title="Submit several deliverables" onClose={onClose}>
    <div className="row"><button className="btn sm" onClick={() => setPick(new Set(pick.size === items.length ? [] : items.map(x => x.id)))}>{pick.size === items.length ? 'Clear all' : 'Select all'}</button><span className="note">{pick.size} selected</span></div>
    <div className="stack" style={{ gap: 4, maxHeight: 280, overflow: 'auto' }}>{items.map(x => <label key={x.id} className="row" style={{ gap: 8 }}><input type="checkbox" checked={pick.has(x.id)} onChange={e => { const n = new Set(pick); e.target.checked ? n.add(x.id) : n.delete(x.id); setPick(n); }} /><span>{x.title}{x.status === 'returned' && <span className="note"> · returned</span>}</span></label>)}</div>
    <label className="f">Evidence link for all <span className="note">(optional — each keeps its own if left empty)</span><input type="url" placeholder="https://…" value={ev} onChange={e => setEv(e.target.value)} /></label>
    <label className="f">Note <span className="note">(optional)</span><input type="text" value={note} onChange={e => setNote(e.target.value)} /></label>
    <div className="row end"><button className="btn" onClick={onClose}>Cancel</button><button className="btn pri" disabled={!pick.size} onClick={go}>Submit {pick.size || ''}</button></div></Modal>;
}
export function SubmitModal({ d, onClose }: { d: Row; onClose: () => void }) {
  const { db, me } = useData(); const save = useSave(); const [ev, setEv] = useState(d.evidence_url || ''); const [note, setNote] = useState(d.note || ''); const [act, setAct] = useState<string>(d.actual != null ? String(d.actual) : '');
  async function go() {
    const ok = await save(() => sb.from('deliverables').update({ status: 'done', done_at: new Date().toISOString(), evidence_url: ev.trim() || null, note: note.trim() || null, actual: act === '' ? null : Number(act) }).eq('id', d.id), ['deliverables'], 'Submitted — your manager has been told');
    if (ok && db && me) await notifyPositions(db, [managerOf(db, me)?.id], 'deliverable', `${me.holder_name} submitted “${d.title}” for acceptance`, '/record?tab=deliverables');
    if (ok) onClose();
  }
  return <Modal title="Submit for acceptance" onClose={onClose}><p><b>{d.title}</b></p>
    {d.target != null && <label className="f">Achieved ({d.uom || 'value'}) — target {d.target}<input type="number" value={act} onChange={e => setAct(e.target.value)} /></label>}
    <label className="f">Evidence link <span className="note">(document, photo or file that shows it is done)</span><input type="url" placeholder="https://…" value={ev} onChange={e => setEv(e.target.value)} /></label>
    <label className="f">Note <span className="note">(optional)</span><textarea rows={2} value={note} onChange={e => setNote(e.target.value)} /></label>
    <div className="row end"><button className="btn" onClick={onClose}>Cancel</button><button className="btn pri" onClick={go}>Submit</button></div></Modal>;
}

const ENTER: Record<string, string> = { sum: "This month's amount only (the quarter adds the months up)", average: "This month's value (the quarter is the average)", latest: 'The level reached by the end of the month', max: "This month's value (the quarter takes the highest)", min: "This month's value (the quarter takes the lowest)" };
function KrProgress() {
  const { db, me, role, user, can } = useData(); const save = useSave(); const { t } = useTerms(); const [m, setM] = useState(curMonth()); const [busy, setBusy] = useState(false);
  const mine = useMemo(() => { if (!db || !me) return []; const led = isHead(role) ? headedOrgs(db, me, role) : new Set<string>();
    return db.key_results.filter(k => k.measure === 'manual' && (k.state || 'active') === 'active' && db.objectives.some(o => o.id === k.objective_id && o.status !== 'Archived' && o.level !== 'individual') && (k.updater_position_id === me.id || k.owner_position_id === me.id || db.objectives.some(o => o.id === k.objective_id && led.has(o.org_unit_id)))); }, [db, me, role, can]);
  const source = useMemo(() => db ? mine.map(k => { const mv = monthlyValues(db, k); const s = krState(db, k, { t: 'Q', n: qOfMonth(m) }); return { id: k.id, obj: byId(db.objectives, k.objective_id)?.text, title: k.title, uom: k.uom, agg: k.aggregation || 'sum', target: krTarget(db, k, { t: 'M', n: m }), qt: s.target, qa: s.actual, value: mv[m - 1], conf: k.confidence || 'Medium', note: '', status: s.label }; }) : [], [db, mine, m]);
  const d = useDraft(source, [source]);
  if (!db || !me) return null;
  const cols: Col[] = [{ key: 'title', label: t('key_result'), type: 'ro', width: 300 }, { key: 'uom', label: 'Unit', type: 'ro', width: 60 },
    { key: 'target', label: `${MONTHS[m - 1]} target`, type: 'ro', width: 100, fmt: v => fmt(v, 1) }, { key: 'qt', label: `Q${qOfMonth(m)} target`, type: 'ro', width: 90, fmt: v => fmt(v, 1) },
    { key: 'enter', label: 'What to enter', type: 'ro', width: 190, fmt: (_, r) => ENTER[r.agg] || ENTER.sum, tip: 'Set per key result in the objective builder ("Combine the months by").' },
    { key: 'value', label: `${MONTHS[m - 1]} actual`, type: 'number', width: 110, tip: 'Always the figure for the month you picked — never a quarter total. The app adds the months up (or averages them, or takes the latest) to get the quarter.' },
    { key: 'qa', label: `Q${qOfMonth(m)} so far`, type: 'ro', width: 100, fmt: v => fmt(v, 1), tip: 'Worked out from the monthly actuals, the way the key result combines its months.' },
    { key: 'conf', label: 'Confidence', type: 'select', options: [['High', 'High — on course'], ['Medium', 'Medium — some risk'], ['Low', 'Low — unlikely']], width: 150, tip: 'Your judgement of whether the target will be met by the end of the quarter. Low confidence shows the result as "Behind" even if the numbers look fine, so problems surface early.' },
    { key: 'note', label: 'What happened', type: 'text', width: 240 }, { key: 'status', label: 'Status', type: 'ro', width: 100 }];
  async function doSave() {
    setBusy(true); let err: string | null = null;
    for (const r of d.all.filter(r => r._dirty)) { const s0 = source.find(x => x.id === r.id)!;
      if (r.value !== s0.value && r.value != null) { const x = await sb.from('check_ins').insert({ kr_id: r.id, month: m, quarter: qOfMonth(m), value: r.value, confidence: r.conf, note: r.note || null, created_by: user.id }); err = err || x.error?.message || null; }
      if (r.conf !== s0.conf) await sb.from('key_results').update({ confidence: r.conf }).eq('id', r.id); }
    await save(() => Promise.resolve({ error: err }) as any, ['check_ins', 'key_results'], 'Progress recorded'); setBusy(false);
  }
  const rows: Row[] = []; const idx: number[] = []; let last = ''; d.rows.forEach((r, i) => { if (r.obj !== last) { rows.push({ _header: r.obj }); idx.push(-1); last = r.obj; } rows.push(r); idx.push(i); });
  return <div className="stack"><div className="row"><p className="note" style={{ flex: 1 }}>Record the <b>monthly</b> actual for each {t('key_result').toLowerCase()} of the organisation you lead (and the levels below), or that you were named to update — pick the month, then enter that month's figure as the "What to enter" column says; the quarter is worked out for you. Results measured from the annual plan or from deliverables update themselves and are not listed.</p><select value={m} onChange={e => setM(Number(e.target.value))}>{MONTHS.slice(0, curMonth()).map((x, i) => <option key={x} value={i + 1}>{x}</option>)}</select></div>
    {!d.rows.length ? <Empty>No {t('key_result', true).toLowerCase()} for you to update.</Empty> : <Sheet cols={cols} rows={rows} onChange={(i, k, v) => idx[i] >= 0 && d.change(idx[i], k, v)} />}
    <SaveBar dirty={d.dirty} onSave={doSave} onDiscard={d.reset} busy={busy} /></div>;
}

function FinancialActuals() {
  const { db } = useData(); const [k, setK] = useState<'pl' | 'cash' | 'weekly'>('pl');
  const opts: [typeof k, string][] = [['pl', 'Revenue & costs (monthly)'], ['cash', 'Cash — bank position (monthly)'], ...(moduleOn(db, 'weekly_cash') ? [['weekly', 'Cash — weekly in/out'] as [typeof k, string]] : [])];
  return <div className="stack"><div className="row"><UnitPicker /><span className="sp" /><Seg value={k} options={opts} onChange={setK} /></div>
    {k === 'pl' ? <PlActuals /> : k === 'cash' ? <CashMonthly /> : <CashWeekly />}</div>;
}
function PlActuals() {
  const { db, unit } = useData(); const save = useSave(); const [m, setM] = useState(Math.max(1, curMonth() - 1)); const [busy, setBusy] = useState(false); const [open, setOpen] = useState<Set<string>>(new Set());
  const source = useMemo(() => { if (!db || !unit) return []; const out: Row[] = [];
    (['rev', 'cos', 'opex', 'capex'] as const).forEach(sec => { const ls = linesOf(db, unit, sec); const groups = Array.from(new Set(ls.map(l => l.line_group || 'Other')));
      groups.forEach(g => { const grow = db.actuals.find(a => a.unit_id === unit && a.section === sec && a.line_group === g && a.month === m && !a.line_id);
        out.push({ id: 'g|' + sec + '|' + g, kind: 'g', sec, grp: g, name: g, plan: planBy(db, unit, sec, [m], [g]), actual: grow?.value != null ? Number(grow.value) : null });
        ls.filter(l => (l.line_group || 'Other') === g).sort((a, b) => (a.sort || 0) - (b.sort || 0)).forEach(l => { const q = lineQty(l)[m - 1]; const isQ = l.kind === 'qty' || !!q;
          out.push({ id: l.id, kind: 'l', sec, grp: g, name: l.name, uom: isQ ? l.uom || '' : '', isQ, qplan: isQ ? q : null, qact: lineActual(db, l.id, [m], 'quantity'), plan: lineVals(l)[m - 1], actual: lineActual(db, l.id, [m]) }); }); }); });
    return out; }, [db, unit, m]);
  const d = useDraft(source, [source]);
  if (!db || !unit) return null;
  const SEC: Record<string, string> = { rev: 'Revenue', cos: 'Cost of sales', opex: 'Operating expenses (incl. depreciation and financial charges lines)', capex: 'Capital spending' };
  const lineSum = (g: Row) => { const v = d.rows.filter(r => r.kind === 'l' && r.sec === g.sec && r.grp === g.grp && r.actual != null); return v.length ? sum(v.map(r => Number(r.actual))) : null; };
  const toggle = (k: string) => setOpen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const rows: Row[] = []; const idx: number[] = []; let last = '';
  d.rows.forEach((r, i) => { if (r.sec !== last) { rows.push({ _header: SEC[r.sec] }); idx.push(-1); last = r.sec; } if (r.kind === 'g' || open.has('g|' + r.sec + '|' + r.grp)) { rows.push(r); idx.push(i); } });
  const cols: Col[] = [{ key: 'name', label: 'Product group / budget line', type: 'ro', width: 300, fmt: (v, r) => r.kind === 'g' ? <button className="hbtn" onClick={() => toggle(r.id)}>{open.has(r.id) ? '▾' : '▸'} {v}</button> : <span style={{ paddingLeft: 16 }}>{v}</span> },
    { key: 'uom', label: 'Unit', type: 'ro', width: 70 },
    { key: 'qplan', label: 'Qty plan', type: 'ro', width: 90, fmt: v => v == null ? '' : fmt(v, 0) },
    { key: 'qact', label: 'Qty actual', type: 'number', width: 100, editable: r => r.kind === 'l' && r.isQ, tip: 'Quantity sold, produced or bought — for lines planned by quantity.' },
    { key: 'plan', label: `${MONTHS[m - 1]} plan (ETB)`, type: 'ro', width: 130, fmt: v => money(v) },
    { key: 'actual', label: `${MONTHS[m - 1]} actual (ETB)`, type: 'number', width: 150, editable: r => r.kind === 'l' || lineSum(r) == null, fmt: (v, r) => { if (r.kind === 'g') { const ls = lineSum(r); if (ls != null) return <span title="Worked out from the lines">{fmt(ls, 0)} <span className="mini">from lines</span></span>; } return v == null ? '' : fmt(v, 0); },
      tip: 'Enter one figure for the whole group, or open the group and enter each line. When lines have figures, the group total is worked out from them. Paste a column from the Power BI or ERP export.' },
    { key: 'v', label: 'Achieved', type: 'ro', width: 90, fmt: (_, r) => { const a = r.kind === 'g' ? lineSum(r) ?? r.actual : r.actual; return a != null && r.plan ? pct(a / r.plan) : ''; } }];
  async function doSave() {
    setBusy(true); let err: string | null = null; const base = { unit_id: unit, fiscal_year: '2026/27', month: m, source: 'Entered in the app' };
    for (const r of d.all.filter(r => r._dirty)) {
      if (r.kind === 'g') { await sb.from('actuals').delete().match({ unit_id: unit, fiscal_year: '2026/27', section: r.sec, line_group: r.grp, month: m }).is('line_id', null);
        if (r.actual != null) { const x = await sb.from('actuals').insert({ ...base, section: r.sec, line_group: r.grp, value: r.actual }); err = err || x.error?.message || null; } }
      else { await sb.from('actuals').delete().match({ unit_id: unit, line_id: r.id, month: m });
        if (r.actual != null || r.qact != null) { const x = await sb.from('actuals').insert({ ...base, section: r.sec, line_group: r.grp, line_id: r.id, value: r.actual, qty: r.qact }); err = err || x.error?.message || null; } }
    }
    await save(() => Promise.resolve({ error: err }) as any, ['actuals'], `${MONTHS[m - 1]} actuals saved`); setBusy(false);
  }
  const groupKeys = d.rows.filter(r => r.kind === 'g').map(r => r.id);
  return <div className="stack"><div className="row"><p className="note" style={{ flex: 1 }}>Enter last month's actuals before the month closes — one figure per product group or budget group, or open a group (▸) and enter each line, with quantities for lines planned by quantity. Key results linked to the plan, the income statement and the dashboards update from these figures.</p>
    <button className="btn sm" onClick={() => setOpen(new Set(open.size ? [] : groupKeys))}>{open.size ? 'Collapse all' : 'Open all lines'}</button><select value={m} onChange={e => setM(Number(e.target.value))} aria-label="Month">{MONTHS.slice(0, curMonth()).map((x, i) => <option key={x} value={i + 1}>{x}</option>)}</select></div>
    {!rows.length ? <Empty>This unit has no revenue or budget lines in its annual plan.</Empty> : <Sheet cols={cols} rows={rows} onChange={(i, k, v) => idx[i] >= 0 && d.change(idx[i], k, v)} />}
    <SaveBar dirty={d.dirty} onSave={doSave} onDiscard={d.reset} busy={busy} /></div>;
}
function CashMonthly() {
  const { db, unit } = useData(); const save = useSave(); const [busy, setBusy] = useState(false);
  const source = useMemo(() => db && unit ? Array.from({ length: 12 }, (_, i) => { const c = db.cash_actual.find(x => x.unit_id === unit && x.month === i + 1); return { id: String(i + 1), month: MONTHS[i], opening: c?.opening ?? null, inflow: c?.inflow ?? null, outflow: c?.outflow ?? null, closing: c?.closing ?? null }; }) : [], [db, unit]);
  const d = useDraft(source, [source]);
  if (!db || !unit) return null;
  const cols: Col[] = [{ key: 'month', label: 'Month', type: 'ro', width: 90 }, { key: 'opening', label: 'Opening bank balance', type: 'number', width: 160 }, { key: 'inflow', label: 'Cash in', type: 'number', width: 140 }, { key: 'outflow', label: 'Cash out', type: 'number', width: 140 },
    { key: 'closing', label: 'Closing bank balance', type: 'number', width: 160, tip: 'Leave empty to calculate it as opening + in − out.' }];
  async function doSave() {
    setBusy(true); const rows = d.all.filter(r => r._dirty).map(r => ({ unit_id: unit, fiscal_year: '2026/27', month: Number(r.id), opening: r.opening, inflow: r.inflow, outflow: r.outflow, closing: r.closing ?? (r.opening != null ? Number(r.opening) + Number(r.inflow || 0) - Number(r.outflow || 0) : null), source: 'Entered in the app' }));
    await save(() => sb.from('cash_actual').upsert(rows, { onConflict: 'unit_id,fiscal_year,month' }), ['cash_actual'], 'Cash actuals saved'); setBusy(false);
  }
  return <div className="stack"><p className="note">Month-end bank position. This is the actual line in the cash flow report and the "Closing cash" metric.</p><Sheet cols={cols} rows={d.rows} onChange={d.change} /><SaveBar dirty={d.dirty} onSave={doSave} onDiscard={d.reset} busy={busy} /></div>;
}
function CashWeekly() {
  const { db, unit } = useData(); const save = useSave(); const [m, setM] = useState(curMonth()); const [busy, setBusy] = useState(false);
  const weeks = useMemo(() => weeksOfMonthR(m), [m]);
  const source = useMemo(() => db && unit ? weeks.map(w => { const k = ymd(w); const g = (dir: string, f: string) => db.cash_weekly.find(x => x.unit_id === unit && x.week_start === k && x.direction === dir)?.[f] ?? null;
    return { id: k, week: weekLabel(w), pin: g('in', 'planned'), ain: g('in', 'actual'), pout: g('out', 'planned'), aout: g('out', 'actual') }; }) : [], [db, unit, weeks]);
  const d = useDraft(source, [source]);
  if (!db || !unit) return null;
  const cols: Col[] = [{ key: 'week', label: 'Week', type: 'ro', width: 110 }, { key: 'pin', label: 'Cash in — planned', type: 'number', width: 140 }, { key: 'ain', label: 'Cash in — actual', type: 'number', width: 140 }, { key: 'pout', label: 'Cash out — planned', type: 'number', width: 140 }, { key: 'aout', label: 'Cash out — actual', type: 'number', width: 140 },
    { key: 'net', label: 'Net actual', type: 'ro', width: 120, fmt: (_, r) => r.ain != null || r.aout != null ? money(Number(r.ain || 0) - Number(r.aout || 0)) : '' }];
  async function doSave() {
    setBusy(true); const rows = d.all.filter(r => r._dirty).flatMap(r => [{ unit_id: unit, week_start: r.id, direction: 'in', planned: r.pin, actual: r.ain }, { unit_id: unit, week_start: r.id, direction: 'out', planned: r.pout, actual: r.aout }]);
    await save(() => sb.from('cash_weekly').upsert(rows, { onConflict: 'unit_id,week_start,direction' }), ['cash_weekly'], 'Weekly cash saved'); setBusy(false);
  }
  return <div className="stack"><div className="row"><p className="note" style={{ flex: 1 }}>Weekly cash plan and actual, as in the weekly tracker. Shown in Reports → Financial → Weekly cash.</p><select value={m} onChange={e => setM(Number(e.target.value))} aria-label="Month">{MONTHS.map((x, i) => <option key={x} value={i + 1}>{x}</option>)}</select></div>
    <Sheet cols={cols} rows={d.rows} onChange={d.change} /><SaveBar dirty={d.dirty} onSave={doSave} onDiscard={d.reset} busy={busy} /></div>;
}
function weeksOfMonthR(m: number) { const out: Date[] = []; let w = weekStart(monthStart(FY, m)); const end = monthStart(FY, m + 1); while (w < end) { out.push(w); w = new Date(w.getTime() + 7 * 864e5); } return out; }

/** Managers: the team's week, deliverables, check-ins and blockers in one place. */
function TeamTab() {
  const { db, me, role } = useData(); const [v, setV] = useState<'week' | 'checkins' | 'blockers'>('week'); const [ws, setWs] = useState(() => weekStart(new Date()));
  const team = useMemo(() => db && me ? teamOf(db, me, LEADS.includes(role)).filter(p => p.id !== me.id) : [], [db, me, role]);
  if (!db || !me) return null;
  return <div className="stack"><div className="row"><p className="note" style={{ flex: 1 }}>Your team: who has planned and updated their week, week summaries to read and rate, key results waiting for a check-in, and anything stuck.</p>
    <Seg value={v} options={[['week', 'Week'], ['checkins', 'Key result check-ins'], ['blockers', 'Blockers']]} onChange={setV} /></div>
    {v === 'week' ? <TeamView people={[me, ...team]} ws={ws} setWs={setWs} /> : v === 'checkins' ? <CheckIns people={[me, ...team]} lead /> : <Blockers people={[me, ...team]} />}</div>;
}

export function RecordPage() {
  const { db, me, role } = useData(); const { t } = useTerms(); const [sp, setSp] = useSearchParams();
  const updater = !!db && !!me && db.key_results.some(k => k.measure === 'manual' && (k.updater_position_id === me.id || k.owner_position_id === me.id));
  const fin = canEnterActuals(db, me, role);
  const tabs: [string, string][] = [['week', 'This week'], ['deliverables', t('deliverable', true)], ...(isHead(role) || updater ? [['krs', t('key_result', true)] as [string, string]] : []), ...(isHead(role) ? [['team', 'My team'] as [string, string]] : []), ...(fin ? [['finance', 'Financial actuals'] as [string, string]] : [])];
  const tab = sp.get('tab') && tabs.some(x => x[0] === sp.get('tab')) ? sp.get('tab')! : 'week';
  return <div className="light wide"><div className="lhead"><div><h1>Record</h1><p>Update what actually happened — activities, deliverables, results{fin ? ' and financial actuals' : ''}.<HowItWorks><h3>What this page is for</h3><p>Record what actually happened. Plans are made in <b>Plan</b>; results are recorded here.</p><ul><li><b>This week</b> — update each activity before the weekly cut-off: status, % complete, actual, blocker and evidence. Unfinished work can be carried to next week.</li><li><b>Deliverables</b> — mark a monthly deliverable done with evidence; the manager accepts it (or returns it).</li><li><b>Key results</b> — enter the month's actual for key results that are checked in by hand. Results measured from the annual plan or from deliverables update themselves.</li><li><b>My team</b> (leaders) — the team's week, check-ins and open blockers.</li><li><b>Financial actuals</b> (Finance and planners) — revenue, costs and cash for the month, per group or per line.</li></ul></HowItWorks></p></div></div>
    <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" className={tab === k ? 'on' : ''} onClick={() => setSp({ tab: k })}>{l}</button>)}</div>
    {tab === 'week' && <ThisWeek />}{tab === 'deliverables' && <DeliverablesRec />}{tab === 'krs' && <KrProgress />}{tab === 'team' && <TeamTab />}{tab === 'finance' && <FinancialActuals />}
  </div>;
}
