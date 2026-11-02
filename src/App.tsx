import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { sb } from './lib/supabase';
import { DataProvider, ROLE_NAME, useData, useTerms, useWindows, moduleOn } from './lib/data';
import { weekStart } from './lib/calc';
import { Seg } from './lib/ui';
import { Bell } from './lib/social';
import Login from './pages/Login';
import { ClaimScreen } from './pages/Claim';
import { GoalsMap, GoalsQuarter, GroupView, StrategyOverview } from './pages/Goals';
import OkrPlan from './pages/OkrPlan';
import { RevenuePlan, BudgetPlan } from './pages/AnnualPlan';
import { PlanCalendar, Resources, Rescope } from './pages/Resources';
import { teamOf } from './pages/Work';
import { PerfOrg, PerfPeople } from './pages/Performance';
import Reports from './pages/Reports';
import { SettingsPeople, SettingsImport } from './pages/Settings';
import { NewObjective } from './pages/work/MyGoals';
import { InboxPage, Me, Today } from './pages/work/Inbox';
import { PlanPage } from './pages/work/Plan';
import { RecordPage } from './pages/work/Record';
import { OurStrategy, MyInsights } from './pages/work/Strategy';
import { RescopeEditor, ResourcesMonthly, Portfolio, Backup, ErpReplan } from './pages/studio/More';
import { Search } from './lib/search';
import { Overview, Alignment, WhoDoesWhat } from './pages/insights/Insights';
import { Monitor, StrategyBuilder, Scorecards, Framework, Audit } from './pages/studio/Studio';

type Win = 'work' | 'insights' | 'studio';
type Item = { to: string; label: string; icon: string; badge?: number };
const I: Record<string, string> = {
  today: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', week: 'M4 5h16v15H4zM4 9h16M9 3v4M15 3v4', goals: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zm0 4a5 5 0 1 0 0 10a5 5 0 1 0 0-10zm0 3a2 2 0 1 0 0 4a2 2 0 1 0 0-4z',
  deliv: 'M5 12l4 4L19 6', inbox: 'M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z', me: 'M12 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6',
  overview: 'M4 20V10M10 20V4M16 20v-7M22 20H2', strategy: 'M12 2l3 6 6 .9-4.5 4.3 1 6.3L12 16.6 6.5 19.5l1-6.3L3 8.9 9 8z', align: 'M6 4v16M6 8h8M6 14h12M14 8v0M18 14v0',
  people: 'M8 11a3 3 0 1 0 0-6a3 3 0 0 0 0 6zm8 0a3 3 0 1 0 0-6a3 3 0 0 0 0 6zM2 20c0-3 3-5 6-5s6 2 6 5M12 20c0-3 2-5 4-5s6 2 6 5', perf: 'M3 3v18h18M7 14l4-4 4 4 5-6',
  reports: 'M5 3h10l4 4v14H5zM8 12h8M8 16h8M8 8h4', monitor: 'M3 4h18v12H3zM8 20h8M12 16v4', plan: 'M4 4h16v4H4zM4 10h10v4H4zM4 16h13v4H4z',
  money: 'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6', res: 'M3 12h18M3 6h18M3 18h12', card: 'M4 5h16v14H4zM8 9h8M8 13h5', cog: 'M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8zM3 12h2M19 12h2M12 3v2M12 19v2', audit: 'M9 5h10M9 12h10M9 19h10M4 5h1M4 12h1M4 19h1',
};
const Ico = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;

