/* WORK WINDOW — How we cascade: for the person's own organisational structure, how the objectives cascade
   from the pillar and strategic goal down through unit, department and division to their own deliverables.
   My insights: the performance that concerns the person — their organisation, their own result and work, and (for heads) their team. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData, useTerms, byId, posName, type DB, type Row } from '../../lib/data';
import { objScore, objState, krsOf, krState, childObjectives, liveObj, currentPeriod, periodLabel, pct, fmt, orgScoreOwn, orgScore, MONTHS, curMonth, qOfMonth, qMonths, personResult, bandOf, workStats, weekStart, ymd, weekLabel, delivScore, subtreeIds, ownShare, krDrivers, type Period } from '../../lib/calc';
import { UnitPicker, HowItWorks, Ring, Bar, StatePill, Empty, StatusStack, Seg, LineChart, BarChart, PeriodPicker, usePeriod, Pill } from '../../lib/ui';
import { unitGoalsTree, goalScore, pillarScore, statusCounts, unitKrs, IdentityModal } from '../Goals';
import { isHead, headedOrgs } from './Plan';
import { teamOf } from '../Work';

const LEVEL: Record<string, string> = { unit: 'Unit', department: 'Department', division: 'Division' };
/** Objectives that deliver an objective: cascaded to it directly or to one of its key results. */
function kidsOf(db: DB, o: Row) { const ks = new Set(krsOf(db, o.id, true).map(k => k.id)); return db.objectives.filter(c => c.level !== 'individual' && liveObj(c) && (c.parent_objective_id === o.id || (c.parent_kr_id && ks.has(c.parent_kr_id)))); }

