/* INSIGHTS WINDOW — the full picture for leaders: overview, alignment / cascade, who is doing what. */
import { useState } from 'react';
import { useData, useTerms, byId, posName, type DB, type Row } from '../../lib/data';
import { objScore, objState, krsOf, krState, orgScore, subtreeIds, periodLabel, pct, curMonth, MONTHS, weekStart, ymd, delivScore, avg, personResult, type Period } from '../../lib/calc';
import { Page, Cmd, UnitPicker, Ring, Bar, Pill, PeriodPicker, usePeriod, Drawer, StatePill, Seg, StatusStack, Empty } from '../../lib/ui';
import { unitGoalsTree, goalScore, pillarScore, statusCounts, unitKrs, KrDrawer } from '../Goals';
import { GroupBoard, Operational, Financial } from '../Home';
import { PersonDrawer } from '../Performance';
import { Thread } from '../../lib/social';

export function Overview() {
  const { db, unit, can, units, allUnits } = useData(); const [p, setP] = usePeriod(); if (!db || !unit) return null; const u = byId(db.org_units, unit)!; const all = can('seeGroup') && allUnits;
  return <Page title="Overview" desc={all ? 'Operational and financial performance across all units.' : `${u.name}: operational and financial performance.`} help={<>
    <h3>OKR score</h3><p>The average score of a unit's own objectives for the period chosen. Each objective's score is the weighted progress of its key results against the period target, blended (by its "own share") with the weighted score of the department and division objectives below it. So the unit score reflects the whole cascade, organisation first.</p>
    <h3>Key results</h3><p>All organisation key results — unit, department and division — with their status judged on pace: early in a quarter, less is expected. "Updated" shows how many check-in key results were updated in the last 30 days.</p>
    <h3>Financial performance</h3><p>Pick one unit, all combined, or compare units; months or quarters; and the metric (revenue, gross profit, margin, opex, EBITDA, operating profit, net income, cash). Plan comes from the annual plan; actuals from Finance; cash actuals from the weekly tracker's bank positions.</p></>}>
    <div className="cmdbar"><UnitPicker allowAll /><span className="sp" /><PeriodPicker value={p} onChange={setP} /></div>
    {all && <GroupBoard db={db} p={p} />}
    {!all && <Operational db={db} unit={unit} p={p} />}
    <div style={{ marginTop: 12 }}><Financial db={db} units={all ? units.map(x => x.id) : [unit]} label={all ? 'All units combined' : u.name} /></div>
  </Page>;
}

/* ---------- Alignment: how the strategy cascades, who owns each piece, how much each contributes ---------- */
function ObjNode({ o, p, depth, show, onPick, parentW }: { o: Row; p: Period; depth: number; show: (o: Row) => boolean; onPick: (o: Row) => void; parentW?: number }) {
  const { db } = useData(); const [open, setOpen] = useState(depth < 1); if (!db) return null;
  const kids = db.objectives.filter(c => c.parent_objective_id === o.id || (c.parent_kr_id && krsOf(db, o.id).some(k => k.id === c.parent_kr_id))).filter(show);
  const sc = objScore(db, o, p); const st = objState(db, o, p);
  const lvl = o.level === 'individual' ? 'Person' : o.level === 'unit' ? 'Unit' : o.level === 'department' ? 'Dept' : 'Div';
  return <div className="tnode">
    <div className="trow" onClick={() => onPick(o)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onPick(o); }}>
      {kids.length ? <button className="tog" onClick={e => { e.stopPropagation(); setOpen(!open); }} aria-label={open ? 'Collapse' : 'Expand'}>{open ? '−' : '+'}</button> : <span className="tog none" />}
      <Ring p={sc} size={30} /><span className={'lvlb ' + o.level}>{lvl}</span>
      <span className="tt">{o.text}<small>{posName(db, o.owner_position_id)} · {byId(db.org_units, o.org_unit_id)?.name}{o.weight_to_parent != null && depth > 0 ? ` · contributes ${Math.round(Number(o.weight_to_parent))}%${parentW != null && sc != null ? ` → ${pct(Number(o.weight_to_parent) / 100 * Math.min(1, sc))} of parent` : ''}` : ''}</small></span>
      <StatePill s={st} />{kids.length > 0 && <span className="mini">{kids.length} below</span>}
    </div>
    {open && kids.length > 0 && <div className="tkids">{kids.map(c => <ObjNode key={c.id} o={c} p={p} depth={depth + 1} show={show} onPick={onPick} parentW={1} />)}</div>}
  </div>;
}
function ObjDrawer({ o, p, onClose }: { o: Row; p: Period; onClose: () => void }) {
  const { db } = useData(); const { t } = useTerms(); const [kr, setKr] = useState<string | null>(null); if (!db) return null;
  const chain: string[] = []; let cur: Row | undefined = o; let guard = 0;
  while (cur && guard < 8) { const par: Row | undefined = byId(db.objectives, cur.parent_objective_id) || byId(db.objectives, byId(db.key_results, cur.parent_kr_id)?.objective_id); if (par) chain.unshift(par.text); else { const g = byId(db.unit_goals, cur.unit_goal_id); if (g) { chain.unshift(`${t('goal')}: ${g.name}`); const pil = byId(db.unit_pillars, g.pillar_id); if (pil) chain.unshift(`${t('pillar')}: ${pil.name}`); } } cur = par; guard++; }
  return <Drawer title={t('objective')} onClose={onClose}>
    <b style={{ fontSize: 16 }}>{o.text}</b>
    <div className="crumbs">{chain.map((c, i) => <span key={i}>{c}</span>)}<span><b>this</b></span></div>
    <div className="g3"><div className="tile"><div className="tv">{pct(objScore(db, o, p))}</div><div className="tl">{periodLabel(p)} score</div></div><div className="tile"><div className="tv">{krsOf(db, o.id).length}</div><div className="tl">{t('key_result', true)}</div></div><div className="tile"><div className="tv">{o.status}</div><div className="tl">{posName(db, o.owner_position_id)}</div></div></div>
    <div>{krsOf(db, o.id).map(k => { const s = krState(db, k, p); return <div key={k.id} className="lg row click" onClick={() => setKr(k.id)}><span style={{ flex: 1 }}>{k.title}<div className="mini">{posName(db, k.owner_position_id)} · weight {Math.round(Number(k.weight) || 0)}%</div></span><Bar p={s.progress} /><StatePill s={s} /></div>; })}</div>
    <div><h4>Comments</h4><Thread entity="objective" id={o.id} link="/insights/alignment" title={o.text} /></div>
    {kr && <KrDrawer id={kr} p={p} onClose={() => setKr(null)} />}
  </Drawer>;
}
export function Alignment() {
  const { db, unit } = useData(); const { t } = useTerms(); const [p, setP] = usePeriod(); const [ind, setInd] = useState<'org' | 'all'>('org'); const [q, setQ] = useState(''); const [pick, setPick] = useState<Row | null>(null);
  if (!db || !unit) return null;
  const show = (o: Row) => ind === 'all' || o.level !== 'individual';
  const match = (o: Row) => !q || o.text.toLowerCase().includes(q.toLowerCase()) || posName(db, o.owner_position_id).toLowerCase().includes(q.toLowerCase());
  const tree = unitGoalsTree(db, unit); const objs = db.objectives.filter(o => o.unit_id === unit && o.status !== 'Archived');
  const linked = objs.filter(o => o.unit_goal_id || o.parent_objective_id || o.parent_kr_id).length;
  const loose = objs.filter(o => !o.unit_goal_id && !o.parent_objective_id && !o.parent_kr_id && show(o));
  const ppl = new Set(objs.map(o => o.owner_position_id)).size;
  return <Page title="Alignment" desc={`How the strategy cascades: ${t('pillar', true).toLowerCase()} → ${t('goal', true).toLowerCase()} → unit, department, division and personal ${t('objective', true).toLowerCase()} — who owns each one and how much it contributes.`} help={<><p>Each row is an {t('objective').toLowerCase()} with its score for the period, owner and status. "Contributes x%" is its cascade weight in the {t('objective').toLowerCase()} above. Click any row for the chain up to the strategy, its {t('key_result', true).toLowerCase()} and comments.</p><p>Switch on "Include personal" to see individual {t('objective', true).toLowerCase()} under the team ones they support.</p></>}>
    <Cmd right={<><input type="text" placeholder="Find an objective or person" value={q} onChange={e => setQ(e.target.value)} /><Seg value={ind} options={[['org', 'Organisation only'], ['all', 'Include personal']]} onChange={setInd} /><PeriodPicker value={p} onChange={setP} /></>} />
    <div className="kpis"><div className="tile"><div className="tv">{objs.length}</div><div className="tl">{t('objective', true)}</div></div><div className="tile"><div className="tv">{pct(objs.length ? linked / objs.length : null)}</div><div className="tl">Linked to the strategy</div></div><div className="tile"><div className="tv">{ppl}</div><div className="tl">People owning {t('objective', true).toLowerCase()}</div></div><div className="tile" style={{ gridColumn: 'span 2' }}><div className="tl" style={{ marginBottom: 6 }}>{t('key_result', true)} · {periodLabel(p)}</div><StatusStack counts={statusCounts(db, unitKrs(db, unit), p)} compact /></div></div>
    {tree.map(({ p: pil, goals }) => <section key={pil.id} className="tpil"><div className="tpilh"><Ring p={pillarScore(db, pil.id, p)} size={34} /><b>{pil.code} · {pil.name}</b></div>
      {goals.map(g => { const os = db.objectives.filter(o => o.unit_goal_id === g.id && show(o)).filter(o => match(o) || db.objectives.some(c => c.parent_objective_id === o.id && match(c)));
        return <div key={g.id} className="tgoal"><div className="tgoalh"><Ring p={goalScore(db, g.id, p)} size={28} /><span>{g.code} {g.name}</span>{byId(db.group_goals, g.group_goal_id) && <small>↗ {byId(db.group_goals, g.group_goal_id)?.name}</small>}</div>
          {os.map(o => <ObjNode key={o.id} o={o} p={p} depth={0} show={show} onPick={setPick} />)}{!os.length && <p className="note" style={{ marginLeft: 36 }}>Nothing cascades from this {t('goal').toLowerCase()} yet.</p>}</div>; })}</section>)}
    {loose.length > 0 && <section className="tpil"><div className="tpilh warn"><b>Not linked to the strategy · {loose.length}</b></div>{loose.filter(match).map(o => <ObjNode key={o.id} o={o} p={p} depth={0} show={show} onPick={setPick} />)}</section>}
    {pick && <ObjDrawer o={pick} p={p} onClose={() => setPick(null)} />}
  </Page>;
}

