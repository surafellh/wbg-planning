import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { sb, fetchAll } from './supabase';
import { setCalendar } from './calc';

export const TABLES = ['org_units', 'positions', 'profiles', 'app_settings', 'group_pillars', 'group_goals', 'unit_pillars', 'unit_goals', 'objectives', 'key_results', 'kr_targets', 'kr_plan_links', 'check_ins',
  'projects', 'plan_lines', 'actuals', 'cash_items', 'cash_values', 'activity_plan_lines', 'funds', 'need_priority', 'plan_status', 'rescopes', 'deliverables', 'activities', 'scorecards', 'scorecard_items', 'kpis', 'kpi_values', 'comments', 'notifications', 'position_claims', 'kr_month_targets', 'strategy_statements', 'week_reviews', 'messages', 'pmo_projects', 'cash_actual', 'cash_weekly', 'fund_months', 'need_schedule'] as const;
const ORDER: Record<string, string> = { app_settings: 'key', cash_values: 'item_id', funds: 'unit_id', need_priority: 'unit_id', plan_status: 'unit_id', kr_targets: 'kr_id', kpi_values: 'kpi_id', kr_plan_links: 'kr_id', kr_month_targets: 'kr_id', strategy_statements: 'unit_id', cash_actual: 'unit_id', cash_weekly: 'unit_id', fund_months: 'unit_id' };
export type Row = Record<string, any>;
export type DB = { [K in (typeof TABLES)[number]]: Row[] } & { settings: Record<string, any>; cache: Map<string, any> };

export type Role = 'super_admin' | 'group_strategy' | 'executive' | 'unit_head' | 'planning_head' | 'finance' | 'dept_head' | 'div_head' | 'employee' | 'none';
export const ROLE_NAME: Record<Role, string> = { super_admin: 'System admin', group_strategy: 'Group Strategy', executive: 'Top management', unit_head: 'Unit head', planning_head: 'Planning head', finance: 'Finance', dept_head: 'Department head', div_head: 'Division head', employee: 'Team member', none: 'Not linked' };
const RANK: Role[] = ['super_admin', 'group_strategy', 'executive', 'unit_head', 'planning_head', 'finance', 'dept_head', 'div_head', 'employee'];

/** What each role can do (mirrors the database rules; the database is the final check). */
export const CAPS: Record<string, Role[]> = {
  seeGroup: ['super_admin', 'group_strategy', 'executive'],
  editOKR: ['super_admin', 'group_strategy', 'unit_head', 'planning_head', 'dept_head', 'div_head'],
  editPlan: ['super_admin', 'group_strategy', 'unit_head', 'planning_head', 'finance'],
  enterActuals: ['super_admin', 'group_strategy', 'finance'],
  approve: ['super_admin', 'group_strategy'],
  finalApprove: ['super_admin', 'executive'],
  managePeople: ['super_admin', 'group_strategy', 'unit_head', 'dept_head', 'div_head'],
  reports: ['super_admin', 'group_strategy', 'executive', 'unit_head', 'planning_head', 'finance'],
  settings: ['super_admin', 'group_strategy'],
};

type Ctx = {
  db: DB | null; loading: boolean; error: string | null; user: any; reload: (tables?: string[]) => Promise<void>;
  me: Row | null; myPositions: Row[]; role: Role; can: (cap: string) => boolean; viewAs: string | null; setViewAs: (id: string | null) => void;
  unit: string | null; setUnit: (id: string) => void; units: Row[]; toast: (m: string) => void; toastMsg: string | null;
};
const C = createContext<Ctx>(null as any);
export const useData = () => useContext(C);