export function OurStrategy() {
  const { db, me, role, unit: selUnit } = useData(); const { t } = useTerms(); const [p, setP] = usePeriod(); const [scope, setScope] = useState<'mine' | 'unit'>('mine'); const [open, setOpen] = useState<Set<string>>(new Set());
  const rel = useMemo(() => { if (!db || !me) return { chain: new Set<string>(), below: new Set<string>() };
    const chain = new Set<string>(); let o = byId(db.org_units, me.org_unit_id); while (o && o.kind !== 'group') { chain.add(o.id); o = byId(db.org_units, o.parent_id); }
    return { chain, below: isHead(role) ? headedOrgs(db, me, role) : new Set<string>([me.org_unit_id]) }; }, [db, me, role]);
  if (!db || !me) return null;
  // group-level people (CEO, Group Strategy) have no unit cascade of their own: follow the unit chosen at the top
  const atGroup = byId(db.org_units, me.unit_id)?.kind === 'group' || !db.unit_pillars.some(x => x.unit_id === me.unit_id) && !db.objectives.some(o => o.unit_id === me.unit_id);
  const uid = atGroup && selUnit ? selUnit : me.unit_id; const viewUnit = atGroup && uid !== me.unit_id;
  const myOrg = viewUnit ? byId(db.org_units, uid) : byId(db.org_units, me.org_unit_id);
  // an objective is on "my" cascade when it belongs to my organisation, one above it, or (for heads) one below; a branch shows when anything on it is mine
  const onPath = (o: Row): boolean => scope === 'unit' || viewUnit || rel.chain.has(o.org_unit_id) || rel.below.has(o.org_unit_id);
  const relevant = (o: Row, d = 0): boolean => d < 8 && (rel.below.has(o.org_unit_id) || o.org_unit_id === me.org_unit_id || kidsOf(db, o).some(c => relevant(c, d + 1)));
  const show = (o: Row) => scope === 'unit' || viewUnit || relevant(o);
  const tree = unitGoalsTree(db, uid).map(({ p: pil, goals }) => ({ pil, goals: goals.map(g => ({ g, objs: db.objectives.filter(o => o.unit_goal_id === g.id && o.level !== 'individual' && liveObj(o)).filter(show) })).filter(x => x.objs.length) })).filter(x => x.goals.length);
  const loose = db.objectives.filter(o => o.unit_id === uid && o.level !== 'individual' && liveObj(o) && !o.unit_goal_id && !o.parent_objective_id && !o.parent_kr_id).filter(show);
  const toggle = (id: string) => setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const q = qOfMonth(curMonth());
  const myDels = (o: Row) => { const ks = new Set(krsOf(db, o.id).map(k => k.id)); return db.deliverables.filter(d => d.owner_position_id === me.id && d.status !== 'removed' && qMonths(q).includes(d.month) && (d.objective_id === o.id || ks.has(d.key_result_id))); };
  const Obj = ({ o, depth }: { o: Row; depth: number }) => {
    const org = byId(db.org_units, o.org_unit_id); const sc = objScore(db, o, p); const st = objState(db, o, p); const kids = kidsOf(db, o).filter(show); const ks = krsOf(db, o.id);
    const mine = o.org_unit_id === me.org_unit_id; const isOpen = open.has(o.id) || mine; const dels = mine ? myDels(o) : [];
    return <div className={'cnode' + (mine ? ' mine' : '') + (onPath(o) ? '' : ' faint')}>
      <div className="chead" onClick={() => toggle(o.id)}><Ring p={sc} size={38} />
        <span style={{ flex: 1 }}><small>{LEVEL[org?.kind || ''] || 'Organisation'} · {org?.name}{mine ? ' · my organisation' : ''}</small><b>{o.text}</b>
          <span className="mini">{ks.length} {t('key_result', true).toLowerCase()}{o.weight_to_parent != null && depth > 0 ? ` · ${fmt(Number(o.weight_to_parent))}% of the ${t('objective').toLowerCase()} above` : ''}{ks.length && kids.length ? ` · score = ${ownShare(db, o)}% own ${t('key_result', true).toLowerCase()} + ${100 - ownShare(db, o)}% below` : ''} · owned by {posName(db, o.owner_position_id)}</span></span>
        <StatePill s={st} /><span className="mini">{isOpen ? '▾' : '▸'}</span></div>
      {isOpen && ks.length > 0 && <div className="ckrs">{ks.map(k => { const s = krState(db, k, p); return <div key={k.id} className="krline"><span style={{ flex: 1 }}>{k.title}<div className="mini">{fmt(s.actual, 1)} of {fmt(s.target, 1)} {k.uom || ''} · weight {fmt(Number(k.weight) || 0)}%{(() => { const d = krDrivers(db, k.id); return d.acts.length ? ` · ${d.dels.length} deliverables · ${d.done}/${d.acts.length} weekly tasks done` : ''; })()}</div></span><Bar p={s.progress} /><StatePill s={s} /></div>; })}</div>}
      {mine && <div className="cme"><small>My {t('deliverable', true).toLowerCase()} for this {t('objective').toLowerCase()} · Q{q}</small>{dels.length ? dels.map(d => <div key={d.id} className="krline"><span style={{ flex: 1 }}>{d.title}<div className="mini">{MONTHS[d.month - 1]}{d.weight != null ? ` · ${d.weight}%` : ''}</div></span><Pill tone={d.status === 'accepted' ? 'good' : d.status === 'done' ? 'warn' : d.status === 'returned' ? 'bad' : 'none'}>{d.status}</Pill></div>) : <span className="mini">None yet — <Link to="/plan?tab=deliverables">plan or propose them</Link>.</span>}</div>}
      {kids.length > 0 && <div className="ckids">{kids.map(c => <Obj key={c.id} o={c} depth={depth + 1} />)}</div>}
    </div>;
  };
  return <div className="light wide">
    <div className="lhead"><div><h1>How we cascade</h1><p>From the pillar and strategic goal down to {myOrg?.name} and your own {t('deliverable', true).toLowerCase()}: each level's {t('objective', true).toLowerCase()} deliver the one above, and their scores roll up.<HowItWorks><h3>What this page is for</h3><p>How your work connects to the strategy: <b>pillar → strategic goal → unit objective → department → division → your deliverables</b>. Each objective shows its key results and, under each key result, the deliverables and weekly activities that drive it.</p><p>Use <b>My structure</b> for the chain you belong to, or <b>Whole unit</b> to see every department. Scores are for the current quarter.</p></HowItWorks></p></div>
      <div className="row">{atGroup ? <UnitPicker /> : <Seg value={scope} options={[['mine', 'My structure'], ['unit', 'Whole unit']]} onChange={setScope} />}<PeriodPicker value={p} onChange={setP} /></div></div>
    <div className="clegend"><span><b>Pillar</b> → <b>strategic goal</b> → <b>unit</b> {t('objective', true).toLowerCase()} → <b>department</b> → <b>division</b> → <b>you</b></span><span className="mini">Click an {t('objective').toLowerCase()} to open its {t('key_result', true).toLowerCase()}. Your organisation is highlighted. The ring is the score for {periodLabel(p)}.</span></div>
    {!tree.length && !loose.length ? <Empty>No cascade for {myOrg?.name} yet — it has no {t('objective', true).toLowerCase()} linked to a strategic goal. {isHead(role) ? 'Link them in Studio → Objective planner.' : 'Your manager links them when planning.'}</Empty> :
      tree.map(({ pil, goals }) => <section key={pil.id} className="cpil">
        <div className="cpilh"><Ring p={pillarScore(db, pil.id, p)} size={34} /><span><small>{t('pillar')}</small><b>{pil.code} · {pil.name}</b></span></div>
        {goals.map(({ g, objs }) => <div key={g.id} className="cgoal"><div className="cgoalh"><Ring p={goalScore(db, g.id, p)} size={30} /><span><small>{t('goal')}</small><b>{g.code} {g.name}</b></span></div>
          <div className="ckids">{objs.map(o => <Obj key={o.id} o={o} depth={0} />)}</div></div>)}
      </section>)}
    {loose.length > 0 && <section className="cpil"><div className="cpilh"><span><small>Not linked yet</small><b>{loose.length} {t('objective', true).toLowerCase()} not yet linked to a strategic goal or to an {t('objective').toLowerCase()} above</b></span></div>
      <p className="note" style={{ margin: '4px 0 8px' }}>{isHead(role) ? 'Link each one in Studio → Objective planner (edit the objective, choose the goal or the objective it delivers).' : 'Your manager links these when planning.'}</p>
      <div className="ckids">{loose.map(o => <Obj key={o.id} o={o} depth={0} />)}</div></section>}
  </div>;
}