function useNavItems(win: Win): { label?: string; items: Item[] }[] {
  const { db, me, role, can } = useData(); const { t } = useTerms(); const W = useWindows();
  return useMemo(() => {
    if (!db || !me) return [];
    if (win === 'work') {
      const lead = role !== 'employee'; const team = lead ? teamOf(db, me, ['unit_head', 'planning_head', 'super_admin', 'group_strategy', 'executive'].includes(role)).filter(x => x.id !== me.id) : []; const ids = new Set(team.map(x => x.id));
      const inbox = db.objectives.filter(o => o.status === 'Submitted' && ids.has(o.owner_position_id)).length + db.deliverables.filter(d => d.status === 'done' && ids.has(d.owner_position_id)).length + db.week_reviews.filter(r => ids.has(r.position_id) && r.submitted_at && !r.feedback_at).length + db.scorecards.filter(s => ids.has(s.position_id) && s.status === 'Discuss').length;
      const unread = db.messages.filter(m => m.to_user === me.user_id && !m.read_at).length;
      const items: Item[] = [{ to: '/today', label: 'Today', icon: I.today }, ...[{ k: 'strategy', to: '/strategy', label: 'How we cascade', icon: I.align }, { k: 'insights_me', to: '/my-insights', label: 'My insights', icon: I.overview }, { k: 'plan', to: '/plan', label: 'Plan', icon: I.plan }, { k: 'record', to: '/record', label: 'Record', icon: I.deliv },
        { k: 'inbox', to: '/inbox', label: 'Inbox', icon: I.inbox, badge: (lead ? inbox : 0) + unread }, { k: 'me', to: '/me', label: 'My performance', icon: I.me }].filter(x => W.work(x.k))];
      return [{ items }];
    }
    if (win === 'insights') return [{ items: [{ to: '/insights/overview', label: 'Overview', icon: I.overview }, { to: '/insights/strategy', label: 'Strategy', icon: I.strategy }, { to: '/insights/map', label: 'Strategy map', icon: I.goals }, { to: '/insights/alignment', label: 'Alignment', icon: I.align }, { to: '/insights/people-work', label: 'Who is doing what', icon: I.people }] },
      { label: 'Performance', items: [{ to: '/insights/performance', label: 'Organisation', icon: I.perf }, { to: '/insights/people', label: 'People', icon: I.me }, ...(moduleOn(db, 'projects') ? [{ to: '/insights/projects', label: 'Projects', icon: I.plan }] : [])] },
      { label: 'Reports', items: [{ to: '/insights/reports', label: 'Reports', icon: I.reports }, ...(can('seeGroup') ? [{ to: '/insights/group', label: 'Group view', icon: I.strategy }] : [])] }];
    const f = (xs: (Item & { k: string })[]) => xs.filter(x => W.item(x.k));
    const g: { label?: string; items: Item[] }[] = [{ items: f([{ k: 'monitor', to: '/studio/monitor', label: 'Process monitor', icon: I.monitor }]) },
      { label: 'Plan', items: f([{ k: 'strategy', to: '/studio/strategy', label: 'Strategy builder', icon: I.strategy }, { k: 'okr', to: '/studio/okr', label: `${t('objective')} planner`, icon: I.goals }, { k: 'targets', to: '/studio/targets', label: 'Targets & progress', icon: I.plan }, { k: 'revenue', to: '/studio/revenue', label: 'Revenue plan', icon: I.money }, { k: 'budget', to: '/studio/budget', label: 'Budget', icon: I.money }, { k: 'resources', to: '/studio/resources', label: 'Resources & payments', icon: I.res }, { k: 'rescope', to: '/studio/rescope', label: 'Rescope & change requests', icon: I.plan }, { k: 'calendar', to: '/studio/calendar', label: 'Planning calendar', icon: I.week }]) },
      { label: 'Performance', items: f([{ k: 'scorecards', to: '/studio/scorecards', label: 'Scorecards', icon: I.card }, { k: 'projects', to: '/studio/projects', label: 'Project portfolio', icon: I.plan }, ...(moduleOn(db, 'erp_replan') ? [{ k: 'replan', to: '/studio/replan', label: 'ERP OKR replan', icon: I.goals }] : [])]) }];
    if (W.studioAdmin) g.push({ label: 'System', items: [{ to: '/studio/framework', label: 'Configuration', icon: I.cog }, { to: '/studio/people', label: 'People & access', icon: I.people }, { to: '/studio/import', label: 'Data import', icon: I.res }, { to: '/studio/backup', label: 'Backup & restore', icon: I.res }, { to: '/studio/audit', label: 'Audit log & undo', icon: I.audit }] });
    return g.filter(x => x.items.length);
  }, [db, me, role, can, t, win, W]);
}