/* ---------- Who is doing what ---------- */
export function WhoDoesWhat() {
  const { db, unit } = useData(); const { t } = useTerms(); const [p, setP] = usePeriod(); const [org, setOrg] = useState(''); const [pick, setPick] = useState<Row | null>(null); const [sort, setSort] = useState<'name' | 'load' | 'result'>('load');
  if (!db || !unit) return null;
  const ids = subtreeIds(db, org || unit); const wk = ymd(weekStart(new Date()));
  const rows = db.positions.filter(x => ids.has(x.org_unit_id) && x.holder_name).map(x => {
    const objs = db.objectives.filter(o => o.owner_position_id === x.id); const krs = db.key_results.filter(k => k.owner_position_id === x.id);
    const dels = db.deliverables.filter(d => d.owner_position_id === x.id && d.month === curMonth() && d.status !== 'removed'); const acts = db.activities.filter(a => a.owner_position_id === x.id && a.week_start === wk);
    const r = personResult(db, x, p);
    return { x, objs: objs.length, krs: krs.length, krOff: krs.filter(k => krState(db, k, p).tone === 'bad').length, dels: dels.length, delAcc: dels.filter(d => d.status === 'accepted').length, acts: acts.length, done: acts.filter(a => a.status === 'Done').length, stuck: acts.filter(a => a.status === 'Stuck').length, load: objs.length * 3 + krs.length * 2 + dels.length * 2 + acts.length, R: r.R };
  }).sort((a, b) => sort === 'name' ? (a.x.holder_name || '').localeCompare(b.x.holder_name || '') : sort === 'load' ? b.load - a.load : (b.R ?? -1) - (a.R ?? -1));
  const orgs = Array.from(subtreeIds(db, unit)).map(id => byId(db.org_units, id)!).filter(u => u.kind !== 'unit');
  const maxLoad = Math.max(1, ...rows.map(r => r.load));
  return <Page title="Who is doing what" desc={`Each person's ${t('objective', true).toLowerCase()}, ${t('key_result', true).toLowerCase()}, this month's ${t('deliverable', true).toLowerCase()} and this week's activities — spot overload and idle capacity.`} help={<p>Load is a simple indicator: objectives ×3, key results ×2, deliverables this month ×2, activities this week ×1. Click a person for their full picture.</p>}>
    <Cmd right={<><select value={org} onChange={e => setOrg(e.target.value)} aria-label="Department"><option value="">Whole unit</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select><Seg value={sort} options={[['load', 'By load'], ['result', 'By result'], ['name', 'By name']]} onChange={setSort} /><PeriodPicker value={p} onChange={setP} /></>} />
    {!rows.length ? <Empty>No people here.</Empty> : <div className="tw"><table className="t"><thead><tr><th>Person</th><th className="n">{t('objective', true)}</th><th className="n">{t('key_result', true)}</th><th className="n">Off track</th><th className="n">{MONTHS[curMonth() - 1]} {t('deliverable', true).toLowerCase()}</th><th className="n">This week</th><th className="n">Stuck</th><th>Load</th><th>Result</th></tr></thead><tbody>
      {rows.map(r => <tr key={r.x.id} className="click" onClick={() => setPick(r.x)}><td><b>{r.x.holder_name}</b><div className="mini">{r.x.title}</div></td><td className="n">{r.objs || ''}</td><td className="n">{r.krs || ''}</td><td className="n">{r.krOff ? <Pill tone="bad">{r.krOff}</Pill> : ''}</td><td className="n">{r.dels ? `${r.delAcc}/${r.dels}` : ''}</td><td className="n">{r.acts ? `${r.done}/${r.acts}` : <span className="note">none</span>}</td><td className="n">{r.stuck || ''}</td>
        <td><div className="loadbar"><i style={{ width: (r.load / maxLoad * 100) + '%' }} /></div></td><td><Bar p={r.R} /> {pct(r.R)}</td></tr>)}
    </tbody></table></div>}
    {pick && <PersonDrawer pos={pick} p={p} onClose={() => setPick(null)} />}
  </Page>;
}
export type { DB };
