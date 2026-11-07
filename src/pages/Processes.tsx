/* WORK WINDOW — Processes: each unit follows its own business process map (BPM). Steps run in a line with approve/return gates; a "case" is one run of a process. */
import { useMemo, useState } from 'react';
import { useData, useSave, type Row } from '../lib/data';
import { sb } from '../lib/supabase';
import { Page, Cmd, Pill, Modal, Empty, Seg, Tile } from '../lib/ui';

const EDIT_ROLES = ['super_admin', 'group_strategy', 'unit_head', 'planning_head'];
const days = (a?: string | null, b?: string | null) => Math.max(0, Math.round(((b ? new Date(b).getTime() : Date.now()) - (a ? new Date(a).getTime() : Date.now())) / 864e5));
const num = (a: string, b: string) => parseFloat(a) - parseFloat(b) || a.localeCompare(b);

/* ---------- Flow chart (drawn from the steps; forward arrows straight, return/skip arrows on the right) ---------- */
function Flow({ steps, mark }: { steps: Row[]; mark?: string | null }) {
  const W = 340, H = 52, G = 30, X = 40, ROW = H + G;
  const idx = new Map(steps.map((s, i) => [s.no, i]));
  const edges: { from: number; to: number; label?: string }[] = [];
  steps.forEach((s, i) => {
    if (s.is_gate) { if (s.yes_no && idx.has(s.yes_no)) edges.push({ from: i, to: idx.get(s.yes_no)!, label: 'Yes' }); if (s.no_no && idx.has(s.no_no)) edges.push({ from: i, to: idx.get(s.no_no)!, label: 'No' }); }
    else if (s.next_no && idx.has(s.next_no)) edges.push({ from: i, to: idx.get(s.next_no)! });
  });
  const lanes = edges.filter(e => e.to !== e.from + 1);
  const height = steps.length * ROW + 20, width = X + W + 40 + Math.min(lanes.length, 10) * 14;
  const y = (i: number) => 10 + i * ROW;
  let lane = 0;
  return <div className="flowwrap" style={{ overflowX: 'auto' }}><svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="Process flow">
    <defs><marker id="ar" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="currentColor" /></marker></defs>
    {edges.map((e, k) => {
      const a = y(e.from), b = y(e.to), tone = e.label === 'No' ? '#c0392b' : e.label === 'Yes' ? '#2e8b57' : 'currentColor';
      if (e.to === e.from + 1) return <g key={k} style={{ color: tone }}><line x1={X + W / 2} y1={a + H} x2={X + W / 2} y2={b - 2} stroke={tone} strokeWidth="1.5" markerEnd="url(#ar)" />{e.label && <text x={X + W / 2 + 6} y={a + H + 16} fontSize="11" fill={tone}>{e.label}</text>}</g>;
      const lx = X + W + 14 + (lane++ % 10) * 14, fy = a + H / 2, ty = b + H / 2;
      return <g key={k} style={{ color: tone }}><path d={`M${X + W} ${fy} H${lx} V${ty} H${X + W + 2}`} fill="none" stroke={tone} strokeWidth="1.3" strokeDasharray={e.to < e.from ? '4 3' : undefined} markerEnd="url(#ar)" />{e.label && <text x={X + W + 4} y={fy - 4} fontSize="11" fill={tone}>{e.label}</text>}</g>;
    })}
    {steps.map((s, i) => <g key={s.id}>
      <rect x={X} y={y(i)} width={W} height={H} rx={s.is_gate ? 26 : 8} fill={s.no === mark ? '#f5c518' : 'var(--panel, #fff)'} stroke={s.is_gate ? '#c9a100' : 'var(--line, #bbb)'} strokeWidth={s.no === mark ? 2.5 : 1.5} />
      <text x={X + 14} y={y(i) + 21} fontSize="12" fontWeight="700" fill="var(--ink, #333)">{s.no}. {(s.is_gate ? s.gate_question : s.name || '').slice(0, 46)}{(s.is_gate ? s.gate_question : s.name || '').length > 46 ? '…' : ''}</text>
      <text x={X + 14} y={y(i) + 40} fontSize="11" fill="var(--muted, #777)">{s.is_gate ? 'Decision · ' : ''}{(s.actor || '').slice(0, 50)}</text>
    </g>)}
  </svg></div>;
}

