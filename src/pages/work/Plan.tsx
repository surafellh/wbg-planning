/* WORK WINDOW — Plan: quarter targets (heads), monthly deliverables under each key result, weekly activities for the month.
   All in spreadsheet form; nothing is saved until "Save". */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useData, useSave, useTerms, useWindows, byId, posName, notifyPositions, managerOf, type DB, type Row } from '../../lib/data';
import { sb } from '../../lib/supabase';
import { krsOf, MONTHS, qMonths, qOfMonth, curMonth, monthStart, weekStart, ymd, weekLabel, FY, krTarget, AGG_NAME, liveObj, subtreeIds } from '../../lib/calc';
import { Seg, Empty, Pill } from '../../lib/ui';
import { Sheet, useDraft, type Col } from '../../lib/sheet';
import { teamOf } from '../Work';
import { planStatus } from '../OkrPlan';

const LEADS = ['unit_head', 'planning_head', 'super_admin', 'group_strategy', 'executive'];
export const isHead = (role: string) => role !== 'employee';
/** Organisation units whose objectives a person works under: their own and the levels above (and below, for heads). */
export function myOrgs(db: DB, me: Row, withBelow: boolean) {
  const ids = new Set<string>(); let o = byId(db.org_units, me.org_unit_id); while (o && o.kind !== 'group') { ids.add(o.id); o = byId(db.org_units, o.parent_id); }
  if (withBelow) { let grew = true; while (grew) { grew = false; db.org_units.forEach(u => { if (u.parent_id && ids.has(u.parent_id) && !ids.has(u.id) && u.unit_id === me.unit_id) { ids.add(u.id); grew = true; } }); } }
  return ids;
}
/** Key results a person plans deliverables under: their organisation's (most specific first). */
export function workKrs(db: DB, me: Row, withBelow: boolean) {
  const ids = myOrgs(db, me, withBelow); const depth = (orgId: string) => { let d = 0, o = byId(db.org_units, orgId); while (o) { d++; o = byId(db.org_units, o.parent_id); } return d; };
  return db.objectives.filter(o => ids.has(o.org_unit_id) && o.level !== 'individual' && liveObj(o)).sort((a, b) => depth(b.org_unit_id) - depth(a.org_unit_id)).flatMap(o => krsOf(db, o.id).map(k => ({ k, o })));
}
/** Organisations a person is responsible for: the one they head and everything below it (whole unit for unit heads, planners and Group). */
export function headedOrgs(db: DB, me: Row, role: string) {
  if (me.level === 'unit' || LEADS.includes(role)) return subtreeIds(db, me.unit_id);
  return subtreeIds(db, me.org_unit_id);
}
export function SaveBar({ dirty, onSave, onDiscard, label = 'Unsaved changes', busy }: { dirty: boolean; onSave: () => void; onDiscard: () => void; label?: string; busy?: boolean }) {
  if (!dirty) return null;
  return <div className="savebar"><b style={{ flex: 1 }}>{label}</b><button className="btn" onClick={onDiscard}>Discard</button><button className="btn pri" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : 'Save'}</button></div>;
}

