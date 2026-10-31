import { useState } from 'react';
import { useData, useSave, byId, ROLE_NAME, CAPS, type Row } from '../lib/data';
import { sb } from '../lib/supabase';
import { Page, NumIn, Pill, Modal } from '../lib/ui';
import { ClaimsPanel } from './Claim';

export function SettingsRules() {
  const { db } = useData(); const save = useSave(); if (!db) return null;
  const s = db.settings; const sm = s.status_method || {}; const w = s.org_weights || {}; const t = s.status_thresholds || {}; const hr = s.hr_scale || {}; const cur = s.current || {};
  const put = (key: string, value: any) => save(() => sb.from('app_settings').upsert({ key, value }), ['app_settings'], 'Saved');
  return <Page title="Rules" desc="The numbers behind scores, statuses and results." help={<p>These settings apply to every unit. The organisation share decides how much of a person's result comes from their organisation's score; the rest is their personal part. Changes apply immediately to every score shown in the app.</p>}>
    <div className="card stack"><h2>Organisation share of a person's result</h2>
      <div className="g4">{([['unit', 'Unit head'], ['department', 'Department head'], ['division', 'Division head'], ['employee', 'Team member']] as const).map(([k, l]) =>
        <label key={k} className="f">{l} (%)<NumIn value={w[k]} onChange={v => v != null && v >= 0 && v <= 100 && put('org_weights', { ...w, [k]: v })} /></label>)}</div>
      <p className="note">Result = share × organisation score + (100% − share) × personal part.</p></div>
    <div className="card stack"><h2>Status: on track, behind, off track</h2>
      <div className="g4">
        <label className="f">How progress is judged<select value={sm.method || 'pace'} onChange={e => put('status_method', { ...sm, method: e.target.value })}><option value="pace">On pace — against the share of the period passed</option><option value="absolute">Absolute — against the full period target</option></select></label>
        <label className="f">On track from (% of expected)<NumIn value={t.on_track} onChange={v => v != null && put('status_thresholds', { ...t, on_track: v })} /></label>
        <label className="f">Off track below (% of expected)<NumIn value={t.off_track} onChange={v => v != null && put('status_thresholds', { ...t, off_track: v })} /></label>
        <label className="f">"Too early" for the first (% of the period)<NumIn value={sm.grace_pct ?? 15} onChange={v => v != null && put('status_method', { ...sm, grace_pct: v })} /></label>
      </div>
      <label className="f" style={{ maxWidth: 420 }}>When the owner's confidence is Low<select value={sm.low_confidence || 'behind'} onChange={e => put('status_method', { ...sm, low_confidence: e.target.value })}><option value="behind">Show at most "Behind"</option><option value="ignore">Ignore confidence</option></select></label>
      <div className="banner"><div><b>Example with the current rules:</b> six weeks into a 13-week quarter (46% passed), a key result whose quarter target is 100 needs about {Math.round(46 * (t.on_track || 95) / 100)} to be on track and is off track below {Math.round(46 * (t.off_track || 70) / 100)}. Key results taken from the plan, deliverables or objectives below are already "to date" and are compared directly. Once the period ends, the full target applies.</div></div></div>
    <div className="card stack"><h2>HR and calendar</h2><div className="g4">
      <label className="f">Results sent to HR out of (%)<NumIn value={hr.max} onChange={v => v != null && put('hr_scale', { ...hr, max: v })} /></label>
      <label className="f">Current quarter<select value={cur.quarter} onChange={e => put('current', { ...cur, quarter: Number(e.target.value) })}>{[1, 2, 3, 4].map(q => <option key={q} value={q}>Q{q}</option>)}</select></label></div>
      <p className="note">Fiscal year starts 8 July · weeks Saturday–Friday · weekly cut-off Saturday 2:00 PM · month closes on day 9.</p></div>
    <div className="card"><h2>Who sees what</h2><div className="tw"><table className="t"><thead><tr><th>Can</th>{(Object.keys(ROLE_NAME) as (keyof typeof ROLE_NAME)[]).filter(r => r !== 'none').map(r => <th key={r}>{ROLE_NAME[r]}</th>)}</tr></thead><tbody>
      {Object.entries({ seeGroup: 'See every unit', editOKR: 'Edit OKRs', editPlan: 'Edit the annual plan', enterActuals: 'Enter actuals', approve: 'Approve plans', finalApprove: 'Final approval', managePeople: 'Accept deliverables', reports: 'See reports', settings: 'Change settings' }).map(([k, l]) =>
        <tr key={k}><td>{l}</td>{(Object.keys(ROLE_NAME) as (keyof typeof ROLE_NAME)[]).filter(r => r !== 'none').map(r => <td key={r}>{CAPS[k].includes(r) ? '✓' : ''}</td>)}</tr>)}
    </tbody></table></div><p className="note">Everyone sees their own unit's strategy, OKRs and scores, and their own work and result. The database enforces the same rules.</p></div>
  </Page>;
}