/* ---------- Steps editor ---------- */
function StepsEditor({ def, steps, canEdit }: { def: Row; steps: Row[]; canEdit: boolean }) {
  const save = useSave(); const T = ['process_steps'];
  const upd = (id: string, patch: Row) => save(() => sb.from('process_steps').update(patch).eq('id', id), T);
  const nos = steps.map(s => s.no);
  const add = () => { const n = String((steps.length ? Math.max(...steps.map(s => parseInt(s.no) || 0)) : 0) + 1); const prev = steps[steps.length - 1];
    save(async () => { const r = await sb.from('process_steps').insert({ process_id: def.id, no: n, name: 'New step', actor: '', sort: steps.length }); if (!r.error && prev && !prev.is_gate && !prev.next_no) await sb.from('process_steps').update({ next_no: n }).eq('id', prev.id); return r; }, T); };
  const del = (s: Row) => { if (confirm(`Delete step ${s.no}?`)) save(() => sb.from('process_steps').delete().eq('id', s.id), T); };
  const Pick = ({ s, f }: { s: Row; f: 'next_no' | 'yes_no' | 'no_no' }) => <select disabled={!canEdit} value={s[f] || ''} onChange={e => upd(s.id, { [f]: e.target.value || null })}><option value="">— end —</option>{nos.map(n => <option key={n} value={n}>{n}</option>)}</select>;
  return <div className="card">
    <div className="sheet"><table className="wrap"><thead><tr><th>No.</th><th>Step</th><th>Who does it</th><th>Decision?</th><th>Question / what to do</th><th>Next</th><th>If yes</th><th>If no</th><th>Days</th>{canEdit && <th />}</tr></thead>
      <tbody>{steps.map(s => <tr key={s.id}>
        <td><b>{s.no}</b></td>
        <td><input disabled={!canEdit} defaultValue={s.name} onBlur={e => e.target.value !== s.name && upd(s.id, { name: e.target.value })} /></td>
        <td><input disabled={!canEdit} defaultValue={s.actor || ''} onBlur={e => e.target.value !== (s.actor || '') && upd(s.id, { actor: e.target.value })} /></td>
        <td><input type="checkbox" disabled={!canEdit} checked={!!s.is_gate} onChange={e => upd(s.id, e.target.checked ? { is_gate: true, next_no: null } : { is_gate: false, yes_no: null, no_no: null })} /></td>
        <td>{s.is_gate ? <input disabled={!canEdit} defaultValue={s.gate_question || ''} onBlur={e => e.target.value !== (s.gate_question || '') && upd(s.id, { gate_question: e.target.value })} /> : <input disabled={!canEdit} defaultValue={s.description || ''} onBlur={e => e.target.value !== (s.description || '') && upd(s.id, { description: e.target.value })} />}</td>
        <td>{s.is_gate ? '—' : <Pick s={s} f="next_no" />}</td><td>{s.is_gate ? <Pick s={s} f="yes_no" /> : '—'}</td><td>{s.is_gate ? <Pick s={s} f="no_no" /> : '—'}</td>
        <td><input style={{ width: 54 }} type="number" min={0} disabled={!canEdit} defaultValue={s.sla_days ?? ''} onBlur={e => upd(s.id, { sla_days: e.target.value === '' ? null : +e.target.value })} /></td>
        {canEdit && <td><button className="btn xs danger" onClick={() => del(s)}>Delete</button></td>}
      </tr>)}</tbody></table></div>
    {canEdit && <div style={{ marginTop: 10 }}><button className="btn sm" onClick={add}>+ Add step</button> <span className="note">Steps run in order. Tick “Decision?” for an approve / return gate and choose where Yes and No go. “Days” is how long the step should take (used to flag late cases).</span></div>}
  </div>;
}