/* ---------- Quarter targets (heads) ---------- */
function Targets() {
  const { db, me, role, can, user } = useData(); const W = useWindows(); const save = useSave(); const { t } = useTerms(); const [mode, setMode] = useState<'Q' | 'M'>('Q'); const [busy, setBusy] = useState(false);
  const krs = useMemo(() => { if (!db || !me) return []; const mine = headedOrgs(db, me, role); return workKrs(db, me, true).filter(x => mine.has(x.o.org_unit_id) && (x.k.measure === 'manual' || x.k.measure === 'deliverables')); }, [db, me, role]);
  const source = useMemo(() => db ? krs.map(({ k, o }) => { const r: Row = { id: k.id, obj: o.text, title: k.title, uom: k.uom, how: AGG_NAME[k.aggregation || 'sum']?.split(' (')[0], year: k.year_target, mode: k.target_mode };
    [1, 2, 3, 4].forEach(q => { r['q' + q] = db.kr_targets.find(x => x.kr_id === k.id && x.quarter === q)?.target ?? null; });
    for (let m = 1; m <= 12; m++) r['m' + m] = db.kr_month_targets.find(x => x.kr_id === k.id && x.month === m)?.target ?? null;
    return r; }) : [], [db, krs]);
  const d = useDraft(source, [source]);
  if (!db || !me) return null;
  const okrApproved = planStatus(db, me.unit_id, 'okr')?.status === 'Approved' && !can('approve') && db.settings.approvals?.target_changes !== false;
  const rows: Row[] = []; let last = ''; d.rows.forEach(r => { if (r.obj !== last) { rows.push({ _header: r.obj }); last = r.obj; } rows.push(r); });
  const map = rows.map(r => r._header ? -1 : d.rows.indexOf(r));
  const cols: Col[] = [{ key: 'title', label: t('key_result'), type: 'ro', width: 320 }, { key: 'uom', label: 'Unit', type: 'ro', width: 70 }, { key: 'how', label: 'Combine', type: 'ro', width: 110, tip: 'How months add up to a quarter: adds up, average or latest value. Set in the objective planner.' },
    { key: 'year', label: 'Year target', type: 'number', width: 100 }, ...(mode === 'Q' ? [1, 2, 3, 4].map(q => ({ key: 'q' + q, label: `Q${q}`, type: 'number' as const, width: 90 })) : Array.from({ length: 12 }, (_, i) => ({ key: 'm' + (i + 1), label: MONTHS[i], type: 'number' as const, width: 74 })))];
  async function doSave() {
    setBusy(true); const changes: Row[] = [];
    for (const r of d.rows.filter(r => r._dirty)) { const s0 = source.find(x => x.id === r.id)!;
      for (const key of ['year', ...[1, 2, 3, 4].map(q => 'q' + q), ...Array.from({ length: 12 }, (_, i) => 'm' + (i + 1))]) if (r[key] !== s0[key]) changes.push({ kr_id: r.id, key, old: s0[key], new: r[key], label: `${r.title} · ${key.toUpperCase()}` }); }
    if (okrApproved) { // approved plan: changes become a rescope request
      const ok = await save(() => sb.from('rescopes').insert({ unit_id: me!.unit_id, kind: 'okr_targets', trigger: 'Target change', status: 'Submitted', changes, by_user: user.id, note: `${changes.length} target change(s) by ${me!.holder_name}` }), ['rescopes'], 'Sent to Group Strategy for approval');
      if (ok) d.reset(); setBusy(false); return;
    }
    await applyTargetChanges(changes); await save(() => Promise.resolve({ error: null }) as any, ['key_results', 'kr_targets', 'kr_month_targets'], 'Targets saved'); setBusy(false);
  }
  return <div className="stack">
    <div className="row"><p className="note" style={{ flex: 1 }}>Set the targets for the {t('key_result', true).toLowerCase()} of the organisation you lead and the levels below it. {okrApproved ? 'The plan is approved, so changes go to Group Strategy as a change request.' : 'Enter by quarter or by month; the year target is for reference.'} Results measured from the annual plan take their targets from the revenue plan or budget.</p><Seg value={mode} options={[['Q', 'By quarter'], ['M', 'By month']]} onChange={setMode} />
      {W.item('okr') && <Link className="btn sm" to="/studio/okr">Add or change {t('objective', true).toLowerCase()} →</Link>}</div>
    {!krs.length ? <Empty>No {t('key_result', true).toLowerCase()} for your organisation yet.</Empty> : <Sheet cols={cols} rows={rows} onChange={(i, k, v) => { const j = map[i]; if (j >= 0) { d.change(j, k, v); d.change(j, 'mode', k.startsWith('m') && k !== 'mode' ? 'monthly' : k.startsWith('q') ? 'quarterly' : d.rows[j].mode); } }} />}
    <SaveBar dirty={d.dirty} onSave={doSave} onDiscard={d.reset} busy={busy} label={okrApproved ? 'Changes will be sent for approval' : 'Unsaved target changes'} />
  </div>;
}
/** Apply target changes (used directly, and by Studio when a change request is approved). */
export async function applyTargetChanges(changes: Row[]) {
  for (const c of changes) {
    if (c.key === 'year') await sb.from('key_results').update({ year_target: c.new }).eq('id', c.kr_id);
    else if (c.key.startsWith('q')) { const q = Number(c.key.slice(1)); await sb.from('kr_targets').delete().match({ kr_id: c.kr_id, quarter: q }); if (c.new != null) await sb.from('kr_targets').insert({ kr_id: c.kr_id, quarter: q, target: c.new }); await sb.from('key_results').update({ target_mode: 'quarterly' }).eq('id', c.kr_id); }
    else if (c.key.startsWith('m')) { const m = Number(c.key.slice(1)); await sb.from('kr_month_targets').delete().match({ kr_id: c.kr_id, month: m }); if (c.new != null) await sb.from('kr_month_targets').insert({ kr_id: c.kr_id, month: m, target: c.new }); await sb.from('key_results').update({ target_mode: 'monthly' }).eq('id', c.kr_id); }
  }
}

