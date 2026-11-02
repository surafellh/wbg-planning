/* WORK WINDOW — How we cascade: for the person's own organisational structure, how the objectives cascade
   from the pillar and strategic goal down through unit, department and division to their own deliverables.
   My insights: the performance that concerns the person — their organisation, their own result and work, and (for heads) their team. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData, useTerms, byId, posName, type DB, type Row } from '../../lib/data';
import { objScore, objState, krsOf, krState, childObjectives, liveObj, currentPeriod, periodLabel, pct, fmt, orgScoreOwn, orgScore, MONTHS, curMonth, qOfMonth, qMonths, personResult, bandOf, workStats, weekStart, ymd, weekLabel, delivScore, subtreeIds, ownShare, type Period } from '../../lib/calc';
import { Ring, Bar, StatePill, Empty, StatusStack, Seg, LineChart, BarChart, PeriodPicker, usePeriod, Pill } from '../../lib/ui';
import { unitGoalsTree, goalScore, pillarScore, statusCounts } from '../Goals';
import { isHead, headedOrgs } from './Plan';
import { teamOf } from '../Work';

const LEVEL: Record<string, string> = { unit: 'Unit', department: 'Department', division: 'Division' };
/** Objectives that deliver an objective: cascaded to it directly or to one of its key results. */
function kidsOf(db: DB, o: Row) { const ks = new Set(krsOf(db, o.id, true).map(k => k.id)); return db.objectives.filter(c => c.level !== 'individual' && liveObj(c) && (c.parent_objective_id === o.id || (c.parent_kr_id && ks.has(c.parent_kr_id)))); }

export function OurStrategy() {
  const { db, me, role } = useData(); const { t } = useTerms(); const [p, setP] = usePeriod(); const [scope, setScope] = useState<'mine' | 'unit'>('mine'); const [open, setOpen] = useState<Set<string>>(new Set());
  const rel = useMemo(() => { if (!db || !me) return { chain: new Set<string>(), below: new Set<string>() };
    const chain = new Set<string>(); let o = byId(db.org_units, me.org_unit_id); while (o && o.kind !== 'group') { chain.add(o.id); o = byId(db.org_units, o.parent_id); }
    return { chain, below: isHead(role) ? headedOrgs(db, me, role) : new Set<string>([me.org_unit_id]) }; }, [db, me, role]);
  if (!db || !me) return null;
  const myOrg = byId(db.org_units, me.org_unit_id);
  // an objective is on "my" cascade when it belongs to my organisation, one above it, or (for heads) one below; a branch shows when anything on it is mine
  const onPath = (o: Row): boolean => scope === 'unit' || rel.chain.has(o.org_unit_id) || rel.below.has(o.org_unit_id);
  const relevant = (o: Row, d = 0): boolean => d < 8 && (rel.below.has(o.org_unit_id) || o.org_unit_id === me.org_unit_id || kidsOf(db, o).some(c => relevant(c, d + 1)));
  const show = (o: Row) => scope === 'unit' || relevant(o);
  const tree = unitGoalsTree(db, me.unit_id).map(({ p: pil, goals }) => ({ pil, goals: goals.map(g => ({ g, objs: db.objectives.filter(o => o.unit_goal_id === g.id && o.level !== 'individual' && liveObj(o)).filter(show) })).filter(x => x.objs.length) })).filter(x => x.goals.length);
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
      {isOpen && ks.length > 0 && <div className="ckrs">{ks.map(k => { const s = krState(db, k, p); return <div key={k.id} className="krline"><span style={{ flex: 1 }}>{k.title}<div className="mini">{fmt(s.actual, 1)} of {fmt(s.target, 1)} {k.uom || ''} · weight {fmt(Number(k.weight) || 0)}%</div></span><Bar p={s.progress} /><StatePill s={s} /></div>; })}</div>}
      {mine && <div className="cme"><small>My {t('deliverable', true).toLowerCase()} for this {t('objective').toLowerCase()} · Q{q}</small>{dels.length ? dels.map(d => <div key={d.id} className="krline"><span style={{ flex: 1 }}>{d.title}<div className="mini">{MONTHS[d.month - 1]}{d.weight != null ? ` · ${d.weight}%` : ''}</div></span><Pill tone={d.status === 'accepted' ? 'good' : d.status === 'done' ? 'warn' : d.status === 'returned' ? 'bad' : 'none'}>{d.status}</Pill></div>) : <span className="mini">None yet — <Link to="/plan?tab=deliverables">plan or propose them</Link>.</span>}</div>}
      {kids.length > 0 && <div className="ckids">{kids.map(c => <Obj key={c.id} o={c} depth={depth + 1} />)}</div>}
    </div>;
  };
  return <div className="light wide">
    <div className="lhead"><div><h1>How we cascade</h1><p>From the pillar and strategic goal down to {myOrg?.name} and your own {t('deliverable', true).toLowerCase()}: each level's {t('objective', true).toLowerCase()} deliver the one above, and their scores roll up.</p></div>
      <div className="row"><Seg value={scope} options={[['mine', 'My structure'], ['unit', 'Whole unit']]} onChange={setScope} /><PeriodPicker value={p} onChange={setP} /></div></div>
    <div className="clegend"><span><b>Pillar</b> → <b>strategic goal</b> → <b>unit</b> {t('objective', true).toLowerCase()} → <b>department</b> → <b>division</b> → <b>you</b></span><span className="mini">Click an {t('objective').toLowerCase()} to open its {t('key_result', true).toLowerCase()}. Your organisation is highlighted. The ring is the score for {periodLabel(p)}.</span></div>
    {!tree.length ? <Empty>No cascade for {myOrg?.name} yet — its {t('objective', true).toLowerCase()} are not linked to a strategic goal. {isHead(role) ? 'Link them in Studio → Objective planner.' : 'Your manager links them when planning.'}</Empty> :
      tree.map(({ pil, goals }) => <section key={pil.id} className="cpil">
        <div className="cpilh"><Ring p={pillarScore(db, pil.id, p)} size={34} /><span><small>{t('pillar')}</small><b>{pil.code} · {pil.name}</b></span></div>
        {goals.map(({ g, objs }) => <div key={g.id} className="cgoal"><div className="cgoalh"><Ring p={goalScore(db, g.id, p)} size={30} /><span><small>{t('goal')}</small><b>{g.code} {g.name}</b></span></div>
          <div className="ckids">{objs.map(o => <Obj key={o.id} o={o} depth={0} />)}</div></div>)}
      </section>)}
  </div>;
}

