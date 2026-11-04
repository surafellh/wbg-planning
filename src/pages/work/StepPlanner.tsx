/* WORK WINDOW — Plan → Weekly activities, by deliverable: each deliverable of the month at the top, the steps that deliver it
   underneath, and the weeks of the month across. A step can run over several weeks (one weekly activity per week, same step). */
import { useState } from 'react';
import { useData, useSave, useTerms, byId, posName, type Row } from '../../lib/data';
import { sb } from '../../lib/supabase';
import { MONTHS, ymd, weekStart, weekLabel } from '../../lib/calc';
import { Pill, Empty } from '../../lib/ui';
import { weeksOfMonth } from './Plan';

const TONE: Record<string, string> = { Done: 'good', 'In progress': 'warn', Stuck: 'bad' };
const MARK: Record<string, string> = { Done: '✓', 'In progress': '◐', Stuck: '!', 'Not started': '●' };

export function StepPlanner({ people, m, canEditFor }: { people: Row[]; m: number; canEditFor: (owner: string) => boolean }) {
  const { db, me, user } = useData(); const save = useSave(); const { t } = useTerms(); const [adding, setAdding] = useState<string | null>(null);
  if (!db || !me) return null;
  const weeks = weeksOfMonth(m); const wkeys = weeks.map(w => ymd(w)); const thisWk = ymd(weekStart(new Date()));
  const ids = new Set(people.map(p => p.id));
  const dels = db.deliverables.filter(d => ids.has(d.owner_position_id) && d.month === m && d.status !== 'removed').sort((a, b) => posName(db, a.owner_position_id).localeCompare(posName(db, b.owner_position_id)) || (a.due_date || '').localeCompare(b.due_date || ''));
  const acts = db.activities.filter(a => ids.has(a.owner_position_id) && wkeys.includes(a.week_start));
  const stepsOf = (delId: string | null, owner?: string) => {
    const rows = acts.filter(a => (a.deliverable_id || null) === delId && (!owner || a.owner_position_id === owner)); const map = new Map<string, Row[]>();
    rows.forEach(a => { const k = a.step_id || a.id; map.set(k, [...(map.get(k) || []), a]); });
    return Array.from(map.entries()).map(([k, rs]) => ({ k, rows: rs, title: rs.slice().sort((a, b) => a.week_start.localeCompare(b.week_start))[0].title, order: Math.min(...rs.map(r => r.step_order ?? 99 + wkeys.indexOf(r.week_start))), owner: rs[0].owner_position_id }))
      .sort((a, b) => a.order - b.order || a.rows[0].week_start.localeCompare(b.rows[0].week_start));
  };
  const phaseTag = (d: Row) => { const ph = d.phase_id && byId(db.project_phases, d.phase_id); if (!ph) return null; const pr = ph.pmo_project_id ? byId(db.pmo_projects, ph.pmo_project_id) : byId(db.projects, ph.project_id); return <Pill tone="info">{pr?.name ? pr.name + ' · ' : ''}{ph.name}</Pill>; };
  async function addWeek(st: { k: string; rows: Row[]; title: string; owner: string }, wk: string, d: Row | null) {
    const base = st.rows[0]; const sid = base.step_id || base.id;
    await save(async () => {
      if (!base.step_id) { const r = await sb.from('activities').update({ step_id: sid }).eq('id', base.id); if (r.error) return r; }
      return sb.from('activities').insert({ unit_id: base.unit_id || me!.unit_id, owner_position_id: st.owner, deliverable_id: d?.id || null, key_result_id: d?.key_result_id || base.key_result_id || null, phase_id: d?.phase_id || base.phase_id || null,
        week_start: wk, title: st.title, kind: base.kind || 'Task', category: base.category || null, priority: base.priority ?? 2, status: 'Not started', pct: 0, step_id: sid, step_order: base.step_order ?? null, created_by: user.id, planned_by: user.id });
    }, ['activities'], `${st.title} — added to ${weekLabel(new Date(wk + 'T00:00:00Z'))}`);
  }
  async function dropWeek(a: Row) {
    if (a.status !== 'Not started' || a.locked) return;
    await save(() => sb.from('activities').delete().eq('id', a.id), ['activities'], 'Removed from that week');
  }
  async function rename(st: { rows: Row[]; title: string }, title: string) {
    if (!title.trim() || title === st.title) return;
    await save(() => sb.from('activities').update({ title: title.trim() }).in('id', st.rows.map(r => r.id)), ['activities'], 'Step renamed');
  }
  async function move(list: { k: string; rows: Row[] }[], i: number, dir: -1 | 1) {
    const j = i + dir; if (j < 0 || j >= list.length) return; const order = list.map(s => s.k); [order[i], order[j]] = [order[j], order[i]];
    await save(async () => { for (let n = 0; n < order.length; n++) { const st = list.find(s => s.k === order[n])!; const r = await sb.from('activities').update({ step_order: n + 1, step_id: st.rows[0].step_id || st.rows[0].id }).in('id', st.rows.map(x => x.id)); if (r.error) return r; } return { error: null }; }, ['activities']);
  }
  async function addStep(d: Row | null, owner: string, title: string, picks: string[], order: number) {
    const sid = crypto.randomUUID();
    await save(() => sb.from('activities').insert(picks.map(wk => ({ unit_id: d?.unit_id || me!.unit_id, owner_position_id: owner, deliverable_id: d?.id || null, key_result_id: d?.key_result_id || null, phase_id: d?.phase_id || null,
      week_start: wk, title: title.trim(), kind: 'Task', priority: 2, status: 'Not started', pct: 0, step_id: sid, step_order: order, created_by: user.id, planned_by: user.id }))), ['activities'], `Step added over ${picks.length} week${picks.length > 1 ? 's' : ''}`);
    setAdding(null);
  }
  const Grid = ({ d, owner }: { d: Row | null; owner: string }) => {
    const list = stepsOf(d?.id || null, d ? undefined : owner); const ed = canEditFor(owner); const key = (d?.id || 'none') + owner;
    return <table className="stepgrid"><thead><tr><th className="first">Step</th>{weeks.map((w, i) => <th key={i} className={'wk' + (ymd(w) === thisWk ? ' now' : '')}>W{i + 1}<div className="mini">{weekLabel(w).replace(/^.*?·\s*/, '')}</div></th>)}{ed && <th />}</tr></thead><tbody>
      {list.map((st, i) => <tr key={st.k}><td className="first">{ed ? <input className="stepin" defaultValue={st.title} onBlur={e => rename(st, e.target.value)} /> : st.title}</td>
        {wkeys.map(wk => { const a = st.rows.find(r => r.week_start === wk); const past = wk < thisWk;
          return <td key={wk} className={'wcell' + (a ? ' on ' + (TONE[a.status] || '') : '') + (past ? ' past' : '')} data-tip={a ? `${a.status}${a.pct ? ' · ' + a.pct + '%' : ''}${a.blocker ? ' · ' + a.blocker : ''}${a.status === 'Not started' && !a.locked && ed ? ' — click to remove from this week' : ''}` : ed && !past ? 'Click to plan this step in this week' : undefined}
            onClick={() => { if (!ed) return; if (a) dropWeek(a); else if (!past) addWeek(st, wk, d); }}>{a ? <span>{MARK[a.status] || '●'}{a.status === 'In progress' && a.pct ? <small> {a.pct}%</small> : null}</span> : ''}</td>; })}
        {ed && <td className="nowrap"><button className="btn xs" disabled={i === 0} onClick={() => move(list, i, -1)} data-tip="Earlier in the sequence">↑</button><button className="btn xs" disabled={i === list.length - 1} onClick={() => move(list, i, 1)} data-tip="Later in the sequence">↓</button></td>}</tr>)}
      {!list.length && <tr><td colSpan={weeks.length + 2} className="note">No steps yet.{ed ? ' Add the first step below.' : ''}</td></tr>}
      {ed && (adding === key ? <NewStep weeks={wkeys} labels={weeks.map((w, i) => `W${i + 1}`)} thisWk={thisWk} onCancel={() => setAdding(null)} onAdd={(title, picks) => addStep(d, owner, title, picks, list.length + 1)} cols={weeks.length + 2} />
        : <tr><td colSpan={weeks.length + 2}><button className="btn sm" onClick={() => setAdding(key)}>+ Step</button></td></tr>)}
    </tbody></table>;
  };
  const loose = people.filter(p => acts.some(a => a.owner_position_id === p.id && !a.deliverable_id));
  return <div className="stack">
    <p className="note">Each {t('deliverable').toLowerCase()} of {MONTHS[m - 1]} with the steps that deliver it. Click a week to plan a step in it — a step can run over several weeks. Use ↑ ↓ to put the steps in order. ● planned · ◐ in progress · ✓ done · ! stuck. Progress is still updated in Record → This week.</p>
    {!dels.length && <Empty>No {t('deliverable', true).toLowerCase()} for {MONTHS[m - 1]} yet — plan them first in Plan → {t('deliverable', true)}.</Empty>}
    {dels.map(d => { const k = byId(db.key_results, d.key_result_id); const n = acts.filter(a => a.deliverable_id === d.id); return <div key={d.id} className="card stepcard">
      <div className="row" style={{ alignItems: 'flex-start' }}><div style={{ flex: 1 }}><b>{d.title}</b><div className="mini">{k ? k.title : 'Not linked to a key result'}{people.length > 1 ? ' · ' + posName(db, d.owner_position_id) : ''}{d.due_date ? ' · due ' + d.due_date : ''}{d.weight != null ? ` · ${d.weight}%` : ''}</div></div>{phaseTag(d)}
        <span className="mini">{n.filter(a => a.status === 'Done').length}/{n.length} done</span><Pill tone={d.status === 'accepted' ? 'good' : d.status === 'done' ? 'warn' : d.status === 'returned' ? 'bad' : 'none'}>{d.status === 'done' ? 'Submitted' : d.status === 'accepted' ? 'Accepted' : d.status === 'returned' ? 'Returned' : 'Planned'}</Pill></div>
      <Grid d={d} owner={d.owner_position_id} /></div>; })}
    {loose.map(p => <div key={p.id} className="card stepcard"><div><b>Other activities{people.length > 1 ? ' · ' + (p.holder_name || p.title) : ''}</b><div className="mini">Not linked to a {t('deliverable').toLowerCase()}</div></div><Grid d={null} owner={p.id} /></div>)}
  </div>;
}

function NewStep({ weeks, labels, thisWk, onAdd, onCancel, cols }: { weeks: string[]; labels: string[]; thisWk: string; onAdd: (title: string, picks: string[]) => void; onCancel: () => void; cols: number }) {
  const first = weeks.find(w => w >= thisWk) || weeks[0]; const [title, setTitle] = useState(''); const [picks, setPicks] = useState<string[]>([first]);
  return <tr className="newstep"><td className="first"><input autoFocus className="stepin" placeholder="What will be done, e.g. Collect unit reports" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && title.trim() && picks.length) onAdd(title, picks); if (e.key === 'Escape') onCancel(); }} /></td>
    {weeks.map((w, i) => { const on = picks.includes(w); return <td key={w} className={'wcell pick' + (on ? ' on' : '')} onClick={() => setPicks(on ? picks.filter(x => x !== w) : [...picks, w].sort())} data-tip={'Plan in ' + labels[i]}>{on ? '●' : ''}</td>; })}
    <td className="nowrap"><button className="btn xs pri" disabled={!title.trim() || !picks.length} onClick={() => onAdd(title, picks)}>Add</button><button className="btn xs" onClick={onCancel}>×</button></td>
    {cols > weeks.length + 2 ? <td /> : null}</tr>;
}