/** The strategic plan everyone can read — the whole of it: the Group's vision, mission, values, all pillars and goals, and the unit's own plan. */
export function StrategicPlan() {
  const { db, me, can, unit: selUnit } = useData(); const { t } = useTerms(); const [p, setP] = usePeriod(); const [view, setView] = useState<'group' | 'unit'>(() => new URLSearchParams(location.search).get('view') === 'unit' ? 'unit' : 'group'); const [ed, setEd] = useState(false); if (!db || !me) return null;
  const uid = can('seeGroup') && selUnit ? selUnit : me.unit_id;
  const group = db.org_units.find(x => x.kind === 'group'); const unit = byId(db.org_units, uid);
  const gst = db.strategy_statements.find(s => s.unit_id === group?.id); const ust = db.strategy_statements.find(s => s.unit_id === uid);
  const tree = unitGoalsTree(db, uid); const served = new Set(db.unit_goals.filter(g => g.unit_id === uid).map(g => g.group_goal_id));
  const krs = unitKrs(db, uid); const nObj = db.objectives.filter(o => o.unit_id === uid && o.status !== 'Archived' && o.level !== 'individual').length;
  const Ident = ({ st, who }: { st: Row | undefined; who: string }) => <>
    <div className="ident"><div className="lcard"><h4>{who} vision</h4><div className="big">{st?.vision || '—'}</div></div><div className="lcard"><h4>{who} mission</h4><div>{st?.mission || '—'}</div></div></div>
    <div className="lcard" style={{ marginTop: 10 }}><h4>Core values</h4>{(st?.values || []).length ? <div className="vals">{st!.values.map((v: Row) => <div key={v.name}><b>{v.name}</b>{v.text && <span className="note">{v.text}</span>}</div>)}</div> : <p className="note">Not entered yet — Studio → Strategy builder → Edit vision, mission and values.</p>}</div></>;
  return <div className="light wide">
    <div className="lhead"><div><h1>Strategic plan</h1><p>{view === 'group' ? `Wagwago Business Group${gst?.period ? ' · ' + gst.period : ''}` : `${unit?.name}${ust?.period ? ' · ' + ust.period : ''}`} — where we are going.<HowItWorks><h3>What this page is for</h3><p>The whole strategic plan: the <b>Group</b> vision, mission and core values, all its <b>pillars</b> and <b>strategic goals</b>; and your unit's own plan, with the Group goals each unit goal serves. Goals your unit serves are marked. Every objective in the app delivers one of these goals. Group Strategy maintains it in Studio → Strategy builder.</p></HowItWorks></p></div>
      <div className="row">{view === 'unit' && <UnitPicker />}<Seg value={view} options={[['group', 'Group strategic plan'], ['unit', can('seeGroup') ? 'Unit plan' : unit?.name || 'Our unit']]} onChange={setView} /><PeriodPicker value={p} onChange={setP} /></div></div>
    {view === 'group' ? <>
      <Ident st={gst} who="Group" />
      <section className="lsec"><h3>{db.group_pillars.length} {t('pillar', true).toLowerCase()} and {db.group_goals.length} {t('goal', true).toLowerCase()}</h3>
        <div className="pilgrid">{db.group_pillars.slice().sort((a, b) => a.sort - b.sort).map(pil => <div key={pil.id} className="pilcard"><div className="ph"><b>{pil.code} · {pil.name}</b></div>{pil.description && <div className="note">{pil.description}</div>}
          {db.group_goals.filter(g => g.pillar_id === pil.id).sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true })).map(g => { const units = db.unit_goals.filter(u => u.group_goal_id === g.id).map(u => byId(db.org_units, u.unit_id)?.name).filter(Boolean);
            return <div key={g.id} className="lg row"><span style={{ flex: 1 }}>{g.code} {g.name}{units.length > 0 && <div className="mini">served by {Array.from(new Set(units)).join(', ')}</div>}</span>{served.has(g.id) && <Pill tone="good">we serve this</Pill>}</div>; })}</div>)}</div></section></>
    : <>
      <Ident st={ust || gst} who={ust ? (unit?.name || 'Unit') : 'Group'} />
      {!ust && <p className="note">{unit?.name} uses the Group vision and mission{unit?.unit_type === 'function' ? ' — it is a corporate function working to the Group strategy' : ''}.</p>}
      {can('editPlan') && <div className="row" style={{ marginTop: 8 }}><button className="btn sm" onClick={() => setEd(true)}>{ust ? 'Edit vision, mission and values' : 'Add a unit vision, mission and values'}</button></div>}
      <div className="kpis" style={{ marginTop: 14 }}>
        <div className="tile"><div className="tv">{tree.length}</div><div className="tl">{t('pillar', true)}</div></div>
        <div className="tile"><div className="tv">{tree.reduce((a, x) => a + x.goals.length, 0)}</div><div className="tl">{t('goal', true)}</div></div>
        <div className="tile"><div className="tv">{nObj}</div><div className="tl">{t('objective', true)}</div><div className="ts">{krs.length} {t('key_result', true).toLowerCase()}</div></div>
        <div className="tile"><div className="row"><Ring p={orgScore(db, uid, p)} size={46} /><div className="tl">{periodLabel(p)} score</div></div></div>
        <div className="tile" style={{ gridColumn: 'span 2' }}><div className="tl" style={{ marginBottom: 6 }}>{t('key_result', true)} — {periodLabel(p)}</div><StatusStack counts={statusCounts(db, krs, p)} /></div>
      </div>
      {ed && <IdentityModal unit={uid} onClose={() => setEd(false)} />}
      <section className="lsec"><h3>{unit?.name} {t('pillar', true).toLowerCase()} and {t('goal', true).toLowerCase()} · progress {periodLabel(p)}</h3>
        {tree.length ? <div className="pilgrid">{tree.map(({ p: pil, goals }) => <div key={pil.id} className="pilcard"><div className="ph"><Ring p={pillarScore(db, pil.id, p)} size={38} /><b>{pil.code} · {pil.name}</b></div>{pil.description && pil.description !== 'Group pillar' && <div className="note">{pil.description}</div>}
          {goals.map(g => { const gg = byId(db.group_goals, g.group_goal_id); return <div key={g.id} className="lg row"><span style={{ flex: 1 }}>{g.code} {g.name}{g.weight != null && <span className="mini"> · {fmt(Number(g.weight))}% of the pillar</span>}{gg && <div className="mini">serves Group {gg.code} {gg.name}</div>}{g.description && <div className="mini">{g.description}</div>}</span><span className="mini">{pct(goalScore(db, g.id, p))}</span></div>; })}</div>)}</div>
          : <p className="note">{unit?.name} has no pillars or goals of its own yet; its work serves the Group goals directly.</p>}</section></>}
    <p className="note">How your organisation's {t('objective', true).toLowerCase()} deliver these goals: <Link to="/strategy">Work → How we cascade</Link>.</p>
  </div>;
}