/* ---------- Deliverables, planned under each key result ---------- */
function Deliverables() {
  const { db, me, role, user } = useData(); const save = useSave(); const { t } = useTerms(); const [q, setQ] = useState(qOfMonth(curMonth())); const [scope, setScope] = useState<'team' | 'me'>(isHead(role) ? 'team' : 'me'); const [busy, setBusy] = useState(false);
  const head = isHead(role); const [showEmpty, setShowEmpty] = useState(false);
  const team = useMemo(() => db && me ? (head ? teamOf(db, me, LEADS.includes(role)) : [me]) : [], [db, me, head, role]);
  const krs = useMemo(() => db && me ? workKrs(db, me, head) : [], [db, me, head]);
  const ms = qMonths(q);
  const source = useMemo(() => { if (!db || !me) return []; const ids = new Set(team.map(p => p.id));
    return db.deliverables.filter(d => ms.includes(d.month) && d.status !== 'removed' && (scope === 'me' ? d.owner_position_id === me.id : ids.has(d.owner_position_id)) && (krs.some(x => x.k.id === d.key_result_id) || !d.key_result_id))
      .map(d => ({ id: d.id, kr: d.key_result_id || '', obj: d.objective_id || '', title: d.title, owner: d.owner_position_id, month: String(d.month), weight: d.weight, target: d.target, uom: d.uom, status: d.status, source: d.source, erp: d.source === 'erp' ? '⚑ replan' : d.source === 'erp_reviewed' ? '✓ replanned' : d.source === 'proposed' ? 'proposed' : '', note: d.note || '' })); }, [db, me, team, krs, scope, q]);
  const d = useDraft(source, [source]);
  if (!db || !me) return null;
  const cm = curMonth();
  const krOpts: [string, string][] = krs.map(({ k, o }) => [k.id, `${k.title.slice(0, 60)} — ${byId(db.org_units, o.org_unit_id)?.name}`]);
  const rows: Row[] = []; const index: number[] = [];
  const loose = d.rows.map((r, i) => [r, i] as [Row, number]).filter(([r]) => !r.kr || !krs.some(x => x.k.id === r.kr));
  const looseFirst = loose.sort((a, b) => Number(b[0].source === 'erp') - Number(a[0].source === 'erp'));
  Array.from(new Set(looseFirst.map(([r]) => r.obj || ''))).forEach(oid => { const o = byId(db.objectives, oid); rows.push({ _header: o ? `Not linked to a ${t('key_result').toLowerCase()} yet — ${t('objective')}: ${o.text.slice(0, 90)}` : `Not linked to a ${t('key_result').toLowerCase()} yet` }); index.push(-1); looseFirst.filter(([r]) => (r.obj || '') === oid).forEach(([r, i]) => { rows.push(r); index.push(i); }); });
  const emptyKrs = krs.filter(x => !d.rows.some(r => r.kr === x.k.id));
  krs.forEach(({ k }) => { const list = d.rows.map((r, i) => [r, i] as [Row, number]).filter(([r]) => r.kr === k.id); if (!list.length && !showEmpty) return;
    rows.push({ _header: `${t('key_result')}: ${k.title}` }); index.push(-1); list.forEach(([r, i]) => { rows.push(r); index.push(i); }); });
  const locked = (r: Row) => Number(r.month) < cm && !head;
  const cols: Col[] = [
    { key: 'title', label: t('deliverable'), type: 'text', width: 300, editable: r => !locked(r) && r.status !== 'accepted' },
    { key: 'kr', label: t('key_result'), type: 'select', options: krOpts, width: 220, placeholder: `Choose a ${t('key_result').toLowerCase()}…`, tip: 'The key result this deliverable moves. Change it to move the row under another key result.' },
    { key: 'owner', label: 'Owner', type: head ? 'select' : 'ro', options: team.map(p => [p.id, p.holder_name || p.title] as [string, string]), width: 160, fmt: v => posName(db, v) },
    { key: 'month', label: 'Month', type: 'select', options: ms.map(m => [String(m), MONTHS[m - 1]] as [string, string]), width: 90, editable: r => !locked(r) },
    { key: 'weight', label: 'Weight %', type: 'number', width: 80, tip: "Share of the owner's month. A person's deliverables in a month should add up to 100%." },
    { key: 'target', label: 'Target', type: 'number', width: 80 }, { key: 'uom', label: 'Unit', type: 'text', width: 70 },
    { key: 'status', label: 'Status', type: 'ro', width: 100 },
    ...(d.rows.some(r => r.source === 'erp' || r.source === 'erp_reviewed') ? [{ key: 'note', label: 'Original ERP OKR', type: 'ro' as const, width: 240, fmt: (v: any) => String(v || '').replace('From ERP personal OKR: ', '') }] : []),
    { key: 'erp', label: 'Source', type: 'ro', width: 110, tip: '⚑ replan: brought over from a personal OKR in the ERP. Link it to the right key result, set the month, owner and weight — or delete it. Saving the row marks it replanned. "proposed" = added by a team member, waiting for the manager.' }];
  async function doSave() {
    if (wrule === 'block' && perPerson.length) { alert(`Each person's ${MONTHS[cm - 1]} deliverable weights must add up to 100% before saving: ` + perPerson.map(x => `${x.p.holder_name} ${Math.round(x.w)}%`).join(', ')); return; }
    setBusy(true); let err: string | null = null;
    for (const r of d.all.filter(r => r._dirty)) {
      if (r._deleted) { if (r.id) { const x = await sb.from('deliverables').update({ status: 'removed' }).eq('id', r.id); err = err || x.error?.message || null; } continue; }
      if (!r._new && head && (r.source === 'erp' || r.source === 'proposed')) await sb.from('deliverables').update({ source: r.source === 'erp' ? 'erp_reviewed' : 'plan' }).eq('id', r.id);
      if (!r.title?.trim()) continue;
      const kr = byId(db!.key_results, r.kr); const row = { unit_id: me!.unit_id, key_result_id: r.kr || null, objective_id: kr?.objective_id || null, owner_position_id: r.owner || me!.id, month: Number(r.month) || ms[0], quarter: q, title: r.title.trim(), weight: r.weight ?? null, target: r.target ?? null, uom: r.uom || null };
      const x = r._new ? await sb.from('deliverables').insert({ ...row, status: 'planned', created_by: user.id, source: head ? 'plan' : 'proposed' }) : await sb.from('deliverables').update(row).eq('id', r.id);
      err = err || x.error?.message || null;
    }
    if (!head && d.all.some(r => r._new)) await notifyPositions(db!, [managerOf(db!, me!)?.id], 'deliverable', `${me!.holder_name} added deliverables for Q${q}`, '/plan?tab=deliverables');
    await save(() => Promise.resolve({ error: err }) as any, ['deliverables'], 'Deliverables saved'); setBusy(false);
  }
  const wrule = db.settings.work_rules?.weights || 'warn'; const canPropose = head || db.settings.work_rules?.propose !== false;
  const perPerson = wrule === 'off' ? [] : team.map(p => ({ p, w: d.rows.filter(r => r.owner === p.id && Number(r.month) === cm).reduce((s, r) => s + (Number(r.weight) || 0), 0) })).filter(x => x.w && Math.round(x.w) !== 100);
  return <div className="stack">
    <div className="row"><p className="note" style={{ flex: 1 }}>At the start of each quarter, break each {t('key_result').toLowerCase()} into monthly {t('deliverable', true).toLowerCase()}, each with an owner. {head ? 'Assign them to your team.' : 'Add the ones you will deliver; your manager confirms them.'} A month's plan can be changed until the month starts.</p>
      {head && <Seg value={scope} options={[['team', 'My team'], ['me', 'Mine']]} onChange={setScope} />}<Seg value={q} options={[1, 2, 3, 4].map(n => [n, 'Q' + n] as [number, string])} onChange={setQ} /></div>
    {head && d.rows.some(r => r.source === 'erp') && <div className="banner warn"><div><b>{d.rows.filter(r => r.source === 'erp').length} {t('deliverable', true).toLowerCase()} need replanning.</b> They were brought over from your team's personal OKRs in the ERP so no work was lost, but they are not yet planned properly. For each: pick the {t('key_result').toLowerCase()} it moves, the month, owner and weight — or delete it. Saving a row marks it replanned. <button className="btn sm" onClick={async () => { const ids = d.rows.filter(r => r.source === 'erp').map(r => r.id); await save(() => sb.from('deliverables').update({ source: 'erp_reviewed' }).in('id', ids), ['deliverables'], 'Marked as replanned'); }}>Keep all shown as they are</button></div></div>}
    {head && d.rows.some(r => r.source === 'proposed') && <div className="banner">{d.rows.filter(r => r.source === 'proposed').length} proposed by team members — adjust if needed and Save to confirm them.</div>}
    {perPerson.length > 0 && <div className="banner warn">{MONTHS[cm - 1]} weights not at 100%: {perPerson.slice(0, 6).map(x => `${x.p.holder_name?.split(' ')[0]} ${Math.round(x.w)}%`).join(' · ')}</div>}
    {krs.length > 0 && emptyKrs.length > 0 && <div className="row"><span className="mini" style={{ flex: 1 }}>{emptyKrs.length} of {krs.length} {t('key_result', true).toLowerCase()} have no {t('deliverable', true).toLowerCase()} this quarter{!showEmpty ? ' (hidden)' : ''}. New rows go under the {t('key_result').toLowerCase()} you pick in the row.</span><button className="btn sm" onClick={() => setShowEmpty(!showEmpty)}>{showEmpty ? 'Hide empty' : 'Show all'} {t('key_result', true).toLowerCase()}</button></div>}
    {!krs.length ? <Empty>{me.level === 'group' ? `Group-level positions plan through Studio; ${t('deliverable', true).toLowerCase()} are planned by units.` : `No ${t('key_result', true).toLowerCase()} in your organisation yet — ${head ? 'add them in Studio → Objective planner' : 'ask your manager or planning head'}.`}</Empty> :
      <Sheet cols={cols} rows={rows} onChange={(i, k, v) => index[i] >= 0 && d.change(index[i], k, v)} onDelete={i => index[i] >= 0 && d.remove(index[i])}
        onAdd={!canPropose ? undefined : () => d.add({ title: '', kr: krs[0]?.k.id || '', owner: me.id, month: String(ms.includes(cm + 1) ? cm + 1 : ms.includes(cm) ? cm : ms[0]), weight: null, target: null, uom: '', status: 'planned' } as Row)} />}
    <SaveBar dirty={d.dirty} onSave={doSave} onDiscard={d.reset} busy={busy} />
  </div>;
}

/* ---------- Weekly activities for a month (the tracker) ---------- */
export function weeksOfMonth(m: number) { const out: Date[] = []; let w = weekStart(monthStart(FY, m)); const end = monthStart(FY, m + 1); while (w < end) { out.push(w); w = new Date(w.getTime() + 7 * 864e5); } return out; }
function Activities() {
  const { db, me, role, user } = useData(); const save = useSave(); const { t } = useTerms(); const [m, setM] = useState(curMonth()); const [scope, setScope] = useState<'me' | 'team'>('me'); const [busy, setBusy] = useState(false);
  const head = isHead(role); const rules = db?.settings.work_rules || { activities: 'members' }; const mgrPlans = rules.activities !== 'members';
  const team = useMemo(() => db && me ? (head ? teamOf(db, me, LEADS.includes(role)) : [me]) : [], [db, me, head, role]);
  const weeks = weeksOfMonth(m); const wkeys = weeks.map(w => ymd(w));
  const people = scope === 'me' ? [me!] : team;
  const source = useMemo(() => { if (!db || !me) return []; const ids = new Set(people.map(p => p?.id));
    return db.activities.filter(a => ids.has(a.owner_position_id) && wkeys.includes(a.week_start)).sort((a, b) => a.week_start.localeCompare(b.week_start) || Number(b.top) - Number(a.top))
      .map(a => ({ id: a.id, title: a.title, del: a.deliverable_id || '', week: a.week_start, owner: a.owner_position_id, top: a.top ? '★' : '', baseline: a.baseline_title ? (a.baseline_title !== a.title || a.baseline_week !== a.week_start ? `was: ${a.baseline_title} (${a.baseline_week ? weekLabel(new Date(a.baseline_week + 'T00:00:00Z')) : ''})` : 'as planned') : '', status: a.status })); }, [db, me, people, m]);
  const d = useDraft(source, [source]);
  if (!db || !me) return null;
  const myDels = db.deliverables.filter(x => people.some(p => p?.id === x.owner_position_id) && x.month === m && x.status !== 'removed');
  const lockedMonth = db.activities.some(a => a.owner_position_id === me.id && wkeys.includes(a.week_start) && a.locked);
  const cols: Col[] = [
    { key: 'title', label: 'Activity', type: 'text', width: 300 },
    { key: 'del', label: t('deliverable'), type: 'select', options: myDels.map(x => [x.id, x.title.slice(0, 60)] as [string, string]), width: 230, placeholder: 'Unplanned / none', tip: 'Link each activity to the deliverable it moves — that is how weekly work counts toward the plan.' },
    { key: 'week', label: 'Week', type: 'select', options: weeks.map(w => [ymd(w), weekLabel(w)] as [string, string]), width: 100 },
    ...(scope === 'team' ? [{ key: 'owner', label: 'Owner', type: (head && mgrPlans ? 'select' : 'ro') as Col['type'], options: team.map(p => [p.id, p.holder_name || p.title] as [string, string]), width: 150, fmt: (v: any) => posName(db, v) }] : []),
    { key: 'top', label: '★', type: 'select', options: [['★', '★ top']], width: 70, tip: `Mark up to ${db.settings.work_rules?.top_max ?? 3} top priorities a week.` },
    { key: 'status', label: 'Status', type: 'ro', width: 100 },
    { key: 'baseline', label: 'Initial plan', type: 'ro', width: 200, tip: 'What was planned when the month plan was submitted — kept for comparison.' }];
  async function doSave() {
    setBusy(true); let err: string | null = null;
    for (const r of d.all.filter(r => r._dirty)) {
      if (r._deleted) { if (r.id) { const x = await sb.from('activities').delete().eq('id', r.id); err = err || x.error?.message || null; } continue; }
      if (!r.title?.trim()) continue;
      const row = { title: r.title.trim(), deliverable_id: r.del || null, key_result_id: byId(db!.deliverables, r.del)?.key_result_id || null, week_start: r.week, owner_position_id: r.owner || me!.id, top: r.top === '★', unplanned: !r.del, unit_id: me!.unit_id };
      const x = r._new ? await sb.from('activities').insert({ ...row, status: 'Not started', pct: 0, created_by: user.id, planned_by: user.id }) : await sb.from('activities').update(row).eq('id', r.id);
      err = err || x.error?.message || null;
    }
    await save(() => Promise.resolve({ error: err }) as any, ['activities'], 'Week plan saved'); setBusy(false);
  }
  async function submitMonth() {
    const mine = db!.activities.filter(a => a.owner_position_id === me!.id && wkeys.includes(a.week_start));
    for (const a of mine) await sb.from('activities').update({ locked: true, baseline_title: a.baseline_title || a.title, baseline_week: a.baseline_week || a.week_start }).eq('id', a.id);
    await save(() => Promise.resolve({ error: null }) as any, ['activities'], `${MONTHS[m - 1]} plan submitted — the initial plan is kept for comparison`);
    await notifyPositions(db!, [managerOf(db!, me!)?.id], 'week', `${me!.holder_name} submitted the ${MONTHS[m - 1]} activity plan`, '/plan?tab=week');
  }
  return <div className="stack">
    <div className="row"><p className="note" style={{ flex: 1 }}>At the start of the month, plan your activities week by week from your {t('deliverable', true).toLowerCase()}. You can change the plan every week; the plan you submit first is kept as the initial plan. Update progress in Record → This week.</p>
      {head && <Seg value={scope} options={[['me', 'Mine'], ['team', 'My team']]} onChange={setScope} />}
      <select value={m} onChange={e => setM(Number(e.target.value))} aria-label="Month">{MONTHS.map((x, i) => <option key={x} value={i + 1}>{x}{i + 1 === curMonth() ? ' (now)' : ''}</option>)}</select></div>
    {!myDels.length && <div className="banner">No {t('deliverable', true).toLowerCase()} for {MONTHS[m - 1]} yet — plan them first (Plan → {t('deliverable', true)}), or add activities without a link.</div>}
    <Sheet cols={cols} rows={d.rows} onChange={d.change} onDelete={d.remove} onAdd={() => d.add({ title: '', del: myDels[0]?.id || '', week: wkeys.find(w => w >= ymd(weekStart(new Date()))) || wkeys[0], owner: me.id, top: '', status: 'Not started', baseline: '' } as Row)}
      footer={<>{lockedMonth ? <Pill tone="good">{MONTHS[m - 1]} plan submitted</Pill> : <button className="btn sm pri" disabled={d.dirty || !d.rows.length} onClick={submitMonth}>Submit {MONTHS[m - 1]} plan</button>}</>} />
    <SaveBar dirty={d.dirty} onSave={doSave} onDiscard={d.reset} busy={busy} />
  </div>;
}

export function PlanPage() {
  const { role } = useData(); const { t } = useTerms(); const [sp, setSp] = useSearchParams(); const head = isHead(role);
  const tabs: [string, string][] = [...(head ? [['targets', 'Targets'] as [string, string]] : []), ['deliverables', t('deliverable', true)], ['week', 'Weekly activities']];
  const tab = sp.get('tab') && tabs.some(x => x[0] === sp.get('tab')) ? sp.get('tab')! : tabs[0][0];
  return <div className="light wide"><div className="lhead"><div><h1>Plan</h1><p>{head ? 'Set targets for the quarter, break key results into monthly deliverables, plan the weeks.' : 'Your monthly deliverables and your weekly activities.'}</p></div></div>
    <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" className={tab === k ? 'on' : ''} onClick={() => setSp({ tab: k })}>{l}</button>)}</div>
    {tab === 'targets' && <Targets />}{tab === 'deliverables' && <Deliverables />}{tab === 'week' && <Activities />}
  </div>;
}
export { krTarget };
