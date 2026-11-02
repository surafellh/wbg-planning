/* WORK WINDOW — Record actuals: this week's activities, deliverables delivered, key-result progress, financial actuals.
   Spreadsheet form; "Save" writes everything at once. */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useData, useSave, useTerms, byId, posName, notifyPositions, managerOf, canEnterActuals, moduleOn, type Row } from '../../lib/data';
import { sb } from '../../lib/supabase';
import { cutoffLabel, FY, monthStart, MONTHS, curMonth, qOfMonth, weekStart, weekLabel, ymd, cutoffOf, krState, currentPeriod, krTarget, monthlyValues, linesOf, planBy, actualBy, money, fmt, pct } from '../../lib/calc';
import { Seg, Empty, Pill, UnitPicker } from '../../lib/ui';
import { Sheet, useDraft, type Col } from '../../lib/sheet';
import { teamOf, WeekReview, TeamView, MonthView, CheckIns, Blockers } from '../Work';
import { isHead, SaveBar, headedOrgs } from './Plan';

const LEADS = ['unit_head', 'planning_head', 'super_admin', 'group_strategy', 'executive'];
const ST: [string, string][] = [['Not started', 'Not started'], ['In progress', 'In progress'], ['Done', 'Done'], ['Stuck', 'Stuck']];

function ThisWeek() {
  const { db, me, role } = useData(); const save = useSave(); const { t } = useTerms(); const [ws, setWs] = useState(() => weekStart(new Date())); const [scope, setScope] = useState<'me' | 'team'>('me'); const [busy, setBusy] = useState(false);
  const head = isHead(role); const team = useMemo(() => db && me ? (head ? teamOf(db, me, LEADS.includes(role)) : [me]) : [], [db, me, head, role]);
  const wk = ymd(ws); const people = scope === 'me' ? [me!] : team;
  const source = useMemo(() => { if (!db || !me) return []; const ids = new Set(people.map(p => p?.id));
    return db.activities.filter(a => ids.has(a.owner_position_id) && a.week_start === wk).sort((a, b) => Number(b.top) - Number(a.top))
      .map(a => ({ id: a.id, title: a.title, del: byId(db.deliverables, a.deliverable_id)?.title || (a.unplanned ? 'Unplanned' : ''), owner: a.owner_position_id, status: a.status, pct: a.pct, blocker: a.blocker || '', help: a.help_from_unit || '', note: a.note || '' })); }, [db, me, people, wk]);
  const d = useDraft(source, [source]);
  if (!db || !me) return null;
  const prev = ymd(new Date(ws.getTime() - 7 * 864e5)); const carry = db.activities.filter(a => a.owner_position_id === me.id && a.week_start === prev && !['Done', 'Closed'].includes(a.status) && !db.activities.some(b => b.week_start === wk && b.title === a.title && b.owner_position_id === me.id));
  const units: [string, string][] = [...db.org_units.filter(u => u.unit_id === me.unit_id && u.kind !== 'unit' && u.id !== me.org_unit_id).map(u => [u.id, u.name + ' (my unit)'] as [string, string]), ...db.org_units.filter(u => u.kind === 'unit').map(u => [u.id, u.name] as [string, string])];
  const cols: Col[] = [{ key: 'title', label: 'Activity', type: 'text', width: 280 }, { key: 'del', label: t('deliverable'), type: 'ro', width: 200 },
    ...(scope === 'team' ? [{ key: 'owner', label: 'Owner', type: 'ro' as const, width: 130, fmt: (v: any) => posName(db, v) }] : []),
    { key: 'status', label: 'Status', type: 'select', options: ST, width: 120 }, { key: 'pct', label: '% done', type: 'number', width: 80 },
    { key: 'blocker', label: 'Blocker', type: 'text', width: 200, tip: 'What is in the way. Writing a blocker marks the activity stuck and tells your manager.' },
    { key: 'help', label: 'Help from', type: 'select', options: units, width: 150, tip: 'Another unit whose help you need — their head is notified.' }, { key: 'note', label: 'Note', type: 'text', width: 200 }];
  async function doSave() {
    setBusy(true); let err: string | null = null; const stuckNew: Row[] = [];
    for (const r of d.all.filter(r => r._dirty)) {
      if (r._deleted) { await sb.from('activities').delete().eq('id', r.id); continue; }
      let status = r.status; let p = Math.max(0, Math.min(100, Number(r.pct) || 0)); if (p === 100) status = 'Done'; if (status === 'Done') p = 100; if (r.blocker?.trim() && status !== 'Done') status = 'Stuck';
      const s0 = source.find(x => x.id === r.id); if (status === 'Stuck' && s0?.status !== 'Stuck') stuckNew.push(r);
      const x = await sb.from('activities').update({ title: r.title, status, pct: p, blocker: r.blocker?.trim() || null, help_from_unit: r.help || null, note: r.note || null }).eq('id', r.id); err = err || x.error?.message || null;
    }
    for (const r of stuckNew) { const o = byId(db!.positions, r.owner); await notifyPositions(db!, [o && managerOf(db!, o)?.id, ...(r.help ? db!.positions.filter(x => x.org_unit_id === r.help && x.level !== 'employee').map(x => x.id) : [])], 'blocker', `Stuck: ${r.title} — ${r.blocker}`, '/inbox'); }
    await save(() => Promise.resolve({ error: err }) as any, ['activities'], 'Week updated'); setBusy(false);
  }
  const cut = cutoffOf(ws); const now = new Date();
  return <div className="stack">
    <div className="row"><button className="btn sm" onClick={() => setWs(new Date(ws.getTime() - 7 * 864e5))}>‹</button><b>{weekLabel(ws)}</b><button className="btn sm" onClick={() => setWs(new Date(ws.getTime() + 7 * 864e5))}>›</button><button className="btn sm" onClick={() => setWs(weekStart(new Date()))}>This week</button>
      {now < cut && now >= ws && <Pill tone="warn">Update by {cutoffLabel()}</Pill>}<span className="sp" />{head && <Seg value={scope} options={[['me', 'Mine'], ['team', 'My team']]} onChange={setScope} />}</div>
    {carry.length > 0 && scope === 'me' && <div className="banner">{carry.length} unfinished from last week. <button className="btn sm" onClick={() => save(() => sb.from('activities').insert(carry.map(a => ({ unit_id: a.unit_id, owner_position_id: me.id, week_start: wk, title: a.title, deliverable_id: a.deliverable_id, key_result_id: a.key_result_id, unplanned: a.unplanned, status: a.status === 'Stuck' ? 'Stuck' : 'In progress', blocker: a.blocker, pct: a.pct, top: a.top }))), ['activities'], 'Carried over')}>Carry them over</button></div>}
    {!d.rows.length ? <Empty>No activities planned for this week. <Link to="/plan?tab=week">Plan them in Plan → Weekly activities</Link>, or add one here.</Empty> : <Sheet cols={cols} rows={d.rows} onChange={d.change} />}
    {scope === 'me' && <QuickAdd wk={wk} />}
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
    <button className="btn" disabled={!t.trim()} onClick={async () => { if (await save(() => sb.from('activities').insert({ unit_id: me.unit_id, owner_position_id: me.id, week_start: wk, title: t.trim(), deliverable_id: del || null, key_result_id: byId(db.deliverables, del)?.key_result_id || null, unplanned: !del, status: 'In progress', pct: 0, created_by: user.id }), ['activities'], 'Added')) setT(''); }}>Add</button></div>;
}