/* ---------- KPIs ---------- */
function Kpis({ def, kpis, canEdit, cases }: { def: Row; kpis: Row[]; canEdit: boolean; cases: Row[] }) {
  const save = useSave(); const [nm, setNm] = useState('');
  const closed = cases.filter(c => c.status === 'done' && c.closed_at); const avg = closed.length ? closed.reduce((a, c) => a + days(c.started_at, c.closed_at), 0) / closed.length : null;
  return <div className="card">
    <div className="tiles" style={{ marginBottom: 12 }}><Tile v={cases.filter(c => c.status === 'open').length} label="Open cases" /><Tile v={closed.length} label="Completed" /><Tile v={avg == null ? '—' : avg.toFixed(1)} label="Average days to complete" sub="measured by the app" /></div>
    {kpis.length ? <div className="sheet"><table className="wrap"><thead><tr><th>Indicator</th><th>What it measures</th><th>Unit</th><th>Period</th><th>Data source</th>{canEdit && <th />}</tr></thead>
      <tbody>{kpis.map(k => <tr key={k.id}><td><b>{k.name}</b></td><td>{k.description}</td><td>{k.unit}</td><td>{k.period}</td><td>{k.source}</td>{canEdit && <td><button className="btn xs danger" onClick={() => save(() => sb.from('process_kpis').delete().eq('id', k.id), ['process_kpis'])}>Delete</button></td>}</tr>)}</tbody></table></div> : <Empty>No indicators for this process yet.</Empty>}
    {canEdit && <div className="row" style={{ marginTop: 10, gap: 8 }}><input placeholder="New indicator name" value={nm} onChange={e => setNm(e.target.value)} /><button className="btn sm" disabled={!nm.trim()} onClick={async () => { if (await save(() => sb.from('process_kpis').insert({ process_id: def.id, name: nm.trim() }), ['process_kpis'])) setNm(''); }}>+ Add indicator</button></div>}
  </div>;
}