export function DataProvider({ user, children }: { user: any; children: ReactNode }) {
  const [db, setDb] = useState<DB | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewAs, setViewAs] = useState<string | null>(null);
  const [unitSel, setUnitSel] = useState<string | null>(() => { try { return localStorage.getItem('wbg.unit'); } catch { return null; } });
  const [toastMsg, setToast] = useState<string | null>(null);

  const reload = useCallback(async (tables?: string[]) => {
    try {
      const list = (tables && tables.length ? tables : TABLES) as string[];
      const got = await Promise.all(list.map(t => fetchAll(t, ORDER[t] || 'id')));
      setDb(prev => {
        const next: any = { ...(prev || {}) };
        list.forEach((t, i) => { next[t] = got[i]; });
        TABLES.forEach(t => { if (!next[t]) next[t] = []; });
        next.settings = Object.fromEntries((next.app_settings as Row[]).map(r => [r.key, r.value])); setCalendar(next.settings.calendar);
        next.cache = new Map();
        return next;
      });
      setError(null);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { (async () => { await sb.rpc('claim_positions'); await reload(); })(); }, [reload]);

  const myPositions = useMemo(() => (db?.positions || []).filter(p => p.user_id === user.id), [db, user]);
  const realRole: Role = useMemo(() => { for (const r of RANK) if (myPositions.some(p => p.role === r)) return r; return 'none'; }, [myPositions]);
  const me = useMemo(() => {
    if (viewAs && db && (realRole === 'super_admin' || realRole === 'group_strategy')) return db.positions.find(p => p.id === viewAs) || null;
    return [...myPositions].sort((a, b) => RANK.indexOf(a.role) - RANK.indexOf(b.role))[0] || null;
  }, [viewAs, db, myPositions, realRole]);
  const role: Role = (me?.role as Role) || 'none';
  const can = useCallback((cap: string) => (CAPS[cap] || []).includes(role), [role]);

  const units = useMemo(() => (db?.org_units || []).filter(u => u.kind === 'unit' && u.pilot).sort((a, b) => a.sort - b.sort), [db]);
  const unit = useMemo(() => {
    if (!db) return null;
    if (can('seeGroup')) return unitSel && units.some(u => u.id === unitSel) ? unitSel : units[0]?.id || null;
    return me?.unit_id || null;
  }, [db, can, unitSel, units, me]);
  const setUnit = (id: string) => { setUnitSel(id); try { localStorage.setItem('wbg.unit', id); } catch { /* ignore */ } };
  const toast = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2600); }, []);

  return <C.Provider value={{ db, loading, error, user, reload, me, myPositions, role, can, viewAs, setViewAs, unit, setUnit, units, toast, toastMsg }}>{children}</C.Provider>;
}

/** Write helper: run a Supabase call, toast errors, reload the touched tables. */
export function useSave() {
  const { reload, toast } = useData();
  return useCallback(async (fn: () => PromiseLike<{ error: any }>, tables: string[], ok?: string) => {
    const { error } = await fn();
    if (error) { toast('Not saved: ' + error.message); return false; }
    await reload(tables);
    if (ok) toast(ok);
    return true;
  }, [reload, toast]);
}