/** The strategic plan everyone can read: vision, mission, values, the unit's pillars and strategic goals (with the Group's above them). */
export function StrategicPlan() {
  const { db, me } = useData(); const { t } = useTerms(); const [p, setP] = usePeriod(); if (!db || !me) return null;
  const group = db.org_units.find(x => x.kind === 'group'); const unit = byId(db.org_units, me.unit_id);
  const st = db.strategy_statements.find(s => s.unit_id === me.unit_id) || db.strategy_statements.find(s => s.unit_id === group?.id);
  const gst = db.strategy_statements.find(s => s.unit_id === group?.id);
  const tree = unitGoalsTree(db, me.unit_id);
  return <div className="light wide">
    <div className="lhead"><div><h1>Strategic plan</h1><p>{unit?.name}{st?.period ? ` · ${st.period}` : ''} — where we are going.</p></div><PeriodPicker value={p} onChange={setP} /></div>
    <div className="ident"><div className="lcard"><h4>Vision</h4><div className="big">{st?.vision || '—'}</div></div><div className="lcard"><h4>Mission</h4><div>{st?.mission || '—'}</div></div></div>
    {(st?.values || []).length > 0 && <div className="lcard" style={{ marginTop: 10 }}><h4>Our values</h4><div className="vals">{st!.values.map((v: Row) => <div key={v.name}><b>{v.name}</b>{v.text && <span className="note">{v.text}</span>}</div>)}</div></div>}
    {gst && st !== gst && <div className="lcard" style={{ marginTop: 10 }}><h4>Group vision</h4><div>{gst.vision}</div></div>}
    <section className="lsec"><h3>{unit?.name} {t('pillar', true).toLowerCase()} and {t('goal', true).toLowerCase()} · progress {periodLabel(p)}</h3>
      {tree.length ? <div className="pilgrid">{tree.map(({ p: pil, goals }) => <div key={pil.id} className="pilcard"><div className="ph"><Ring p={pillarScore(db, pil.id, p)} size={38} /><b>{pil.code} · {pil.name}</b></div>{pil.description && <div className="note">{pil.description}</div>}
        {goals.map(g => { const gg = byId(db.group_goals, g.group_goal_id); return <div key={g.id} className="lg row"><span style={{ flex: 1 }}>{g.code} {g.name}{gg && <div className="mini">serves Group {gg.code} {gg.name}</div>}{g.description && <div className="mini">{g.description}</div>}</span><span className="mini">{pct(goalScore(db, g.id, p))}</span></div>; })}</div>)}</div>
        : <div className="pilgrid">{db.group_pillars.slice().sort((a, b) => a.sort - b.sort).map(pil => <div key={pil.id} className="pilcard"><div className="ph"><b>{pil.code} · {pil.name}</b></div>{pil.description && <div className="note">{pil.description}</div>}
          {db.group_goals.filter(g => g.pillar_id === pil.id).sort((a, b) => a.sort - b.sort).map(g => <div key={g.id} className="lg row"><span style={{ flex: 1 }}>{g.code} {g.name}</span></div>)}</div>)}</div>}</section>
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
    <div className="lhead"><div><h1>My insights</h1><p>How {org?.name}, {head ? 'your team' : 'your colleagues'} and you are doing.</p></div><PeriodPicker value={p} onChange={setP} /></div>
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