export function SettingsPeople() {
  const { db, units } = useData(); const save = useSave(); const [q, setQ] = useState(''); const [u, setU] = useState(''); const [ed, setEd] = useState<Row | null>(null);
  if (!db) return null;
  const list = db.positions.filter(p => (!u || p.unit_id === u) && (!q || [p.holder_name, p.title, p.email].some(x => (x || '').toLowerCase().includes(q.toLowerCase())))).sort((a, b) => (a.unit_id || '').localeCompare(b.unit_id || '') || a.sort - b.sort);
  const linked = db.positions.filter(p => p.user_id).length;
  return <Page title="People & access" desc="Positions, who holds them, and which sign-in is linked to each." help={<><p>Access follows the <b>position</b>, not the person. To give someone access, put their work email on their position: when they sign in (or create an account) with that email, the position is linked automatically. Their role decides what they can see and do.</p><p>People already in the weekly tracker are linked automatically by their email. Anyone else picks their own position the first time they sign in: team-member positions link straight away, leadership positions wait for your confirmation here. You get a notification either way and can undo it.</p><p>When someone moves, change the holder and email on the position; the plan, OKRs and history stay with the position.</p></>}>
    <ClaimsPanel />
    <div className="cmdbar"><label className="scope"><span>Unit</span><select value={u} onChange={e => setU(e.target.value)}><option value="">All</option>{db.org_units.filter(x => x.kind === 'unit').map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <input type="text" placeholder="Find" value={q} onChange={e => setQ(e.target.value)} /><span className="sp" /><span className="note">{linked} of {db.positions.length} positions linked to a sign-in</span>
      <button className="btn pri" onClick={() => setEd({ unit_id: units[0]?.id, org_unit_id: units[0]?.id, role: 'employee', level: 'employee', status: 'Filled' })}>+ Position</button></div>
    <div className="tw"><table className="t"><thead><tr><th>Position</th><th>Holder</th><th>Organisation</th><th>Role</th><th>Email</th><th>Sign-in</th><th /></tr></thead><tbody>
      {list.slice(0, 400).map(p => <tr key={p.id}><td>{p.title}</td><td>{p.holder_name || <span className="note">Vacant</span>}</td><td>{byId(db.org_units, p.org_unit_id)?.name}</td><td>{ROLE_NAME[p.role as keyof typeof ROLE_NAME]}</td><td>{p.email || ''}</td>
        <td>{p.user_id ? <Pill tone="good">linked</Pill> : p.email ? <Pill tone="warn">waiting</Pill> : ''}</td><td><button className="btn sm" onClick={() => setEd(p)}>Edit</button></td></tr>)}
    </tbody></table></div>
    {ed && <Modal title={ed.id ? 'Edit position' : 'New position'} onClose={() => setEd(null)}>
      <div className="g2"><label className="f">Position title<input type="text" value={ed.title || ''} onChange={e => setEd({ ...ed, title: e.target.value })} /></label><label className="f">Holder<input type="text" value={ed.holder_name || ''} onChange={e => setEd({ ...ed, holder_name: e.target.value })} /></label></div>
      <div className="g2"><label className="f">Organisation<select value={ed.org_unit_id} onChange={e => { const o = byId(db.org_units, e.target.value); setEd({ ...ed, org_unit_id: e.target.value, unit_id: o?.unit_id || o?.id }); }}>{db.org_units.filter(o => o.kind !== 'group').map(o => <option key={o.id} value={o.id}>{(o.kind === 'unit' ? '' : (byId(db.org_units, o.unit_id)?.name || '') + ' / ') + o.name}</option>)}</select></label>
        <label className="f">Role<select value={ed.role} onChange={e => { const r = e.target.value; setEd({ ...ed, role: r, level: ({ unit_head: 'unit', planning_head: 'department', finance: 'department', dept_head: 'department', div_head: 'division', employee: 'employee' } as any)[r] || 'group' }); }}>{Object.entries(ROLE_NAME).filter(([k]) => k !== 'none').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label></div>
      <div className="g2"><label className="f">Work email (links the sign-in)<input type="email" value={ed.email || ''} onChange={e => setEd({ ...ed, email: e.target.value })} /></label>
        <label className="f">Status<select value={ed.status} onChange={e => setEd({ ...ed, status: e.target.value })}><option>Filled</option><option>Vacant</option><option>Acting</option></select></label></div>
      <label className="f">Linked sign-in<select value={ed.user_id || ''} onChange={e => setEd({ ...ed, user_id: e.target.value || null })}><option value="">— not linked —</option>{db.profiles.map(p => <option key={p.id} value={p.id}>{p.email}{p.full_name ? ' · ' + p.full_name : ''}</option>)}</select></label>
      <div className="row end"><button className="btn" onClick={() => setEd(null)}>Cancel</button><button className="btn pri" disabled={!ed.title?.trim()} onClick={async () => {
        const row = { title: ed.title.trim(), holder_name: ed.holder_name || null, org_unit_id: ed.org_unit_id, unit_id: ed.unit_id, role: ed.role, level: ed.level, email: ed.email?.trim() || null, status: ed.status, user_id: ed.user_id || null };
        if (await save(() => ed.id ? sb.from('positions').update(row).eq('id', ed.id) : sb.from('positions').insert(row), ['positions'], 'Position saved')) setEd(null); }}>Save</button></div>
    </Modal>}
  </Page>;
}

const ORDER = ['org_units', 'positions', 'group_pillars', 'group_goals', 'unit_pillars', 'unit_goals', 'objectives', 'key_results', 'kr_targets', 'check_ins', 'projects', 'plan_lines', 'actuals', 'cash_items', 'cash_values', 'activity_plan_lines', 'funds', 'need_priority', 'plan_status', 'kpis', 'kpi_values'];
export function SettingsImport() {
  const { reload, db } = useData(); const [log, setLog] = useState<string[]>([]); const [busy, setBusy] = useState(false);
  async function run(file: File) {
    setBusy(true); setLog([]);
    const add = (m: string) => setLog(l => [...l, m]);
    try {
      const T = JSON.parse(await file.text());
      for (const t of ORDER) {
        let rows: Row[] = T[t]; if (!rows?.length) continue;
        if (t === 'objectives') { // parents before children
          const ids = new Set<string>(); const out: Row[] = []; let left = rows;
          while (left.length) { const ready = left.filter(r => !r.parent_objective_id || ids.has(r.parent_objective_id) || !left.some(x => x.id === r.parent_objective_id)); if (!ready.length) { out.push(...left); break; } ready.forEach(r => { ids.add(r.id); out.push(r); }); left = left.filter(r => !ids.has(r.id)); }
          rows = out;
        }
        if (t === 'org_units') rows = [...rows].sort((a, b) => ({ group: 0, unit: 1, department: 2, division: 3 } as any)[a.kind] - ({ group: 0, unit: 1, department: 2, division: 3 } as any)[b.kind]);
        let n = 0;
        for (let i = 0; i < rows.length; i += 250) {
          const { data, error } = await sb.rpc('import_rows', { tbl: t, rows: rows.slice(i, i + 250) });
          if (error) throw new Error(`${t}: ${error.message}`);
          n += data as number;
        }
        add(`${t}: ${n} rows`);
      }
      add('Done.'); await reload();
    } catch (e: any) { add('Stopped — ' + e.message); }
    setBusy(false);
  }
  return <Page title="Data import" desc="Load or refresh data from a prepared import file." help={<><p>An import file holds rows for the app's tables (organisation, positions, strategy, OKRs, annual plans, actuals, cash flow). Rows with the same id are updated, new ones are added, nothing is deleted — so the same file can be loaded again safely.</p><p>The pilot import file was prepared from the ERP Corporate Planning dataset (2026/27 OKRs and key results of the pilot departments, employees, strategic goals), the strategy documents, and the unit annual plan workbooks.</p></>}>
    <div className="card stack"><h2>Load an import file</h2>
      <input type="file" accept=".json,application/json" disabled={busy} onChange={e => e.target.files?.[0] && run(e.target.files[0])} />
      {busy && <p>Loading… keep this page open.</p>}
      {log.length > 0 && <div className="tw"><table className="t"><tbody>{log.map((l, i) => <tr key={i}><td>{l}</td></tr>)}</tbody></table></div>}
    </div>
    <div className="card"><h2>What is in the app now</h2><div className="g4">{(['org_units', 'positions', 'objectives', 'key_results', 'plan_lines', 'actuals', 'projects', 'cash_items'] as const).map(t => <div key={t} className="tile"><div className="tv">{db?.[t].length ?? 0}</div><div className="tl">{t.replace('_', ' ')}</div></div>)}</div></div>
  </Page>;
}