/** Framework terminology (OKR, Balanced Scorecard or KPI) — every screen uses these words. */
export const FRAMEWORKS: Record<string, { name: string; labels: Record<string, string> }> = {
  okr: { name: 'OKR — Objectives and Key Results', labels: { pillar: 'Pillar', goal: 'Strategic goal', objective: 'Objective', key_result: 'Key result', deliverable: 'Deliverable', activity: 'Activity' } },
  bsc: { name: 'Balanced Scorecard', labels: { pillar: 'Perspective', goal: 'Strategic objective', objective: 'Objective', key_result: 'Measure (KPI)', deliverable: 'Initiative milestone', activity: 'Activity' } },
  kpi: { name: 'KPI / Management by Objectives', labels: { pillar: 'Focus area', goal: 'Goal', objective: 'Objective', key_result: 'KPI', deliverable: 'Output', activity: 'Task' } },
};
export function useTerms() {
  const { db } = useData(); const f = db?.settings.framework || { type: 'okr' };
  const base = (FRAMEWORKS[f.type] || FRAMEWORKS.okr).labels; const L = { ...base, ...(f.labels || {}) };
  const t = (k: string, plural = false) => { const w = L[k] || k; return plural ? (w.endsWith('y') ? w.slice(0, -1) + 'ies' : w.endsWith('s') ? w : w + 's') : w; };
  return { t, type: f.type as string };
}
/** Which Studio pages each role opens by default (overridable in Studio → Framework & rules). */
export const STUDIO_ITEMS: Record<string, string[]> = {
  monitor: ['super_admin', 'group_strategy', 'planning_head', 'unit_head'], strategy: ['super_admin', 'group_strategy', 'planning_head'],
  okr: ['super_admin', 'group_strategy', 'planning_head', 'unit_head', 'dept_head', 'div_head'], targets: ['super_admin', 'group_strategy', 'planning_head', 'unit_head', 'dept_head', 'div_head'],
  revenue: ['super_admin', 'group_strategy', 'planning_head', 'unit_head', 'finance'], budget: ['super_admin', 'group_strategy', 'planning_head', 'unit_head', 'finance', 'dept_head'],
  resources: ['super_admin', 'group_strategy', 'planning_head', 'unit_head', 'finance'], rescope: ['super_admin', 'group_strategy', 'planning_head', 'unit_head', 'finance'],
  calendar: ['super_admin', 'group_strategy', 'planning_head', 'unit_head', 'finance', 'dept_head', 'div_head'], scorecards: ['super_admin', 'group_strategy', 'planning_head', 'unit_head', 'dept_head', 'div_head'],
  projects: ['super_admin', 'group_strategy'],
  replan: ['super_admin', 'group_strategy', 'unit_head', 'planning_head'],
};
export const STUDIO_LABELS: Record<string, string> = { monitor: 'Process monitor', strategy: 'Strategy builder', okr: 'Objective planner', targets: 'Targets & progress', revenue: 'Revenue plan', budget: 'Budget', resources: 'Resources', rescope: 'Rescope & versions', calendar: 'Planning calendar', scorecards: 'Scorecards', projects: 'Project portfolio', replan: 'ERP OKR replan' };
export const WORK_PAGES: Record<string, string> = { strategy: 'How we cascade', insights_me: 'My insights', plan: 'Plan', record: 'Record', inbox: 'Inbox', me: 'My performance' };
/** Optional modules (Studio → Configuration → Modules). */
export function moduleOn(db: DB | null, k: string) { const m = db?.settings.modules || {}; return m[k]?.enabled !== false; }
/** Which windows a role can open (configurable in Studio → Framework & rules). */
export function useWindows() {
  const { db, role, me } = useData(); const w = db?.settings.windows || {};
  const has = (k: string, def: string[]) => ((w[k] as string[]) || def).includes(role);
  const items = { ...STUDIO_ITEMS, ...(db?.settings.studio_items || {}) } as Record<string, string[]>;
  const pmo = db?.org_units.find(o => o.id === me?.org_unit_id)?.code === 'pmo';
  const item = (k: string) => (items[k] || []).includes(role) || (k === 'projects' && pmo);
  const studioAdmin = has('studio_admin', ['super_admin', 'group_strategy']);
  const wp = db?.settings.work_pages || {}; const work = (k: string) => !wp[k] || (wp[k] as string[]).includes(role);
  return { work, insights: has('insights', ['super_admin', 'group_strategy', 'executive', 'unit_head', 'planning_head', 'finance', 'dept_head', 'div_head']), studio: has('studio', ['super_admin', 'group_strategy', 'planning_head', 'finance', 'unit_head', 'dept_head', 'div_head']), studioAdmin, item: (k: string) => (k === 'projects' && !moduleOn(db, 'projects') ? false : studioAdmin || item(k)) };
}
/** Who may enter financial actuals: the roles set in Studio → Configuration → Access (default Finance, planners, Group) plus members of the organisations chosen there (e.g. the Finance department). */
export function canEnterActuals(db: DB | null, me: Row | null, role: string) {
  if (!db || !me) return false; const a = db.settings.actuals_entry || {};
  const roles: string[] = a.roles || ['super_admin', 'group_strategy', 'finance', 'planning_head', 'unit_head'];
  return roles.includes(role) || (a.org_unit_ids || []).includes(me.org_unit_id);
}
/** Send a notification to positions' linked users (no-op for vacant or unlinked positions). */
export async function notifyPositions(db: DB, posIds: (string | null | undefined)[], kind: string, title: string, link?: string, body?: string) {
  if ((db.settings.notify || {})[kind] === false) return;
  const users = posIds.map(id => db.positions.find(p => p.id === id)?.user_id).filter(Boolean);
  if (users.length) { const { sb } = await import('./supabase'); await sb.rpc('notify', { user_ids: users, kind, title, body: body || null, link: link || null }); }
}
/** The head position of a position's organisation (or of the level above when it heads its own). */
export function managerOf(db: DB, pos: Row): Row | undefined {
  let org = db.org_units.find(u => u.id === pos.org_unit_id);
  while (org) { const h = db.positions.find(p => p.org_unit_id === org!.id && p.level !== 'employee' && p.id !== pos.id); if (h) return h; org = db.org_units.find(u => u.id === org!.parent_id); }
  return undefined;
}

// convenience lookups
export const byId = (rows: Row[], id: any) => rows.find(r => r.id === id);
export function orgPath(db: DB, id: string | null | undefined): Row[] { const out: Row[] = []; let cur = byId(db.org_units, id); while (cur) { out.unshift(cur); cur = byId(db.org_units, cur.parent_id); } return out; }
export function orgChildren(db: DB, id: string) { return db.org_units.filter(u => u.parent_id === id).sort((a, b) => a.sort - b.sort); }
export function posName(db: DB, id: any) { const p = byId(db.positions, id); return p ? (p.holder_name || p.title) : '—'; }
