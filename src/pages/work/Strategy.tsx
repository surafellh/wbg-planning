/* WORK WINDOW — Our strategy: everyone sees the vision, mission, pillars and goals, how their own work flows
   into the strategy (like streams into a river and the sea), and how their department is doing. */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData, useTerms, byId, posName, type Row } from '../../lib/data';
import { objScore, objState, krsOf, krState, chainUp, currentPeriod, periodLabel, pct, fmt, orgScore, MONTHS, curMonth } from '../../lib/calc';
import { Ring, Bar, StatePill, Empty, StatusStack } from '../../lib/ui';
import { unitGoalsTree, goalScore, pillarScore, statusCounts } from '../Goals';
import { myOrgs } from './Plan';

export function OurStrategy() {
  const { db, me } = useData(); const { t } = useTerms(); const [sp] = useSearchParams(); const p = currentPeriod('Q');
  const objs = useMemo(() => db && me ? db.objectives.filter(o => myOrgs(db, me, false).has(o.org_unit_id) && o.level !== 'individual' && o.status !== 'Archived') : [], [db, me]);
  const focus0 = sp.get('o'); const [sel, setSel] = useState<string>(focus0 || '');
  if (!db || !me) return null;
  const unit = me.unit_id; const group = db.org_units.find(x => x.kind === 'group');
  const st = db.strategy_statements.find(s => s.unit_id === unit) || db.strategy_statements.find(s => s.unit_id === group?.id);
  const tree = unitGoalsTree(db, unit);
  const myOrg = byId(db.org_units, me.org_unit_id);
  const ordered = objs.slice().sort((a, b) => (a.org_unit_id === me.org_unit_id ? -1 : 0) - (b.org_unit_id === me.org_unit_id ? -1 : 0));
  const cur = byId(db.objectives, sel) || ordered[0];
  const chain = cur ? chainUp(db, cur) : [];
  const myDels = cur ? db.deliverables.filter(d => d.owner_position_id === me.id && d.status !== 'removed' && (d.objective_id === cur.id || krsOf(db, cur.id).some(k => k.id === d.key_result_id))) : [];
  const deptKrs = objs.filter(o => o.org_unit_id === me.org_unit_id).flatMap(o => krsOf(db, o.id));
  return <div className="light">
    <div className="lhead"><div><h1>Our strategy</h1><p>Where we are going, and how your work gets us there.</p></div></div>
    <div className="ident"><div className="lcard"><h4>Vision</h4><div className="big">{st?.vision || '—'}</div></div><div className="lcard"><h4>Mission</h4><div>{st?.mission || '—'}</div></div></div>
    {(st?.values || []).length > 0 && <div className="lcard" style={{ marginTop: 10 }}><h4>Our values</h4><div className="vals">{st!.values.map((v: Row) => <div key={v.name}><b>{v.name}</b>{v.text && <span className="note">{v.text}</span>}</div>)}</div></div>}

    <section className="lsec"><h3>How my work flows into the strategy</h3>
      {!cur ? <Empty>Your organisation has no {t('objective', true).toLowerCase()} yet.</Empty> : <div className="lcard">
        {ordered.length > 1 && <label className="f" style={{ maxWidth: 520, marginBottom: 10 }}>Follow the {t('objective').toLowerCase()}<select value={cur.id} onChange={e => setSel(e.target.value)}>{ordered.map(o => <option key={o.id} value={o.id}>{o.text.slice(0, 90)} — {byId(db.org_units, o.org_unit_id)?.name}</option>)}</select></label>}
        <div className="river">
          <div className="rnode" style={{ maxWidth: 520, width: '70%' }}><span style={{ flex: 1 }}><small>My {t('deliverable', true).toLowerCase()}</small>{myDels.length ? `${myDels.length} this year · ${myDels.filter(d => d.status === 'accepted').length} accepted` : 'None linked yet — your manager plans them with you'}{myDels.filter(d => d.month === curMonth()).slice(0, 3).map(d => <div key={d.id} className="mini">• {d.title} ({MONTHS[d.month - 1]})</div>)}</span></div>
          {chain.map((c, i) => { const o = c.kind === 'objective' ? byId(db.objectives, c.id) : null; const sc = o ? objScore(db, o, p) : c.kind === 'goal' ? goalScore(db, c.id, p) : c.kind === 'pillar' ? pillarScore(db, c.id, p) : null; const w = 74 + i * (26 / Math.max(1, chain.length));
            return <div key={c.id + i} style={{ display: 'contents' }}><div className="rflow" style={{ width: 4 + i * 2 }} /><div className="rnode" style={{ maxWidth: 760, width: Math.min(100, w) + '%' }}>{sc !== undefined && <Ring p={sc ?? null} size={36} />}
              <span style={{ flex: 1 }}><small>{c.kind === 'objective' ? `${t('objective')} · ${byId(db.org_units, o?.org_unit_id)?.name}` : c.kind === 'goal' ? t('goal') : c.kind === 'pillar' ? t('pillar') : 'Group goal'}</small>{c.label}
                {o && <div className="mini">{krsOf(db, o.id).length} {t('key_result', true).toLowerCase()} · owned by {posName(db, o.owner_position_id)}</div>}</span>{o && <StatePill s={objState(db, o, p)} />}</div></div>; })}
          <div className="rflow" style={{ width: 4 + chain.length * 2 + 2 }} /><div className="rnode sea" style={{ width: '100%' }}><span><small>Vision</small>{st?.vision}</span></div>
        </div></div>}
    </section>

    <section className="lsec"><h3>How {myOrg?.name} is doing · {periodLabel(p)}</h3>
      <div className="lcard"><div className="row" style={{ gap: 14 }}><Ring p={orgScore(db, me.org_unit_id, p)} size={56} /><div style={{ flex: 1 }}><b>{pct(orgScore(db, me.org_unit_id, p))} of the quarter's targets reached</b><div className="mini">Average of {myOrg?.name}'s {t('objective', true).toLowerCase()}; status is judged on pace through the quarter.</div></div><div style={{ width: 260 }}><StatusStack counts={statusCounts(db, deptKrs, p)} compact /></div></div>
        <div style={{ marginTop: 10 }}>{deptKrs.map(k => { const s = krState(db, k, p); return <div key={k.id} className="krline"><span style={{ flex: 1 }}>{k.title}<div className="mini">{fmt(s.actual, 1)} of {fmt(s.target, 1)} {k.uom || ''}</div></span><Bar p={s.progress} /><StatePill s={s} /></div>; })}
          {!deptKrs.length && <p className="note">{myOrg?.name} has no {t('key_result', true).toLowerCase()} of its own; it works to the level above.</p>}</div></div></section>

    <section className="lsec"><h3>Our {t('pillar', true).toLowerCase()} and {t('goal', true).toLowerCase()}</h3>
      {!tree.length && <div className="pilgrid">{db.group_pillars.slice().sort((a, b) => a.sort - b.sort).map(pil => <div key={pil.id} className="pilcard"><div className="ph"><b>{pil.code} · {pil.name}</b></div>{pil.description && <div className="note">{pil.description}</div>}
        {db.group_goals.filter(g => g.pillar_id === pil.id).sort((a, b) => a.sort - b.sort).map(g => <div key={g.id} className="lg row"><span style={{ flex: 1 }}>{g.code} {g.name}</span></div>)}</div>)}</div>}
      <div className="pilgrid">{tree.map(({ p: pil, goals }) => <div key={pil.id} className="pilcard"><div className="ph"><Ring p={pillarScore(db, pil.id, p)} size={38} /><b>{pil.code} · {pil.name}</b></div>{pil.description && <div className="note">{pil.description}</div>}
        {goals.map(g => <div key={g.id} className="lg row"><span style={{ flex: 1 }}>{g.code} {g.name}{g.description && <div className="mini">{g.description}</div>}</span><span className="mini">{pct(goalScore(db, g.id, p))}</span></div>)}</div>)}</div></section>
  </div>;
}
