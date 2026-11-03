/* WORK WINDOW — Plan: quarter targets (heads), monthly deliverables under each key result, weekly activities for the month.
   All in spreadsheet form; nothing is saved until "Save". */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useData, useSave, useTerms, useWindows, byId, posName, notifyPositions, managerOf, type DB, type Row } from '../../lib/data';
import { sb } from '../../lib/supabase';
import { krsOf, MONTHS, qMonths, qOfMonth, curMonth, monthStart, weekStart, ymd, weekLabel, FY, krTarget, AGG_NAME, liveObj, subtreeIds } from '../../lib/calc';
import { HowItWorks, Seg, Empty, Pill } from '../../lib/ui';
import { Sheet, useDraft, type Col } from '../../lib/sheet';
import { teamOf } from '../Work';
import { planStatus, KrModal } from '../OkrPlan';

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
/* ---------- shared lists (as in the weekly tracker) ---------- */
export const PRI: [string, string][] = [['1', 'High'], ['2', 'Medium'], ['3', 'Low']];
export const ACT_KINDS: [string, string][] = [['Task', 'Task'], ['Unplanned', 'Unplanned'], ['Target-based', 'Target-based'], ['Phase step', 'Phase / milestone step']];
export const DEL_KINDS: [string, string][] = [['Target-based', 'Target-based (a number)'], ['Phase-based', 'Phase-based (milestones)'], ['Task-based', 'Task-based (a set of tasks)']];
export const YESNO: [string, string][] = [['Y', 'Yes']];
export const cats = (db: DB): [string, string][] => ((db.settings.work_lists?.categories as string[]) || ['Operational', 'Revenue', 'Strategic', 'Support']).map(c => [c, c]);
/** Units and the departments/divisions of my unit — for "depends on" / "help from". */
export const depOpts = (db: DB, me: Row): [string, string][] => [...db.org_units.filter(u => u.unit_id === me.unit_id && u.kind !== 'unit' && u.id !== me.org_unit_id).map(u => [u.id, u.name + ' (my unit)'] as [string, string]), ...db.org_units.filter(u => u.kind === 'unit' && u.code !== 'pmo').map(u => [u.id, u.name] as [string, string])];
export const orgOf = (db: DB, posId: string) => byId(db.org_units, byId(db.positions, posId)?.org_unit_id)?.name || '';
/** Detailed (all tracker columns) or simple view, remembered per browser. */
export function useDetail(key: string): [boolean, (v: boolean) => void] {
  const [v, setV] = useState<boolean>(() => { try { return localStorage.getItem('wbg.detail.' + key) !== '0'; } catch { return true; } });
  return [v, (x: boolean) => { setV(x); try { localStorage.setItem('wbg.detail.' + key, x ? '1' : '0'); } catch { /* ignore */ } }];
}
export const DetailToggle = ({ v, set }: { v: boolean; set: (x: boolean) => void }) => <Seg value={v ? 'd' : 's'} options={[['d', 'Detailed'], ['s', 'Simple']]} onChange={x => set(x === 'd')} />;

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
export function Targets({ unitId, orgId }: { unitId?: string; orgId?: string } = {}) {
  const { db, me, role, can } = useData(); const W = useWindows(); const { t } = useTerms(); const [edit, setEdit] = useState<Row | null>(null); const [view, setView] = useState<'Q' | 'M'>('Q');
  const krs = useMemo(() => { if (!db || !me) return [];
    const editable = (x: { k: Row }) => x.k.measure === 'manual' || x.k.measure === 'deliverables';
    if (unitId) { const sub = orgId ? subtreeIds(db, orgId) : null; return db.objectives.filter(o => o.unit_id === unitId && o.level !== 'individual' && liveObj(o) && (!sub || sub.has(o.org_unit_id))).flatMap(o => krsOf(db, o.id).map(k => ({ k, o }))).filter(editable); }
    const mine = headedOrgs(db, me, role); return workKrs(db, me, true).filter(x => mine.has(x.o.org_unit_id) && editable(x)); }, [db, me, role, unitId, orgId]);
  if (!db || !me) return null;
  const tUnit = unitId || me.unit_id;
  const okrApproved = planStatus(db, tUnit, 'okr')?.status === 'Approved' && !can('approve') && db.settings.approvals?.target_changes !== false;
  const pending = new Set(db.rescopes.filter(r => r.kind === 'okr_targets' && r.status === 'Submitted').flatMap(r => (r.changes || []).map((c: Row) => c.kr_id)));
  const cell = (k: Row, n: number) => { if (view === 'Q') { const v = k.target_mode === 'quarterly' ? db.kr_targets.find(x => x.kr_id === k.id && x.quarter === n)?.target : null; return v ?? krTarget(db, k, { t: 'Q', n }); } const v = k.target_mode === 'monthly' ? db.kr_month_targets.find(x => x.kr_id === k.id && x.month === n)?.target : null; return v ?? krTarget(db, k, { t: 'M', n }); };
  const set = (k: Row) => k.target_mode === 'monthly' ? 'By month' : k.target_mode === 'annual' ? 'One annual target' : 'By quarter';
  let last = '';
  return <div className="stack">
    <div className="row"><p className="note" style={{ flex: 1 }}>These are the <b>targets of the {t('key_result', true).toLowerCase()}</b> (not of deliverables) {unitId ? 'of this unit' : 'of the organisation you lead and the levels below it'}. Click <b>Set targets</b> to open the objective builder for that {t('key_result').toLowerCase()}: choose one annual target, quarterly or monthly targets, how the months combine (adds up, average, latest level) and whether higher or lower is better. {okrApproved ? 'The plan is approved, so target changes go to Group Strategy for approval.' : ''} Results measured from the annual plan take their targets from the revenue plan or budget.</p>
      <Seg value={view} options={[['Q', 'Quarters'], ['M', 'Months']]} onChange={setView} />{W.item('okr') && <Link className="btn sm" to="/studio/okr">Add or change {t('objective', true).toLowerCase()} →</Link>}</div>
    {!krs.length ? <Empty>No {t('key_result', true).toLowerCase()} with targets to set for your organisation yet.</Empty> : <div className="tw"><table className="t"><thead><tr><th className="first">{t('key_result')}</th><th>How it is measured</th><th className="n">Year</th>{(view === 'Q' ? [1, 2, 3, 4] : Array.from({ length: 12 }, (_, i) => i + 1)).map(n => <th key={n} className="n">{view === 'Q' ? 'Q' + n : MONTHS[n - 1]}</th>)}<th /></tr></thead><tbody>
      {krs.map(({ k, o }) => { const hdr = o.text !== last; last = o.text;
        return [hdr ? <tr key={'h' + o.id} className="g"><td colSpan={view === 'Q' ? 8 : 16}><b>{o.text}</b> <span className="mini">{byId(db.org_units, o.org_unit_id)?.name}</span></td></tr> : null,
          <tr key={k.id}><td className="first ind">{k.title}{pending.has(k.id) && <Pill tone="info">change waiting for approval</Pill>}</td><td className="mini">{set(k)} · {AGG_NAME[k.aggregation || 'sum']?.split(' (')[0]} · {k.direction === 'decrease' ? 'lower is better' : k.direction === 'maintain' ? 'stay on target' : 'higher is better'}{k.uom ? ` · ${k.uom}` : ''}</td>
            <td className="n">{k.year_target ?? '—'}</td>{(view === 'Q' ? [1, 2, 3, 4] : Array.from({ length: 12 }, (_, i) => i + 1)).map(n => { const v = cell(k, n); return <td key={n} className="n mini">{v == null ? '—' : Math.round(v * 100) / 100}</td>; })}
            <td><button className="btn sm" onClick={() => setEdit(k)}>Set targets</button></td></tr>]; })}
    </tbody></table></div>}
    {edit && <KrModal unit={byId(db.objectives, edit.objective_id)?.unit_id || tUnit} init={edit} focus="targets" requestOnly={okrApproved} onClose={() => setEdit(null)} />}
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
  const head = isHead(role); const [showEmpty, setShowEmpty] = useState(false); const [detail, setDetail] = useDetail('deliv'); const [mf, setMf] = useState(0);
  const team = useMemo(() => db && me ? (head ? teamOf(db, me, LEADS.includes(role)) : [me]) : [], [db, me, head, role]);
  const krs = useMemo(() => db && me ? workKrs(db, me, head) : [], [db, me, head]);
  const ms = qMonths(q);
  const source = useMemo(() => { if (!db || !me) return []; const ids = new Set(team.map(p => p.id));
    return db.deliverables.filter(d => (mf ? d.month === mf : ms.includes(d.month)) && d.status !== 'removed' && (scope === 'me' ? d.owner_position_id === me.id : ids.has(d.owner_position_id)) && (krs.some(x => x.k.id === d.key_result_id) || !d.key_result_id))
      .map(d => ({ id: d.id, code: d.code || '', kind: d.kind || 'Task-based', category: d.category || '', priority: d.priority != null ? String(d.priority) : '', outcome: d.outcome || '', due: d.due_date || '', kr: d.key_result_id || '', obj: d.objective_id || '', title: d.title, owner: d.owner_position_id, month: String(d.month), weight: d.weight, target: d.target, uom: d.uom, status: d.status, source: d.source, erp: d.source === 'erp' ? '⚑ replan' : d.source === 'erp_reviewed' ? '✓ replanned' : d.source === 'proposed' ? 'proposed' : '', note: d.note || '' })); }, [db, me, team, krs, scope, q, mf]);
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
  const open = (r: Row) => !locked(r) && r.status !== 'accepted';
  const cols: Col[] = [
    ...(detail ? [{ key: 'code', label: 'Ref', type: 'ro' as const, width: 74, tip: 'Reference code, given by the app when the row is saved. Stays the same if the title is reworded.' }] : []),
    { key: 'title', label: t('deliverable'), type: 'text', width: 280, editable: open, tip: 'The output that will exist at the end of the month — a thing you can show, not an activity.' },
    ...(detail ? [{ key: 'kind', label: 'Result type', type: 'select' as const, options: DEL_KINDS, width: 150, editable: open, tip: 'Target-based: a number to reach (e.g. 20 units sold). Phase-based: milestones reached (design → approval → launch). Task-based: a set of tasks done.' },
      { key: 'category', label: 'Category', type: 'select' as const, options: cats(db), width: 110, editable: open }] : []),
    { key: 'kr', label: t('key_result'), type: 'select', options: krOpts, width: 220, placeholder: `Choose a ${t('key_result').toLowerCase()}…`, editable: open, tip: 'The key result this deliverable moves. Change it to move the row under another key result.' },
    { key: 'owner', label: 'Owner', type: head ? 'select' : 'ro', options: team.map(p => [p.id, p.holder_name || p.title] as [string, string]), width: 160, fmt: v => posName(db, v), editable: open },
    ...(detail ? [{ key: 'dept', label: 'Department', type: 'ro' as const, width: 130, fmt: (_: any, r: Row) => orgOf(db, r.owner) }] : []),
    { key: 'month', label: 'Month', type: 'select', options: ms.map(m => [String(m), MONTHS[m - 1]] as [string, string]), width: 90, editable: open },
    ...(detail ? [{ key: 'due', label: 'Due date', type: 'date' as const, width: 110, editable: open }, { key: 'priority', label: 'Priority', type: 'select' as const, options: PRI, width: 90, editable: open },
      { key: 'outcome', label: 'Expected outcome / evidence', type: 'text' as const, width: 220, editable: open, tip: 'What "done" looks like and what evidence will show it.' }] : []),
    { key: 'target', label: 'Target', type: 'number', width: 80, editable: open }, { key: 'uom', label: 'Unit', type: 'text', width: 70, editable: open },
    { key: 'weight', label: 'Weight %', type: 'number', width: 80, editable: open, tip: "Share of the owner's month. A person's deliverables in a month should add up to 100%." },
    ...(detail ? [{ key: 'acts', label: 'Weekly tasks', type: 'ro' as const, width: 110, tip: 'Weekly activities linked to this deliverable: done / planned.', fmt: (_: any, r: Row) => { const a = db.activities.filter(x => x.deliverable_id === r.id); return a.length ? `${a.filter(x => x.status === 'Done').length} / ${a.length} done` : '—'; } }] : []),
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
      const kr = byId(db!.key_results, r.kr); const row = { unit_id: me!.unit_id, key_result_id: r.kr || null, objective_id: kr?.objective_id || null, owner_position_id: r.owner || me!.id, month: Number(r.month) || ms[0], quarter: q, title: r.title.trim(), weight: r.weight ?? null, target: r.target ?? null, uom: r.uom || null, kind: r.kind || 'Task-based', category: r.category || null, priority: r.priority ? Number(r.priority) : null, outcome: r.outcome || null, due_date: r.due || null };
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
      <DetailToggle v={detail} set={setDetail} />{head && <Seg value={scope} options={[['team', 'My team'], ['me', 'Mine']]} onChange={setScope} />}<Seg value={q} options={[1, 2, 3, 4].map(n => [n, 'Q' + n] as [number, string])} onChange={v => { setQ(v); setMf(0); }} />
      <select value={mf} onChange={e => setMf(Number(e.target.value))} aria-label="Month"><option value={0}>All months (Q{q})</option>{ms.map(m => <option key={m} value={m}>{MONTHS[m - 1]}{m === cm ? ' (now)' : ''}</option>)}</select></div>
    {head && d.rows.some(r => r.source === 'erp') && <div className="banner warn"><div><b>{d.rows.filter(r => r.source === 'erp').length} {t('deliverable', true).toLowerCase()} need replanning.</b> They were brought over from your team's personal OKRs in the ERP so no work was lost, but they are not yet planned properly. For each: pick the {t('key_result').toLowerCase()} it moves, the month, owner and weight — or delete it. Saving a row marks it replanned. <button className="btn sm" onClick={async () => { const ids = d.rows.filter(r => r.source === 'erp').map(r => r.id); await save(() => sb.from('deliverables').update({ source: 'erp_reviewed' }).in('id', ids), ['deliverables'], 'Marked as replanned'); }}>Keep all shown as they are</button></div></div>}
    {head && d.rows.some(r => r.source === 'proposed') && <div className="banner">{d.rows.filter(r => r.source === 'proposed').length} proposed by team members — adjust if needed and Save to confirm them.</div>}
    {perPerson.length > 0 && <div className="banner warn">{MONTHS[cm - 1]} weights not at 100%: {perPerson.slice(0, 6).map(x => `${x.p.holder_name?.split(' ')[0]} ${Math.round(x.w)}%`).join(' · ')}</div>}
    {krs.length > 0 && emptyKrs.length > 0 && <div className="row"><span className="mini" style={{ flex: 1 }}>{emptyKrs.length} of {krs.length} {t('key_result', true).toLowerCase()} have no {t('deliverable', true).toLowerCase()} this quarter{!showEmpty ? ' (hidden)' : ''}. New rows go under the {t('key_result').toLowerCase()} you pick in the row.</span><button className="btn sm" onClick={() => setShowEmpty(!showEmpty)}>{showEmpty ? 'Hide empty' : 'Show all'} {t('key_result', true).toLowerCase()}</button></div>}
    {!krs.length ? <Empty>{me.level === 'group' ? `Group-level positions plan through Studio; ${t('deliverable', true).toLowerCase()} are planned by units.` : `No ${t('key_result', true).toLowerCase()} in your organisation yet — ${head ? 'add them in Studio → Objective planner' : 'ask your manager or planning head'}.`}</Empty> :
      <Sheet cols={cols} rows={rows} onChange={(i, k, v) => index[i] >= 0 && d.change(index[i], k, v)} onDelete={i => index[i] >= 0 && d.remove(index[i])}
        onAdd={!canPropose ? undefined : () => d.add({ title: '', kind: 'Task-based', category: '', priority: '2', kr: krs[0]?.k.id || '', owner: me.id, month: String(mf || (ms.includes(cm + 1) ? cm + 1 : ms.includes(cm) ? cm : ms[0])), weight: null, target: null, uom: '', status: 'planned' } as Row)} />}
    <SaveBar dirty={d.dirty} onSave={doSave} onDiscard={d.reset} busy={busy} />
  </div>;
}

/* ---------- Weekly activities for a month (the tracker) ---------- */
export function weeksOfMonth(m: number) { const out: Date[] = []; let w = weekStart(monthStart(FY, m)); const end = monthStart(FY, m + 1); while (w < end) { out.push(w); w = new Date(w.getTime() + 7 * 864e5); } return out; }
function Activities() {
  const { db, me, role, user } = useData(); const save = useSave(); const { t } = useTerms(); const [m, setM] = useState(curMonth()); const [scope, setScope] = useState<'me' | 'team'>('me'); const [busy, setBusy] = useState(false); const [detail, setDetail] = useDetail('acts'); const [wf, setWf] = useState('');
  const head = isHead(role); const rules = db?.settings.work_rules || { activities: 'both' }; const mode = rules.activities || 'both';
  const team = useMemo(() => db && me ? (head ? teamOf(db, me, LEADS.includes(role)) : [me]) : [], [db, me, head, role]);
  const weeks = weeksOfMonth(m); const wkeys = weeks.map(w => ymd(w)); const thisWk = ymd(weekStart(new Date()));
  const people = useMemo(() => scope === 'me' ? [me!] : team, [scope, me, team]);
  const source = useMemo(() => { if (!db || !me) return []; const ids = new Set(people.map(p => p?.id));
    return db.activities.filter(a => ids.has(a.owner_position_id) && (wf ? a.week_start === wf : wkeys.includes(a.week_start))).sort((a, b) => a.week_start.localeCompare(b.week_start) || Number(b.top) - Number(a.top) || (a.priority || 9) - (b.priority || 9))
      .map(a => ({ id: a.id, code: a.code || '', title: a.title, kind: a.kind || (a.unplanned ? 'Unplanned' : 'Task'), category: a.category || '', del: a.deliverable_id || '', week: a.week_start, owner: a.owner_position_id, due: a.due_date || '', priority: a.priority != null ? String(a.priority) : '',
        outcome: a.outcome || '', target: a.target, uom: a.uom || '', lower: a.lower_better ? 'Y' : '', weight: a.weight, dep: a.help_from_unit || '', dependency: a.dependency || '', top: a.top ? '★' : '', status: a.status, carried: a.carried_count || 0,
        baseline: a.baseline_title ? (a.baseline_title !== a.title || a.baseline_week !== a.week_start ? `was: ${a.baseline_title} (${a.baseline_week ? weekLabel(new Date(a.baseline_week + 'T00:00:00Z')) : ''})` : 'as planned') : '' })); }, [db, me, people, m, wf]);
  const d = useDraft(source, [source]);
  if (!db || !me) return null;
  const dels = db.deliverables.filter(x => people.some(p => p?.id === x.owner_position_id) && x.month === m && x.status !== 'removed');
  const lockedMonth = db.activities.some(a => a.owner_position_id === me.id && wkeys.includes(a.week_start) && a.locked);
  // who may change a row: own rows (unless managers plan for everyone), team rows for heads (unless members plan their own); weeks already past are updated in Record
  const canRow = (r: Row) => { const own = (r.owner || me.id) === me.id; const who = own ? (mode !== 'managers' || head) : head && mode !== 'members'; return who && (r._new || r.week >= thisWk || head); };
  const canAdd = mode !== 'managers' || head;
  const delOf = (id: string) => byId(db.deliverables, id);
  const cols: Col[] = [
    ...(detail ? [{ key: 'code', label: 'Ref', type: 'ro' as const, width: 74, tip: 'Reference code given by the app. A task carried to the next week keeps its code, even if reworded.' }] : []),
    { key: 'title', label: 'Activity / task', type: 'text', width: 280, editable: canRow },
    ...(detail ? [{ key: 'kind', label: 'Type', type: 'select' as const, options: ACT_KINDS, width: 120, editable: canRow, tip: 'Task: a normal planned task. Unplanned: came up during the week. Target-based: has a number to reach this week. Phase step: a milestone step of a phase-based deliverable.' },
      { key: 'category', label: 'Category', type: 'select' as const, options: cats(db), width: 110, editable: canRow }] : []),
    { key: 'del', label: t('deliverable'), type: 'select', options: dels.map(x => [x.id, x.title.slice(0, 60)] as [string, string]), width: 220, placeholder: 'Unplanned / none', editable: canRow, tip: 'The monthly deliverable this activity moves — that is how weekly work counts toward the plan.' },
    ...(detail ? [{ key: 'kr', label: t('key_result'), type: 'ro' as const, width: 180, fmt: (_: any, r: Row) => byId(db.key_results, delOf(r.del)?.key_result_id)?.title || '' }] : []),
    ...(scope === 'team' ? [{ key: 'owner', label: 'Owner', type: (head && mode !== 'members' ? 'select' : 'ro') as Col['type'], options: team.map(p => [p.id, p.holder_name || p.title] as [string, string]), width: 150, fmt: (v: any) => posName(db, v), editable: canRow }] : []),
    ...(detail ? [{ key: 'dept', label: 'Department', type: 'ro' as const, width: 130, fmt: (_: any, r: Row) => orgOf(db, r.owner || me.id) }] : []),
    { key: 'week', label: 'Week', type: 'select', options: weeks.filter(w => head || ymd(w) >= thisWk).map(w => [ymd(w), weekLabel(w)] as [string, string]), width: 95, editable: canRow, tip: 'Past weeks are closed; their progress is in Record.' },
    { key: 'due', label: 'Due date', type: 'date', width: 115, editable: canRow, tip: 'Can be moved later (rescheduling) in Record → This week.' },
    { key: 'priority', label: 'Priority', type: 'select', options: PRI, width: 90, editable: canRow },
    ...(detail ? [{ key: 'outcome', label: 'Expected outcome', type: 'text' as const, width: 200, editable: canRow, tip: 'What will exist when it is done.' },
      { key: 'target', label: 'Target', type: 'number' as const, width: 80, editable: canRow, tip: 'For target-based tasks: the number to reach this week.' }, { key: 'uom', label: 'Unit', type: 'text' as const, width: 70, editable: canRow },
      { key: 'lower', label: 'Lower is better', type: 'select' as const, options: YESNO, width: 90, editable: canRow, tip: 'Yes for targets where less is better (e.g. days to close, defects).' },
      { key: 'weight', label: 'Weight %', type: 'number' as const, width: 80, editable: canRow, tip: 'Share of the deliverable this task carries. Tasks under one deliverable should add up to 100%; if left empty they count equally.' },
      { key: 'dep', label: 'Depends on', type: 'select' as const, options: depOpts(db, me), width: 160, editable: canRow, tip: 'Another department or unit whose input this task needs. They are notified if it gets stuck.' },
      { key: 'dependency', label: 'What is needed', type: 'text' as const, width: 180, editable: canRow }] : []),
    { key: 'top', label: '★', type: 'select', options: [['★', '★ top']], width: 70, editable: canRow, tip: `Mark up to ${db.settings.work_rules?.top_max ?? 3} top priorities a week.` },
    { key: 'status', label: 'Status', type: 'ro', width: 100, tip: 'Progress is updated in Record → This week.' },
    ...(detail ? [{ key: 'carried', label: 'Carried', type: 'ro' as const, width: 70, fmt: (v: any) => v ? `${v} wk` : '', tip: 'How many weeks this task has been carried over.' }] : []),
    { key: 'baseline', label: 'Initial plan', type: 'ro', width: 190, tip: 'What was planned when the month plan was submitted — kept for comparison.' }];
  const topMax = db.settings.work_rules?.top_max ?? 3; const tooManyTop = wkeys.filter(w => d.rows.filter(r => r.week === w && r.top === '★' && (r.owner || me.id) === me.id).length > topMax);
  async function doSave() {
    setBusy(true); let err: string | null = null;
    for (const r of d.all.filter(r => r._dirty)) {
      if (r._deleted) { if (r.id) { const x = await sb.from('activities').delete().eq('id', r.id); err = err || x.error?.message || null; } continue; }
      if (!r.title?.trim()) continue;
      const row = { title: r.title.trim(), kind: r.kind || 'Task', category: r.category || null, deliverable_id: r.del || null, key_result_id: delOf(r.del)?.key_result_id || null, week_start: r.week, owner_position_id: r.owner || me!.id, due_date: r.due || null, priority: r.priority ? Number(r.priority) : null,
        outcome: r.outcome || null, target: r.target ?? null, uom: r.uom || null, lower_better: r.lower === 'Y', weight: r.weight ?? null, help_from_unit: r.dep || null, dependency: r.dependency || null, top: r.top === '★', unplanned: r.kind === 'Unplanned' || !r.del, unit_id: me!.unit_id };
      const x = r._new ? await sb.from('activities').insert({ ...row, status: 'Not started', pct: 0, created_by: user.id, planned_by: user.id }) : await sb.from('activities').update(row).eq('id', r.id);
      err = err || x.error?.message || null;
    }
    await save(() => Promise.resolve({ error: err }) as any, ['activities'], 'Week plan saved'); setBusy(false);
  }
  async function submitMonth() {
    const mine = db!.activities.filter(a => a.owner_position_id === me!.id && wkeys.includes(a.week_start));
    for (const a of mine) await sb.from('activities').update({ locked: true, baseline_title: a.baseline_title || a.title, baseline_week: a.baseline_week || a.week_start }).eq('id', a.id);
    await save(() => Promise.resolve({ error: null }) as any, ['activities'], `${MONTHS[m - 1]} plan submitted — the initial plan is kept for comparison`);
    await notifyPositions(db!, [managerOf(db!, me!)?.id], 'week', `${me!.holder_name} submitted the ${MONTHS[m - 1]} activity plan`, '/record?tab=team');
  }
  const wsDefault = wf || wkeys.find(w => w >= thisWk) || wkeys[0];
  return <div className="stack">
    <div className="row"><p className="note" style={{ flex: 1 }}>At the start of the month, plan your activities week by week from your {t('deliverable', true).toLowerCase()}, with the detail of the weekly tracker. You can change the plan every week; the plan you submit first is kept as the initial plan. Progress is updated in Record → This week.{mode === 'managers' && !head ? ' In your organisation managers plan the activities; ask yours to add or change one.' : ''}</p>
      <DetailToggle v={detail} set={setDetail} />{head && <Seg value={scope} options={[['me', 'Mine'], ['team', 'My team']]} onChange={setScope} />}
      <select value={m} onChange={e => { setM(Number(e.target.value)); setWf(''); }} aria-label="Month">{MONTHS.map((x, i) => <option key={x} value={i + 1}>{x}{i + 1 === curMonth() ? ' (now)' : ''}</option>)}</select>
      <select value={wf} onChange={e => setWf(e.target.value)} aria-label="Week"><option value="">All weeks ({MONTHS[m - 1]})</option>{weeks.map(w => <option key={ymd(w)} value={ymd(w)}>{weekLabel(w)}{ymd(w) === thisWk ? ' (this week)' : ''}</option>)}</select></div>
    {!dels.length && <div className="banner">No {t('deliverable', true).toLowerCase()} for {MONTHS[m - 1]} yet — plan them first (Plan → {t('deliverable', true)}), or add activities without a link.</div>}
    {tooManyTop.length > 0 && <div className="banner warn">More than {topMax} top priorities (★) in {tooManyTop.map(w => weekLabel(new Date(w + 'T00:00:00Z'))).join(', ')}.</div>}
    <Sheet cols={cols} rows={d.rows} onChange={d.change} onDelete={i => canRow(d.rows[i]) && d.remove(i)} onAdd={canAdd ? () => d.add({ title: '', kind: 'Task', category: '', del: dels.find(x => x.owner_position_id === me.id)?.id || '', week: wsDefault, owner: me.id, due: '', priority: '2', top: '', status: 'Not started', baseline: '', carried: 0 } as Row) : undefined}
      footer={<>{lockedMonth ? <Pill tone="good">{MONTHS[m - 1]} plan submitted</Pill> : <button className="btn sm pri" disabled={d.dirty || !d.rows.length} onClick={submitMonth}>Submit {MONTHS[m - 1]} plan</button>}</>} />
    <SaveBar dirty={d.dirty} onSave={doSave} onDiscard={d.reset} busy={busy} />
  </div>;
}

export function PlanPage() {
  const { role } = useData(); const { t } = useTerms(); const [sp, setSp] = useSearchParams(); const head = isHead(role);
  const tabs: [string, string][] = [...(head ? [['targets', 'Targets'] as [string, string]] : []), ['deliverables', t('deliverable', true)], ['week', 'Weekly activities']];
  const tab = sp.get('tab') && tabs.some(x => x[0] === sp.get('tab')) ? sp.get('tab')! : tabs[0][0];
  return <div className="light wide"><div className="lhead"><div><h1>Plan</h1><p>{head ? 'Set targets for the quarter, break key results into monthly deliverables, plan the weeks.' : 'Your monthly deliverables and your weekly activities.'}<HowItWorks><h3>What this page is for</h3><p>Planning, from the quarter down to the week.</p><ul><li><b>Targets</b> (leaders) — the quarterly or monthly targets of your key results. They are set through the objective builder, so the way months combine (adds up, average, latest) and the direction (higher or lower is better) stay with the target.</li><li><b>Deliverables</b> — each key result broken into monthly outputs, each with an owner and weight. Filter by month or see the whole quarter.</li><li><b>Weekly activities</b> — the tasks for each week of the month that move the deliverables. Filter by week or see the whole month. Submit the month plan; progress is updated in Record.</li></ul></HowItWorks></p></div></div>
    <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" className={tab === k ? 'on' : ''} onClick={() => setSp({ tab: k })}>{l}</button>)}</div>
    {tab === 'targets' && <Targets />}{tab === 'deliverables' && <Deliverables />}{tab === 'week' && <Activities />}
  </div>;
}
export { krTarget };