/* ---------- Cases (runs of the process) ---------- */
function Cases({ def, steps, cases, unit }: { def: Row; steps: Row[]; cases: Row[]; unit: string }) {
  const { db, me, toast } = useData(); const save = useSave(); const [nw, setNw] = useState(false); const [title, setTitle] = useState(''); const [ref, setRef] = useState(''); const [show, setShow] = useState<Row | null>(null); const [note, setNote] = useState('');
  const by = (no?: string | null) => steps.find(s => s.no === no);
  const first = steps[0];
  const log = (c: Row, action: string, to: string | null, n?: string) => ({ case_id: c.id, step_no: c.current_no, action, to_no: to, note: n || null, by_name: me?.holder_name || me?.title || null });
  const start = async () => { if (!first || !title.trim()) return;
    const ok = await save(async () => { const r = await sb.from('process_cases').insert({ process_id: def.id, unit_id: unit, title: title.trim(), ref: ref.trim() || null, current_no: first.no, owner_position_id: me?.id || null }).select().single();
      if (!r.error) await sb.from('process_case_log').insert({ case_id: r.data.id, step_no: first.no, action: 'start', to_no: first.no, by_name: me?.holder_name || me?.title || null }); return r; }, ['process_cases', 'process_case_log'], 'Case started');
    if (ok) { setNw(false); setTitle(''); setRef(''); } };
  const move = async (c: Row, action: 'done' | 'yes' | 'no', n?: string) => { const s = by(c.current_no); if (!s) return;
    const to = action === 'done' ? s.next_no : action === 'yes' ? s.yes_no : s.no_no; const fin = !to;
    await save(async () => { const r = await sb.from('process_cases').update({ current_no: to || c.current_no, step_started_at: new Date().toISOString(), status: fin ? 'done' : 'open', closed_at: fin ? new Date().toISOString() : null }).eq('id', c.id);
      if (!r.error) await sb.from('process_case_log').insert(log(c, action, to, n)); return r; }, ['process_cases', 'process_case_log'], fin ? 'Process completed' : 'Moved to step ' + to); };
  const back = async (c: Row) => { const logs = db!.process_case_log.filter(l => l.case_id === c.id && l.to_no && l.to_no !== c.current_no).sort((a, b) => a.at.localeCompare(b.at)); const prev = logs.length ? logs[logs.length - 1].step_no : null; if (!prev) return toast('Already at the first step');
    await save(async () => { const r = await sb.from('process_cases').update({ current_no: prev, step_started_at: new Date().toISOString() }).eq('id', c.id); if (!r.error) await sb.from('process_case_log').insert(log(c, 'return', prev)); return r; }, ['process_cases', 'process_case_log'], 'Returned to step ' + prev); };
  const cancel = (c: Row) => confirm('Cancel this case?') && save(async () => { const r = await sb.from('process_cases').update({ status: 'cancelled', closed_at: new Date().toISOString() }).eq('id', c.id); if (!r.error) await sb.from('process_case_log').insert(log(c, 'cancel', null)); return r; }, ['process_cases', 'process_case_log']);
  const open = cases.filter(c => c.status === 'open'), done = cases.filter(c => c.status !== 'open');
  const Row_ = ({ c }: { c: Row }) => { const s = by(c.current_no); const d = days(c.step_started_at); const late = c.status === 'open' && s?.sla_days != null && d > s.sla_days;
    return <tr><td><b>{c.title}</b>{c.ref && <div className="note">{c.ref}</div>}</td>
      <td>{c.status === 'open' ? <><b>{c.current_no}.</b> {s?.is_gate ? s.gate_question : s?.name}<div className="note">{s?.actor}</div></> : <Pill tone={c.status === 'done' ? 'good' : 'none'}>{c.status === 'done' ? 'Completed' : 'Cancelled'}</Pill>}</td>
      <td>{c.status === 'open' ? <>{d} d{late && <> <Pill tone="bad">late</Pill></>}</> : `${days(c.started_at, c.closed_at)} d total`}</td>
      <td style={{ whiteSpace: 'nowrap' }}>{c.status === 'open' && s && <>
        {s.is_gate ? <><button className="btn sm pri" onClick={() => move(c, 'yes')}>Yes</button> <button className="btn sm" onClick={() => move(c, 'no')}>No</button></> : <button className="btn sm pri" onClick={() => move(c, 'done')}>{s.next_no ? 'Done → next' : 'Finish'}</button>} <button className="btn xs" onClick={() => back(c)} title="Send back to the previous step">↶</button> <button className="btn xs" onClick={() => cancel(c)} title="Cancel this case">✕</button></>} <button className="btn xs" onClick={() => setShow(c)}>History</button></td></tr>; };
  const lg = show ? db!.process_case_log.filter(l => l.case_id === show.id).sort((a, b) => a.at.localeCompare(b.at)) : [];
  return <div className="card">
    <div className="row" style={{ marginBottom: 10 }}><b>{open.length} open · {done.length} closed</b><span className="sp" style={{ flex: 1 }} /><button className="btn pri" onClick={() => setNw(true)} disabled={!first}>+ Start a case</button></div>
    {cases.length ? <div className="sheet"><table className="wrap"><thead><tr><th>Case</th><th>Now at</th><th>Time</th><th /></tr></thead><tbody>{[...open, ...done].map(c => <Row_ key={c.id} c={c} />)}</tbody></table></div> : <Empty>No cases yet. A case is one run of this process, for example one plan, one report or one hire.</Empty>}
    {nw && <Modal title={'Start: ' + def.name} onClose={() => setNw(false)}><label className="f">What is this case? (e.g. “FY2026/27 annual plan — HR”)<input autoFocus value={title} onChange={e => setTitle(e.target.value)} /></label><label className="f">Reference (optional)<input value={ref} onChange={e => setRef(e.target.value)} /></label><div className="row" style={{ marginTop: 12 }}><button className="btn pri" disabled={!title.trim()} onClick={start}>Start</button></div></Modal>}
    {show && <Modal title={show.title} onClose={() => setShow(null)} wide><div className="sheet"><table className="wrap"><thead><tr><th>When</th><th>Step</th><th>Action</th><th>Moved to</th><th>By</th></tr></thead><tbody>{lg.map(l => <tr key={l.id}><td>{new Date(l.at).toLocaleString()}</td><td>{l.step_no}</td><td>{l.action}</td><td>{l.to_no || '—'}</td><td>{l.by_name || '—'}</td></tr>)}</tbody></table></div>
      {show.status === 'open' && <div className="row" style={{ marginTop: 10 }}><input placeholder="Add a note" value={note} onChange={e => setNote(e.target.value)} /><button className="btn sm" disabled={!note.trim()} onClick={async () => { await save(() => sb.from('process_case_log').insert(log(show, 'note', null, note.trim())), ['process_case_log']); setNote(''); }}>Add</button></div>}</Modal>}
  </div>;
}