function DeliverablesRec() {
  const { db, me, role } = useData(); const [scope, setScope] = useState<'me' | 'team'>('me'); const head = isHead(role);
  const team = useMemo(() => db && me && head ? teamOf(db, me, LEADS.includes(role)).filter(p => p.id !== me.id) : [], [db, me, head, role]);
  return <div className="stack">{head && <div className="row"><span className="sp" /><Seg value={scope} options={[['me', 'Mine'], ['team', 'My team — review & accept']]} onChange={setScope} /></div>}
    {scope === 'me' ? <MyDeliverables /> : <MonthView people={team} lead />}</div>;
}
function MyDeliverables() {
  const { db, me, role } = useData(); const save = useSave(); const { t } = useTerms(); const [m, setM] = useState(curMonth()); const [busy, setBusy] = useState(false);
  const source = useMemo(() => db && me ? db.deliverables.filter(x => x.owner_position_id === me.id && x.month === m && x.status !== 'removed').map(x => ({ id: x.id, title: x.title, kr: byId(db.key_results, x.key_result_id)?.title || '', target: x.target, actual: x.actual, status: x.status === 'done' || x.status === 'accepted' ? 'done' : 'planned', state: x.status, evidence: x.evidence_url || '', note: x.note || '', feedback: x.feedback || '' })) : [], [db, me, m]);
  const d = useDraft(source, [source]);
  if (!db || !me) return null;
  const cols: Col[] = [{ key: 'title', label: t('deliverable'), type: 'ro', width: 260 }, { key: 'kr', label: t('key_result'), type: 'ro', width: 200 }, { key: 'target', label: 'Target', type: 'ro', width: 80 },
    { key: 'actual', label: 'Delivered', type: 'number', width: 90 }, { key: 'status', label: 'Delivered?', type: 'select', options: [['planned', 'Not yet'], ['done', 'Yes — send for acceptance']], width: 190, editable: r => r.state !== 'accepted' },
    { key: 'evidence', label: 'Evidence link', type: 'text', width: 200, tip: 'A link to the document, photo or file that shows it is done.' }, { key: 'note', label: 'Note', type: 'text', width: 180 },
    { key: 'state', label: 'Manager', type: 'ro', width: 120, fmt: v => v === 'accepted' ? '✓ accepted' : v === 'returned' ? 'returned' : v === 'done' ? 'waiting' : '' }];
  async function doSave() {
    setBusy(true); let err: string | null = null; const sent: Row[] = [];
    for (const r of d.all.filter(r => r._dirty)) { const s0 = source.find(x => x.id === r.id)!; const toDone = r.status === 'done' && s0.status !== 'done';
      const x = await sb.from('deliverables').update({ actual: r.actual ?? null, evidence_url: r.evidence || null, note: r.note || null, ...(toDone ? { status: 'done', done_at: new Date().toISOString() } : r.status === 'planned' && s0.state === 'done' ? { status: 'planned' } : {}) }).eq('id', r.id);
      err = err || x.error?.message || null; if (toDone) sent.push(r); }
    if (sent.length) await notifyPositions(db!, [managerOf(db!, me!)?.id], 'deliverable', `${me!.holder_name} delivered ${sent.length} deliverable(s) for acceptance`, '/inbox');
    await save(() => Promise.resolve({ error: err }) as any, ['deliverables'], 'Saved'); setBusy(false);
  }
  return <div className="stack"><div className="row"><p className="note" style={{ flex: 1 }}>Mark what you delivered with the evidence; your manager accepts it or returns it with feedback.</p><select value={m} onChange={e => setM(Number(e.target.value))}>{MONTHS.map((x, i) => <option key={x} value={i + 1}>{x}{i + 1 === curMonth() ? ' (now)' : ''}</option>)}</select></div>
    {!d.rows.length ? <Empty>No {t('deliverable', true).toLowerCase()} for {MONTHS[m - 1]}.</Empty> : <Sheet cols={cols} rows={d.rows} onChange={d.change} />}
    {d.rows.some(r => r.feedback) && <div className="card"><h4>Feedback</h4>{d.rows.filter(r => r.feedback).map(r => <div key={r.id} className="lg"><b>{r.title}</b> — {r.feedback}</div>)}</div>}
    <SaveBar dirty={d.dirty} onSave={doSave} onDiscard={d.reset} busy={busy} />{role && null}</div>;
}