/** Insights for everyone, about what concerns them. */
export function MyInsights() {
  const { db, me, role } = useData(); const { t } = useTerms(); const [p, setP] = usePeriod(); if (!db || !me) return null;
  const head = isHead(role); const org = byId(db.org_units, me.org_unit_id); const months = Array.from({ length: curMonth() }, (_, i) => i + 1);
  const r = personResult(db, me, p);
  const orgObjs = db.objectives.filter(o => o.org_unit_id === me.org_unit_id && o.level !== 'individual' && liveObj(o)); const orgKrs = orgObjs.flatMap(o => krsOf(db, o.id));
  const orgQ = [1, 2, 3, 4].map(n => orgScoreOwn(db, me.org_unit_id, { t: 'Q', n }) ?? orgScore(db, me.org_unit_id, { t: 'Q', n }));
  const myTrend = months.map(m => personResult(db, me, { t: 'M', n: m }).R);
  const weeks = Array.from({ length: 8 }, (_, i) => new Date(weekStart(new Date()).getTime() - (7 - i) * 7 * 864e5));
  const myWeeks = weeks.map(w => workStats(db, new Set([me.id]), ymd(w)).completion);
  const team = head ? teamOf(db, me, ['unit_head', 'planning_head', 'super_admin', 'group_strategy', 'executive'].includes(role)).filter(x => x.id !== me.id && x.holder_name) : db.positions.filter(x => x.org_unit_id === me.org_unit_id && x.holder_name && x.id !== me.id);
  const teamIds = new Set(team.map(x => x.id)); const teamWeeks = weeks.map(w => workStats(db, teamIds, ymd(w)).completion);
  const myDel = months.map(m => delivScore(db, new Set([me.id]), { t: 'M', n: m }));
  const sub = head ? Array.from(subtreeIds(db, me.org_unit_id)).filter(id => id !== me.org_unit_id).map(id => byId(db.org_units, id)!).filter(Boolean) : [];
  return <div className="light wide">
    <div className="lhead"><div><h1>My insights</h1><p>How {org?.name}, {head ? 'your team' : 'your colleagues'} and you are doing.<HowItWorks><h3>What this page is for</h3><p>How your organisation, your team and you are doing this period: the organisation's score and key results, deliverables accepted, the week's work done, and your own result. It is read-only — change plans in Work → Plan and record progress in Work → Record.</p></HowItWorks></p></div><PeriodPicker value={p} onChange={setP} /></div>
    <div className="tiles3">
      <Link to="/me" className="ltile"><small>My result · {periodLabel(p)}</small><b>{pct(r.R)} · {bandOf(r.R, db)}</b><Bar p={r.R} /><span>{r.s ? `${Math.round(r.s * 100)}% ${r.orgLabel.split(' · ')[0].toLowerCase()} + ${Math.round((1 - r.s) * 100)}% my work` : 'From my own work'}</span></Link>
      <Link to="/strategy" className="ltile"><small>{org?.name} · {periodLabel(p)}</small><b>{pct(orgScoreOwn(db, me.org_unit_id, p) ?? orgScore(db, me.org_unit_id, p))} of targets</b><StatusStack counts={statusCounts(db, orgKrs, p)} compact /><span>See the cascade →</span></Link>
      <Link to="/record?tab=week" className="ltile"><small>My week</small><b>{pct(myWeeks[myWeeks.length - 1])} done</b><Bar p={myWeeks[myWeeks.length - 1]} /><span>{head ? 'Team' : 'Colleagues'}: {pct(teamWeeks[teamWeeks.length - 1])}</span></Link>
    </div>
    <div className="g2" style={{ marginTop: 12 }}>
      <div className="lcard"><h4>My result by month</h4><LineChart labels={MONTHS.slice(0, months.length)} series={[{ name: 'My result', values: myTrend.map(v => v == null ? null : v * 100), color: 'var(--accent)' }]} fmtY={v => Math.round(v) + '%'} height={160} /></div>
      <div className="lcard"><h4>{org?.name} score by quarter</h4><BarChart labels={['Q1', 'Q2', 'Q3', 'Q4']} series={[{ name: 'Score', values: orgQ.map(v => v == null ? null : v * 100), color: 'var(--accent)' }]} fmtY={v => Math.round(v) + '%'} height={160} /></div>
      <div className="lcard"><h4>Weekly work done — last 8 weeks</h4><LineChart labels={weeks.map(w => weekLabel(w))} series={[{ name: 'Me', values: myWeeks.map(v => v == null ? null : v * 100), color: 'var(--accent)' }, { name: head ? 'My team' : 'My colleagues', values: teamWeeks.map(v => v == null ? null : v * 100), color: 'var(--good)', dashed: true }]} fmtY={v => Math.round(v) + '%'} height={160} /></div>
      <div className="lcard"><h4>My {t('deliverable', true).toLowerCase()} by month</h4><BarChart labels={MONTHS.slice(0, months.length)} series={[{ name: 'Due', values: myDel.map(d => d.due), color: 'var(--line2)' }, { name: 'Accepted', values: myDel.map(d => d.accepted), color: 'var(--good)' }]} height={160} /></div>
    </div>
    <section className="lsec"><h3>{org?.name} {t('key_result', true).toLowerCase()} · {periodLabel(p)}</h3><div className="lcard">
      {orgKrs.length ? orgKrs.map(k => { const s = krState(db, k, p); return <div key={k.id} className="krline"><span style={{ flex: 1 }}>{k.title}<div className="mini">{fmt(s.actual, 1)} of {fmt(s.target, 1)} {k.uom || ''} · {posName(db, k.owner_position_id)}</div></span><Bar p={s.progress} /><StatePill s={s} /></div>; })
        : <p className="note">{org?.name} has no {t('key_result', true).toLowerCase()} of its own; it works to the level above.</p>}</div></section>
    {sub.length > 0 && <section className="lsec"><h3>Below {org?.name}</h3><div className="lcard">{sub.map(o => { const sc = orgScoreOwn(db, o.id, p); const ks = db.objectives.filter(x => x.org_unit_id === o.id && x.level !== 'individual' && liveObj(x)).flatMap(x => krsOf(db, x.id));
      return <div key={o.id} className="krline"><span style={{ flex: 1 }}><b>{o.name}</b><div className="mini">{LEVEL[o.kind]}</div></span><span style={{ width: 220 }}><StatusStack counts={statusCounts(db, ks, p)} compact /></span><Bar p={sc} /><span className="mini">{pct(sc)}</span></div>; })}</div></section>}
    {head && team.length > 0 && <section className="lsec"><h3>My team · {periodLabel(p)}</h3><div className="lcard">{team.map(x => { const rr = personResult(db, x, p); const w = workStats(db, new Set([x.id]), ymd(weekStart(new Date())));
      return <div key={x.id} className="krline"><span style={{ flex: 1 }}><b>{x.holder_name}</b><div className="mini">{x.title} · this week {w.total ? `${w.done}/${w.total} done` : 'no plan'}</div></span><Bar p={rr.R} /><span className="mini">{pct(rr.R)} · {bandOf(rr.R, db)}</span></div>; })}</div></section>}
  </div>;
}
export type { Period };