/* ---------- Page ---------- */
export default function Processes() {
  const { db, unit, role, me, units } = useData(); const save = useSave();
  const [sel, setSel] = useState<string | null>(null); const [tab, setTab] = useState<'flow' | 'steps' | 'kpis' | 'cases'>('flow'); const [nw, setNw] = useState(false); const [nm, setNm] = useState('');
  const gso = db?.org_units.find(o => o.code === 'group-strategy-office')?.id;
  const canEdit = EDIT_ROLES.includes(role);
  const mine = useMemo(() => (db?.process_defs || []).filter(d => d.unit_id === unit && d.status !== 'archived').sort((a, b) => (a.sort || 0) - (b.sort || 0)), [db, unit]);
  const tmpl = useMemo(() => unit === gso ? [] : (db?.process_defs || []).filter(d => d.unit_id === gso && d.status !== 'archived').sort((a, b) => (a.sort || 0) - (b.sort || 0)), [db, unit, gso]);
  if (!db || !unit) return null;
  const def = [...mine, ...tmpl].find(d => d.id === sel) || mine[0] || tmpl[0] || null;
  const isTemplate = !!def && def.unit_id !== unit;
  const steps = def ? db.process_steps.filter(s => s.process_id === def.id).sort((a, b) => num(a.no, b.no)) : [];
  const orderedSteps = def ? db.process_steps.filter(s => s.process_id === def.id).sort((a, b) => (a.sort || 0) - (b.sort || 0)) : [];
  const kpis = def ? db.process_kpis.filter(k => k.process_id === def.id) : [];
  const cases = def && !isTemplate ? db.process_cases.filter(c => c.process_id === def.id && c.unit_id === unit).sort((a, b) => b.started_at.localeCompare(a.started_at)) : [];
  const unitName = units.find(u => u.id === unit)?.name || '';

  const copy = async (d: Row) => {
    const ok = await save(async () => { const r = await sb.from('process_defs').insert({ unit_id: unit, code: d.code, name: d.name, kind: d.kind, objective: d.objective, owner_title: d.owner_title, source: 'Copied from ' + (d.source || 'template'), copied_from: d.id, sort: (mine.length + 1) * 10 }).select().single();
      if (r.error) return r;
      const st = db.process_steps.filter(s => s.process_id === d.id).map(({ id, process_id, ...s }) => ({ ...s, process_id: r.data.id }));
      const kp = db.process_kpis.filter(k => k.process_id === d.id).map(({ id, process_id, ...k }) => ({ ...k, process_id: r.data.id }));
      const a = st.length ? await sb.from('process_steps').insert(st) : { error: null }; if (a.error) return a;
      return kp.length ? await sb.from('process_kpis').insert(kp) : { error: null }; }, ['process_defs', 'process_steps', 'process_kpis'], 'Copied to ' + unitName + ' — edit it to match how your unit works');
    if (ok) setSel(null);
  };
  const create = async () => { if (!nm.trim()) return;
    const ok = await save(async () => { const r = await sb.from('process_defs').insert({ unit_id: unit, name: nm.trim(), kind: 'operational', owner_title: me?.title, sort: (mine.length + 1) * 10 }).select().single(); if (r.error) return r;
      return await sb.from('process_steps').insert({ process_id: r.data.id, no: '1', name: 'First step', actor: '', sort: 0 }); }, ['process_defs', 'process_steps'], 'Process created');
    if (ok) { setNw(false); setNm(''); setSel(null); setTab('steps'); } };
  const archive = (d: Row) => confirm(`Remove “${d.name}” from ${unitName}?`) && save(() => sb.from('process_defs').update({ status: 'archived' }).eq('id', d.id), ['process_defs']);
  const noTables = !db.process_defs.length && !db.process_steps.length;

  return <>
    <Page title="Processes" desc={`How ${unitName || 'your unit'} gets work done — each unit follows its own process map.`} help={<><p>A <b>process</b> is a list of steps with who does each one. Some steps are <b>decisions</b> (approve / return) that send the work forward or back.</p><p>Corporate Planning's seven process maps are shown as <b>templates</b>. Press <b>Use for my unit</b> to copy one, then change the steps to match how your unit works. You can also create your own, such as hiring or procurement.</p><p>To track real work, open a process and <b>Start a case</b> (one plan, one report, one hire). Move it with Done / Yes / No. The app records who did what and how many days each step took.</p></>}>
      <Cmd right={canEdit ? <button className="btn" onClick={() => setNw(true)}>+ New process</button> : undefined} />
      {noTables ? <div className="card"><Empty>No processes found. The process tables may not be set up in the database yet.</Empty></div> : <div className="procgrid" style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,280px) 1fr', gap: 16, alignItems: 'start' }}>
        <div className="card" style={{ padding: 10 }}>
          <div className="navl">{unitName}</div>
          {mine.length ? mine.map(d => <button key={d.id} className={'mod' + (def?.id === d.id ? ' on' : '')} style={{ width: '100%', textAlign: 'left' }} onClick={() => setSel(d.id)}><span>{d.name}</span>{db.process_cases.filter(c => c.process_id === d.id && c.status === 'open').length ? <i className="cnt">{db.process_cases.filter(c => c.process_id === d.id && c.status === 'open').length}</i> : null}</button>) : <p className="note" style={{ padding: '4px 8px' }}>No process yet. Copy a template below or create one.</p>}
          {tmpl.length > 0 && <><div className="navl" style={{ marginTop: 12 }}>Corporate Planning templates</div>{tmpl.map(d => <button key={d.id} className={'mod' + (def?.id === d.id ? ' on' : '')} style={{ width: '100%', textAlign: 'left' }} onClick={() => setSel(d.id)}><span>{d.name}</span></button>)}</>}
        </div>
        <div>{!def ? <div className="card"><Empty>Choose a process.</Empty></div> : <>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="row"><div style={{ flex: 1 }}><h2 style={{ margin: 0 }}>{def.name} {isTemplate && <Pill tone="warn">Template</Pill>}</h2>{def.objective && <p className="note" style={{ margin: '6px 0 0' }}>{def.objective}</p>}<p className="note" style={{ margin: '4px 0 0' }}>{steps.length} steps{def.owner_title ? ' · owner: ' + def.owner_title : ''}{def.source ? ' · ' + def.source : ''}</p></div>
              {isTemplate && canEdit && <button className="btn pri" onClick={() => copy(def)}>Use for my unit</button>}
              {!isTemplate && canEdit && <button className="btn xs danger" onClick={() => archive(def)}>Remove</button>}</div>
          </div>
          <div className="viewsw"><Seg value={tab} options={[['flow', 'Flow'], ['steps', 'Steps'], ['kpis', 'Indicators'], ...(isTemplate ? [] : [['cases', `Cases (${cases.filter(c => c.status === 'open').length})`] as [string, string]])] as [any, string][]} onChange={setTab} /></div>
          {tab === 'flow' && <div className="card"><Flow steps={orderedSteps} /><p className="note">Green = yes, red dashed = no / return. Gates are the rounded decision boxes.</p></div>}
          {tab === 'steps' && <StepsEditor def={def} steps={orderedSteps} canEdit={canEdit && !isTemplate} />}
          {tab === 'kpis' && <Kpis def={def} kpis={kpis} canEdit={canEdit && !isTemplate} cases={cases} />}
          {tab === 'cases' && !isTemplate && <Cases def={def} steps={orderedSteps} cases={cases} unit={unit} />}
        </>}</div>
      </div>}
      {nw && <Modal title="New process" onClose={() => setNw(false)}><label className="f">Process name (e.g. “Hiring”, “Procurement”)<input autoFocus value={nm} onChange={e => setNm(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} /></label><p className="note">It starts with one step. Add the rest on the Steps tab.</p><div className="row" style={{ marginTop: 12 }}><button className="btn pri" disabled={!nm.trim()} onClick={create}>Create</button></div></Modal>}
    </Page>
    <style>{`@media(max-width:900px){.procgrid{grid-template-columns:1fr!important}}`}</style>
  </>;
}