function KrProgress() {
  const { db, me, role, user, can } = useData(); const save = useSave(); const { t } = useTerms(); const [m, setM] = useState(curMonth()); const [busy, setBusy] = useState(false);
  const mine = useMemo(() => { if (!db || !me) return []; const led = isHead(role) ? headedOrgs(db, me, role) : new Set<string>();
    return db.key_results.filter(k => k.measure === 'manual' && (k.state || 'active') === 'active' && db.objectives.some(o => o.id === k.objective_id && o.status !== 'Archived' && o.level !== 'individual') && (k.updater_position_id === me.id || k.owner_position_id === me.id || db.objectives.some(o => o.id === k.objective_id && led.has(o.org_unit_id)))); }, [db, me, role, can]);
  const source = useMemo(() => db ? mine.map(k => { const mv = monthlyValues(db, k); const s = krState(db, k, currentPeriod('Q')); return { id: k.id, obj: byId(db.objectives, k.objective_id)?.text, title: k.title, uom: k.uom, agg: k.aggregation || 'sum', target: krTarget(db, k, { t: 'M', n: m }), qt: s.target, value: mv[m - 1], conf: k.confidence || 'Medium', note: '', status: s.label }; }) : [], [db, mine, m]);
  const d = useDraft(source, [source]);
  if (!db || !me) return null;
  const cols: Col[] = [{ key: 'title', label: t('key_result'), type: 'ro', width: 300 }, { key: 'uom', label: 'Unit', type: 'ro', width: 60 },
    { key: 'target', label: `${MONTHS[m - 1]} target`, type: 'ro', width: 100, fmt: v => fmt(v, 1) }, { key: 'qt', label: `Q${qOfMonth(curMonth())} target`, type: 'ro', width: 90, fmt: v => fmt(v, 1) },
    { key: 'value', label: 'Actual', type: 'number', width: 100, tip: 'For results that add up (e.g. units produced) enter what was achieved in this month. For levels (e.g. on-time %) enter the level now.' },
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
  return <div className="stack"><div className="row"><p className="note" style={{ flex: 1 }}>Record the actual for each {t('key_result').toLowerCase()} of the organisation you lead (and the levels below), or that you were named to update. Results measured from the annual plan or from deliverables update themselves and are not listed.</p><select value={m} onChange={e => setM(Number(e.target.value))}>{MONTHS.slice(0, curMonth()).map((x, i) => <option key={x} value={i + 1}>{x}</option>)}</select></div>
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
  const { db, unit } = useData(); const save = useSave(); const [m, setM] = useState(Math.max(1, curMonth() - 1)); const [busy, setBusy] = useState(false);
  const source = useMemo(() => { if (!db || !unit) return []; const out: Row[] = [];
    (['rev', 'cos', 'opex', 'capex'] as const).forEach(sec => { const groups = Array.from(new Set(linesOf(db, unit, sec).map(l => l.line_group || 'Other'))); groups.forEach(g => out.push({ id: sec + '|' + g, sec, grp: g, plan: planBy(db, unit, sec, [m], [g]), actual: actualBy(db, unit, sec, [m], [g]) })); });
    return out; }, [db, unit, m]);
  const d = useDraft(source, [source]);
  if (!db || !unit) return null;
  const SEC: Record<string, string> = { rev: 'Revenue', cos: 'Cost of sales', opex: 'Operating expenses (incl. depreciation and financial charges lines)', capex: 'Capital spending' };
  const rows: Row[] = []; const idx: number[] = []; let last = ''; d.rows.forEach((r, i) => { if (r.sec !== last) { rows.push({ _header: SEC[r.sec] }); idx.push(-1); last = r.sec; } rows.push(r); idx.push(i); });
  const cols: Col[] = [{ key: 'grp', label: 'Product group / budget line', type: 'ro', width: 300 }, { key: 'plan', label: `${MONTHS[m - 1]} plan`, type: 'ro', width: 130, fmt: v => money(v) },
    { key: 'actual', label: `${MONTHS[m - 1]} actual (ETB)`, type: 'number', width: 150, tip: 'Paste a column from the Power BI or ERP export straight into this column.' },
    { key: 'v', label: 'Achieved', type: 'ro', width: 90, fmt: (_, r) => r.actual != null && r.plan ? pct(r.actual / r.plan) : '' }];
  async function doSave() {
    setBusy(true); let err: string | null = null;
    for (const r of d.all.filter(r => r._dirty)) {
      await sb.from('actuals').delete().match({ unit_id: unit, fiscal_year: '2026/27', section: r.sec, line_group: r.grp, month: m }).is('line_id', null);
      if (r.actual != null) { const x = await sb.from('actuals').insert({ unit_id: unit, fiscal_year: '2026/27', section: r.sec, line_group: r.grp, month: m, value: r.actual, source: 'Entered in the app' }); err = err || x.error?.message || null; }
    }
    await save(() => Promise.resolve({ error: err }) as any, ['actuals'], `${MONTHS[m - 1]} actuals saved`); setBusy(false);
  }
  return <div className="stack"><div className="row"><p className="note" style={{ flex: 1 }}>Enter last month's actuals by product group and budget line before the month closes. Key results linked to the plan, the income statement and the dashboards update from these figures.</p><select value={m} onChange={e => setM(Number(e.target.value))} aria-label="Month">{MONTHS.slice(0, curMonth()).map((x, i) => <option key={x} value={i + 1}>{x}</option>)}</select></div>
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
    {v === 'week' ? <TeamView people={team} ws={ws} setWs={setWs} /> : v === 'checkins' ? <CheckIns people={[me, ...team]} lead /> : <Blockers people={team} />}</div>;
}

export function RecordPage() {
  const { db, me, role } = useData(); const { t } = useTerms(); const [sp, setSp] = useSearchParams();
  const updater = !!db && !!me && db.key_results.some(k => k.measure === 'manual' && (k.updater_position_id === me.id || k.owner_position_id === me.id));
  const fin = canEnterActuals(db, me, role);
  const tabs: [string, string][] = [['week', 'This week'], ['deliverables', t('deliverable', true)], ...(isHead(role) || updater ? [['krs', t('key_result', true)] as [string, string]] : []), ...(isHead(role) ? [['team', 'My team'] as [string, string]] : []), ...(fin ? [['finance', 'Financial actuals'] as [string, string]] : [])];
  const tab = sp.get('tab') && tabs.some(x => x[0] === sp.get('tab')) ? sp.get('tab')! : 'week';
  return <div className="light wide"><div className="lhead"><div><h1>Record</h1><p>Update what actually happened — activities, deliverables, results{fin ? ' and financial actuals' : ''}.</p></div></div>
    <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" className={tab === k ? 'on' : ''} onClick={() => setSp({ tab: k })}>{l}</button>)}</div>
    {tab === 'week' && <ThisWeek />}{tab === 'deliverables' && <DeliverablesRec />}{tab === 'krs' && <KrProgress />}{tab === 'team' && <TeamTab />}{tab === 'finance' && <FinancialActuals />}
  </div>;
}