/** System admin only: preview the app as the head or a team member of any department or division. */
function SeeAs() {
  const { db, viewAs, setViewAs, setUnit } = useData(); const nav = useNavigate(); if (!db) return null;
  const units = db.org_units.filter(u => u.kind === 'unit' && u.pilot).sort((a, b) => a.sort - b.sort);
  const pick = (orgId: string, head: boolean) => { const ps = db.positions.filter(p => p.org_unit_id === orgId); return head ? ps.find(p => p.level !== 'employee') : ps.find(p => p.level === 'employee' && p.holder_name); };
  const groupRoles = db.positions.filter(p => ['group_strategy', 'executive'].includes(p.role));
  const opts: { label: string; options: [string, string][] }[] = [{ label: 'Group', options: groupRoles.map(p => [p.id, p.title] as [string, string]) }];
  units.forEach(u => { const orgs = db.org_units.filter(o => o.unit_id === u.id).sort((a, b) => (a.kind === 'unit' ? -1 : b.kind === 'unit' ? 1 : a.sort - b.sort));
    const o2: [string, string][] = []; orgs.forEach(o => { const h = pick(o.id, true), t = pick(o.id, false); const nm = o.kind === 'unit' ? 'Unit' : o.name; if (h) o2.push([h.id, `${nm} — head${h.status === 'Vacant' ? ' (vacant)' : ''}`]); if (t) o2.push([t.id, `${nm} — team member`]); });
    opts.push({ label: u.name, options: o2 }); });
  return <label className="f" style={{ padding: '0 10px 8px' }}>See it as
    <select value={viewAs || ''} onChange={e => { const id = e.target.value || null; setViewAs(id); const p = id && db.positions.find(x => x.id === id); if (p && p.unit_id) setUnit(p.unit_id); nav('/today'); }}>
      <option value="">Myself</option>{opts.map(g => <optgroup key={g.label} label={g.label}>{g.options.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</optgroup>)}
    </select></label>;
}

/** Two or more views of one Studio page, switched at the top (keeps earlier views available instead of dropping them). */
function Views({ views }: { views: [string, string, ReactNode][] }) {
  const [v, setV] = useState(views[0][0]);
  return <><div className="viewsw"><Seg value={v} options={views.map(([k, l]) => [k, l] as [string, string])} onChange={setV} /></div>{views.find(x => x[0] === v)?.[2]}</>;
}

function Shell() {
  const { db, loading, error, me, role, viewAs, setViewAs, toastMsg, myPositions, user } = useData();
  const loc = useLocation(); const nav = useNavigate(); const W = useWindows(); const { t } = useTerms();
  const [side, setSide] = useState(false);
  const win: Win = loc.pathname.startsWith('/insights') ? 'insights' : loc.pathname.startsWith('/studio') ? 'studio' : 'work';
  const groups = useNavItems(win);
  useEffect(() => { setSide(false); window.scrollTo(0, 0); }, [loc.pathname]);
  if (loading) return <div className="login"><p className="note">Loading…</p></div>;
  if (error) return <div className="login"><div className="card"><h2>Could not load</h2><p className="note">{error}</p><button className="btn" onClick={() => location.reload()}>Try again</button></div></div>;
  if (!me) return <ClaimScreen />;
  const isAdmin = myPositions.some(p => p.role === 'super_admin');
  const wins: [Win, string][] = [['work', 'Work'], ...(W.insights ? [['insights', 'Insights'] as [Win, string]] : []), ...(W.studio ? [['studio', 'Studio'] as [Win, string]] : [])];
  const firstStudio = ['monitor', 'okr', 'targets', 'revenue', 'budget', 'strategy', 'resources', 'rescope', 'calendar', 'scorecards', 'projects'].find(k => W.item(k)) || 'monitor';
  const go = (w: Win) => nav(w === 'work' ? '/today' : w === 'insights' ? '/insights/overview' : '/studio/' + firstStudio);
  const S = (k: string, el: ReactNode) => ok(W.studio && W.item(k), el);
  const ok = (cond: boolean, el: ReactNode) => cond ? el : <Navigate to="/today" replace />;
  return <div className={'shell win-' + win}>
    <aside className={'side' + (side ? ' open' : '')}>
      <div className="brand"><span>WBG</span>Planning<span className="sp" /><Bell /></div>
      <div style={{ padding: '0 10px 8px' }}><Search /></div>
      {wins.length > 1 && <div className="winsw" role="tablist" aria-label="Window">{wins.map(([k, l]) => <button key={k} role="tab" aria-selected={win === k} className={win === k ? 'on' : ''} onClick={() => go(k)}>{l}</button>)}</div>}
      <nav aria-label="Main">{groups.map((g, gi) => <div key={gi} className="navg">{g.label && <div className="navl">{g.label}</div>}{g.items.map(it => <NavLink key={it.to} to={it.to} className={({ isActive }) => 'mod' + (isActive || (it.to === '/strategy' && loc.pathname.startsWith('/goals')) ? ' on' : '')}><Ico d={it.icon} /><span>{it.label}</span>{it.badge ? <i className="cnt">{it.badge}</i> : null}</NavLink>)}</div>)}</nav>
      <div className="sbot">
        <div className="who"><b>{me.holder_name || me.title}</b>{me.title} · {ROLE_NAME[role]}</div>
        {isAdmin && <SeeAs />}
        <button className="mod" onClick={() => sb.auth.signOut()}><Ico d="M15 12H4m0 0l4-4m-4 4l4 4M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5" /><span>Sign out</span></button>
      </div>
    </aside>
    <div className="mainw">
      <div className="topm"><button className="burger" onClick={() => setSide(true)} aria-label="Menu">☰</button><b>WBG Planning</b><span className="sp" /><Bell /></div>
      {viewAs && <div className="banner" style={{ margin: '12px 28px 0' }}>Previewing as <b>{me.holder_name || me.title}</b> ({ROLE_NAME[role]}). <button className="btn sm" onClick={() => setViewAs(null)}>Back to myself</button></div>}
      <Routes>
        <Route path="/" element={<Navigate to="/today" replace />} />
        {/* Work window */}
        <Route path="/today" element={<Today />} />
        <Route path="/strategy" element={ok(W.work('strategy'), <OurStrategy />)} />
        <Route path="/my-insights" element={ok(W.work('insights_me'), <MyInsights />)} />
        <Route path="/plan" element={ok(W.work('plan'), <PlanPage />)} />
        <Route path="/record" element={ok(W.work('record'), <RecordPage />)} />
        <Route path="/week" element={<Navigate to="/record" replace />} />
        <Route path="/goals" element={<Navigate to="/strategy" replace />} />
        <Route path="/goals/new" element={<NewObjective />} />
        <Route path="/deliverables" element={<Navigate to="/plan?tab=deliverables" replace />} />
        <Route path="/inbox" element={ok(W.work('inbox'), <InboxPage />)} />
        <Route path="/me" element={<Me />} />
        {/* Insights window */}
        <Route path="/insights" element={<Navigate to="/insights/overview" replace />} />
        <Route path="/insights/overview" element={ok(W.insights, <Overview />)} />
        <Route path="/insights/strategy" element={ok(W.insights, <StrategyOverview />)} />
        <Route path="/insights/map" element={ok(W.insights, <GoalsMap />)} />
        <Route path="/insights/alignment" element={ok(W.insights, <Alignment />)} />
        <Route path="/insights/people-work" element={ok(W.insights, <WhoDoesWhat />)} />
        <Route path="/insights/performance" element={ok(W.insights, <PerfOrg />)} />
        <Route path="/insights/people" element={ok(W.insights, <PerfPeople />)} />
        <Route path="/insights/reports" element={ok(W.insights, <Reports />)} />
        <Route path="/insights/group" element={ok(W.insights, <GroupView />)} />
        <Route path="/insights/projects" element={ok(W.insights, <Portfolio />)} />
        {/* Studio window */}
        <Route path="/studio" element={<Navigate to={'/studio/' + firstStudio} replace />} />
        <Route path="/studio/monitor" element={S('monitor', <Monitor />)} />
        <Route path="/studio/strategy" element={S('strategy', <StrategyBuilder />)} />
        <Route path="/studio/okr" element={S('okr', <OkrPlan />)} />
        <Route path="/studio/targets" element={S('targets', <GoalsQuarter />)} />
        <Route path="/studio/revenue" element={S('revenue', <RevenuePlan />)} />
        <Route path="/studio/budget" element={S('budget', <BudgetPlan />)} />
        <Route path="/studio/resources" element={S('resources', <Views views={[['month', 'Monthly priorities & payments', <ResourcesMonthly />], ['quarter', 'Quarter waterline', <Resources />]]} />)} />
        <Route path="/studio/rescope" element={S('rescope', <Views views={[['grid', 'Quarter grid (approved vs new)', <RescopeEditor />], ['whole', 'Whole-plan rescope / replan', <Rescope />]]} />)} />
        <Route path="/studio/replan" element={ok(W.studio && W.item('replan'), <ErpReplan />)} />
        <Route path="/studio/projects" element={ok(W.item('projects'), <Portfolio edit />)} />
        <Route path="/studio/calendar" element={S('calendar', <PlanCalendar />)} />
        <Route path="/studio/scorecards" element={S('scorecards', <Scorecards />)} />
        <Route path="/studio/framework" element={ok(W.studioAdmin, <Framework />)} />
        <Route path="/studio/people" element={ok(W.studioAdmin, <SettingsPeople />)} />
        <Route path="/studio/import" element={ok(W.studioAdmin, <SettingsImport />)} />
        <Route path="/studio/audit" element={ok(W.studioAdmin, <Audit />)} />
        <Route path="/studio/backup" element={ok(W.studioAdmin, <Backup />)} />
        {/* old addresses */}
        <Route path="/home" element={<Navigate to="/today" replace />} />
        <Route path="/work" element={<Navigate to="/record" replace />} />
        <Route path="/strategy/*" element={<Navigate to="/strategy" replace />} />
        <Route path="/plan/okr" element={<Navigate to="/studio/okr" replace />} />
        <Route path="/plan/revenue" element={<Navigate to="/studio/revenue" replace />} />
        <Route path="/plan/rescope" element={<Navigate to="/studio/rescope" replace />} />
        <Route path="/plan/*" element={<Navigate to="/plan" replace />} />
        <Route path="/performance/*" element={<Navigate to="/me" replace />} />
        <Route path="/reports" element={<Navigate to="/insights/reports" replace />} />
        <Route path="/settings/people" element={<Navigate to="/studio/people" replace />} />
        <Route path="/settings/*" element={<Navigate to="/studio/framework" replace />} />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Routes>
    </div>
    {toastMsg && <div className="toast" role="status">{toastMsg}</div>}

  </div>;
}

export default function App() {
  const [session, setSession] = useState<any>(undefined);
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((e, s) => { if (e === 'PASSWORD_RECOVERY') setRecovery(true); setSession(s); });
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === undefined) return null;
  if (!session || recovery) return <Login session={recovery ? session : null} onDone={() => setRecovery(false)} />;
  return <DataProvider key={session.user.id} user={session.user}><Shell /></DataProvider>;
}
