import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { sb } from './lib/supabase';
import { DataProvider, ROLE_NAME, useData } from './lib/data';
import Login from './pages/Login';
import Home from './pages/Home';
import { GoalsMap, GoalsQuarter, GroupView } from './pages/Goals';
import OkrPlan from './pages/OkrPlan';
import { RevenuePlan, BudgetPlan } from './pages/AnnualPlan';
import { Resources, Rescope, PlanCalendar } from './pages/Resources';
import Work from './pages/Work';
import { PerfOrg, PerfPeople } from './pages/Performance';
import Reports from './pages/Reports';
import { SettingsRules, SettingsPeople, SettingsImport } from './pages/Settings';

const IC: Record<string, string> = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', work: 'M5 12l4 4L19 6M4 20h16',
  goals: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zm0 4a5 5 0 1 0 0 10a5 5 0 1 0 0-10zm0 3a2 2 0 1 0 0 4a2 2 0 1 0 0-4z',
  plan: 'M4 4h16v4H4zM4 10h10v4H4zM4 16h13v4H4z', performance: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  reports: 'M5 3h10l4 4v14H5zM8 12h8M8 16h8M8 8h4', settings: 'M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8zM3 12h2M19 12h2M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4',
};
const Ico = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;

type NavItem = { key: string; label: string; subs: [string, string][] };
function useNav(): NavItem[] {
  const { can, role } = useData();
  const n: NavItem[] = [{ key: 'home', label: 'Home', subs: [] }, { key: 'work', label: 'Work', subs: [] },
    { key: 'goals', label: 'Goals', subs: [['map', 'Strategy map'], ['quarter', 'By quarter'], ...(can('seeGroup') ? [['group', 'Group view'] as [string, string]] : [])] }];
  if (can('editOKR') || can('editPlan')) {
    const ps: [string, string][] = [['calendar', 'Planning calendar']];
    if (can('editOKR')) ps.push(['okr', 'OKR plan']);
    if (can('editPlan')) ps.push(['revenue', 'Revenue plan'], ['budget', 'Budget'], ['resources', 'Resources'], ['rescope', 'Rescope & versions']);
    n.push({ key: 'plan', label: 'Plan', subs: ps });
  }
  n.push({ key: 'performance', label: role === 'employee' ? 'My performance' : 'Performance', subs: role === 'employee' ? [] : [['org', 'Organisation'], ['people', 'People']] });
  if (can('reports')) n.push({ key: 'reports', label: 'Reports', subs: [] });
  if (can('settings')) n.push({ key: 'settings', label: 'Settings', subs: [['rules', 'Rules'], ['people', 'People & access'], ['import', 'Data import']] });
  return n;
}

function Shell() {
  const { db, loading, error, me, role, viewAs, setViewAs, toastMsg, myPositions, user } = useData();
  const nav = useNav();
  const loc = useLocation();
  const [side, setSide] = useState(false);
  useEffect(() => { setSide(false); window.scrollTo(0, 0); }, [loc.pathname]);
  if (loading) return <div className="login"><p className="note">Loading the plan…</p></div>;
  if (error) return <div className="login"><div className="card"><h2>Could not load</h2><p className="note">{error}</p><button className="btn" onClick={() => location.reload()}>Try again</button></div></div>;
  const top = loc.pathname.split('/')[1] || 'home';
  const isAdmin = myPositions.some(p => p.role === 'super_admin' || p.role === 'group_strategy');
  if (!me) return <div className="login"><div className="card stack"><h2>Account not linked yet</h2><p>You are signed in as <b>{user.email}</b>, but this email is not yet linked to a position. Ask Group Strategy (Settings → People & access) to add your email to your position, then sign in again.</p><button className="btn" onClick={() => sb.auth.signOut()}>Sign out</button></div></div>;
  const guard = (cap: boolean, el: ReactNode) => cap ? el : <Navigate to="/home" replace />;
  const has = (k: string, s?: string) => { const n = nav.find(x => x.key === k); return !!n && (!s || n.subs.some(x => x[0] === s)); };
  return <div className="shell">
    <aside className={'side' + (side ? ' open' : '')}>
      <div className="brand"><span>WBG</span>Planning</div>
      <nav aria-label="Main">{nav.map(n => <div key={n.key}>
        <NavLink className={'mod' + (top === n.key ? ' on' : '')} to={'/' + n.key + (n.subs[0] ? '/' + n.subs[0][0] : '')}><Ico d={IC[n.key]} /><span>{n.label}</span></NavLink>
        {top === n.key && n.subs.length > 1 && <div className="subs">{n.subs.map(s => <NavLink key={s[0]} to={`/${n.key}/${s[0]}`} className={({ isActive }) => isActive ? 'on' : ''}>{s[1]}</NavLink>)}</div>}
      </div>)}</nav>
      <div className="sbot">
        <div className="who"><b>{me.holder_name || me.title}</b>{me.title} · {ROLE_NAME[role]}</div>
        {isAdmin && db && <label className="f" style={{ padding: '0 10px 8px' }}>See it as
          <select value={viewAs || ''} onChange={e => setViewAs(e.target.value || null)}>
            <option value="">Myself</option>
            {db.positions.filter(p => p.role !== 'employee' || p.holder_name).sort((a, b) => (a.unit_id || '').localeCompare(b.unit_id || '') || a.sort - b.sort).slice(0, 400).map(p => <option key={p.id} value={p.id}>{(p.holder_name ? p.holder_name + ' — ' : '') + p.title}</option>)}
          </select></label>}
        <button className="mod" onClick={() => sb.auth.signOut()}><Ico d="M15 12H4m0 0l4-4m-4 4l4 4M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5" /><span>Sign out</span></button>
      </div>
    </aside>
    <div className="mainw">
      <div className="topm"><button className="burger" onClick={() => setSide(true)} aria-label="Menu">☰</button><b>WBG Planning</b></div>
      {viewAs && <div className="banner" style={{ margin: '12px 28px 0' }}>Previewing as <b>{me.holder_name || me.title}</b> ({ROLE_NAME[role]}). Data you can open is still your own access. <button className="btn sm" onClick={() => setViewAs(null)}>Back to myself</button></div>}
      <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<Home />} />
        <Route path="/work" element={<Work />} />
        <Route path="/goals" element={<Navigate to="/goals/map" replace />} />
        <Route path="/goals/map" element={<GoalsMap />} />
        <Route path="/goals/quarter" element={<GoalsQuarter />} />
        <Route path="/goals/group" element={guard(has('goals', 'group'), <GroupView />)} />
        <Route path="/plan" element={<Navigate to="/plan/calendar" replace />} />
        <Route path="/plan/calendar" element={guard(has('plan'), <PlanCalendar />)} />
        <Route path="/plan/okr" element={guard(has('plan', 'okr'), <OkrPlan />)} />
        <Route path="/plan/revenue" element={guard(has('plan', 'revenue'), <RevenuePlan />)} />
        <Route path="/plan/budget" element={guard(has('plan', 'budget'), <BudgetPlan />)} />
        <Route path="/plan/resources" element={guard(has('plan', 'resources'), <Resources />)} />
        <Route path="/plan/rescope" element={guard(has('plan', 'rescope'), <Rescope />)} />
        <Route path="/performance" element={role === 'employee' ? <PerfPeople mine /> : <Navigate to="/performance/org" replace />} />
        <Route path="/performance/org" element={<PerfOrg />} />
        <Route path="/performance/people" element={<PerfPeople />} />
        <Route path="/reports" element={guard(has('reports'), <Reports />)} />
        <Route path="/settings" element={<Navigate to="/settings/rules" replace />} />
        <Route path="/settings/rules" element={guard(has('settings'), <SettingsRules />)} />
        <Route path="/settings/people" element={guard(has('settings'), <SettingsPeople />)} />
        <Route path="/settings/import" element={guard(has('settings'), <SettingsImport />)} />
        <Route path="*" element={<Navigate to="/home" replace />} />
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
