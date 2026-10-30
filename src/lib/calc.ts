/* Calculation rules (requirements doc §6): calendar, key-result progress,
   objective and organisation scores, person results, plan maths, statements. */
import type { DB } from './data';

// ---------------- fiscal calendar ----------------
// FY starts 8 July (Hamle 1). Months carry Gregorian names but start on the Ethiopian month.
export const MONTHS = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
export function fyStartYear(fy: string) { return parseInt(fy.slice(0, 4), 10); }
/** Start date of fiscal month m (1..12). */
export function monthStart(fy: string, m: number): Date {
  const y = fyStartYear(fy);
  if (m === 1) return new Date(Date.UTC(y, 6, 8));
  if (m === 2) return new Date(Date.UTC(y, 7, 7));
  // Meskerem 1 = 11 Sep (12 Sep in the year before a Gregorian leap year)
  const mesk = new Date(Date.UTC(y, 8, (y + 1) % 4 === 0 ? 12 : 11));
  return new Date(mesk.getTime() + (m - 3) * 30 * 864e5);
}
export function monthOf(fy: string, d: Date): number {
  for (let m = 12; m >= 1; m--) if (d >= monthStart(fy, m)) return m;
  return 1;
}
export const qOfMonth = (m: number) => Math.ceil(m / 3);
export const qMonths = (q: number) => [q * 3 - 2, q * 3 - 1, q * 3];
export function ymd(d: Date) { return d.toISOString().slice(0, 10); }
/** Saturday that starts the week containing d. */
export function weekStart(d: Date) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const dow = x.getUTCDay(); const back = (dow + 1) % 7; return new Date(x.getTime() - back * 864e5); }
/** Week number inside its fiscal month (restarts at 1 each month). */
export function weekNo(fy: string, ws: Date) { const m = monthOf(fy, ws); const s = weekStart(monthStart(fy, m)); return Math.floor((ws.getTime() - s.getTime()) / (7 * 864e5)) + 1; }

// ---------------- formatting ----------------
export function fmt(v: number | null | undefined, d = 0) { if (v == null || isNaN(v)) return '—'; return v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }); }
export function money(v: number | null | undefined) { if (v == null || isNaN(v)) return '—'; const a = Math.abs(v); if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M'; if (a >= 1e3) return (v / 1e3).toFixed(0) + 'K'; return v.toFixed(0); }
export function pct(v: number | null | undefined, d = 0) { return v == null || isNaN(v) ? '—' : (v * 100).toFixed(d) + '%'; }
export const sum = (a: (number | null | undefined)[]) => a.reduce<number>((s, x) => s + (x || 0), 0);

// ---------------- statuses and bands ----------------
export function statusOf(p: number | null, conf: string | null | undefined, db: DB): [string, 'good' | 'warn' | 'bad' | 'none'] {
  const t = db.settings.status_thresholds || { on_track: 95, off_track: 70 };
  if (p == null) return ['No data', 'none'];
  if (p * 100 < t.off_track) return ['Off track', 'bad'];
  if (p * 100 < t.on_track || conf === 'Low') return ['Behind', 'warn'];
  return ['On track', 'good'];
}
export function bandOf(p: number | null, db: DB) {
  if (p == null) return '—';
  const bands = (db.settings.bands || []) as { name: string; min: number }[];
  for (const b of bands) if (p * 100 >= b.min) return b.name;
  return bands.length ? bands[bands.length - 1].name : '—';
}

// ---------------- plan maths ----------------
export function lineVals(l: any, base = false): number[] { const v = (base ? l.val0 : l.val) || l.val0 || []; return Array.from({ length: 12 }, (_, i) => Number(v[i] || 0)); }
export function lineQty(l: any, base = false): number[] { const v = (base ? l.qty0 : l.qty) || l.qty0 || []; return Array.from({ length: 12 }, (_, i) => Number(v[i] || 0)); }
export function linesOf(db: DB, unit: string, sec?: string) { return db.plan_lines.filter(l => l.unit_id === unit && (!sec || l.section === sec)); }
export function planBy(db: DB, unit: string, sec: string, months: number[], groups?: string[] | null, base = false, metric: 'value' | 'quantity' = 'value') {
  return sum(linesOf(db, unit, sec).filter(l => !groups || !groups.length || groups.includes(l.line_group)).map(l => sum(months.map(m => (metric === 'quantity' ? lineQty(l, base) : lineVals(l, base))[m - 1]))));
}
export function actualBy(db: DB, unit: string, sec: string, months: number[], groups?: string[] | null) {
  const rows = db.actuals.filter(a => a.unit_id === unit && a.section === sec && months.includes(a.month) && (!groups || !groups.length || groups.includes(a.line_group)));
  return rows.length ? sum(rows.map(r => Number(r.value))) : null;
}
export function lastActualMonth(db: DB, unit?: string) { let m = 0; db.actuals.forEach(a => { if ((!unit || a.unit_id === unit) && a.value != null && a.month > m) m = a.month; }); return m; }

// ---------------- key results and objectives ----------------
export function currentQ(db: DB) { return Number(db.settings.current?.quarter || 1); }
function krTargetFor(db: DB, k: any, q: number) { const t = db.kr_targets.find(x => x.kr_id === k.id && x.quarter === q); return t ? Number(t.target) : null; }
export function lastCheckIn(db: DB, krId: string) { let best: any = null; for (const c of db.check_ins) if (c.kr_id === krId && (!best || c.created_at > best.created_at)) best = c; return best; }

/** Progress 0..n of a key result (null when nothing to measure yet). */
export function krProgress(db: DB, k: any, depth = 0): number | null {
  if (depth > 8) return null;
  if (k.measure === 'children') {
    const kids = db.objectives.filter(o => o.parent_kr_id === k.id);
    if (!kids.length) return null;
    return weighted(kids.map(o => [Number(o.weight_to_parent) || 1, objScore(db, o, depth + 1)]));
  }
  if (k.measure === 'deliverables') {
    const ds = db.deliverables.filter(d => d.key_result_id === k.id && d.status !== 'removed' && d.status !== 'transferred');
    if (!ds.length) return null;
    return weighted(ds.map(d => [Number(d.weight) || 1, d.status === 'accepted' ? 1 : d.status === 'done' ? 0.5 : 0]));
  }
  if (k.measure === 'plan') {
    const link = db.kr_plan_links.find(x => x.kr_id === k.id);
    const unit = unitOfObjective(db, k.objective_id);
    if (!link || !unit) return null;
    const last = lastActualMonth(db, unit);
    if (!last) return null;
    const ms = Array.from({ length: last }, (_, i) => i + 1);
    const plan = planBy(db, unit, link.section, ms, link.line_groups, false, link.metric);
    const act = actualBy(db, unit, link.section, ms, link.line_groups);
    if (act == null || !plan) return null;
    return k.lower_is_better ? (act <= 0 ? 1 : plan / act) : act / plan;
  }
  const c = lastCheckIn(db, k.id);
  if (!c || c.value == null) return null;
  const v = Number(c.value), base = Number(k.baseline || 0);
  const tgt = krTargetFor(db, k, c.quarter || currentQ(db)) ?? (k.year_target != null ? Number(k.year_target) : null);
  if (tgt == null) return null;
  if (k.lower_is_better) return v <= tgt ? 1 : Math.max(0, (base - v) / Math.max(1e-9, base - tgt));
  if (tgt === base) return v >= tgt ? 1 : 0;
  return Math.max(0, (v - base) / (tgt - base));
}
export function weighted(items: [number, number | null][]) {
  const ok = items.filter(x => x[1] != null) as [number, number][];
  if (!ok.length) return null;
  const w = sum(ok.map(x => x[0]));
  return w ? sum(ok.map(x => x[0] * Math.min(1, x[1]))) / w : null;
}
export function unitOfObjective(db: DB, oid: string) { return db.objectives.find(o => o.id === oid)?.unit_id; }
export function krsOf(db: DB, oid: string) { return db.key_results.filter(k => k.objective_id === oid && !k.retired_at).sort((a, b) => (a.sort || 0) - (b.sort || 0)); }
export function childObjectives(db: DB, oid: string) { return db.objectives.filter(o => o.parent_objective_id === oid); }

/** Objective score O = Σ w·min(p,1) / Σ w. An objective with no key results takes the weighted score of the objectives below it. */
export function objScore(db: DB, o: any, depth = 0): number | null {
  const c = db.cache; const ck = 'o' + o.id;
  if (c.has(ck)) return c.get(ck);
  const v = objScore0(db, o, depth); c.set(ck, v); return v;
}
function objScore0(db: DB, o: any, depth: number): number | null {
  const ks = krsOf(db, o.id);
  if (ks.length) return weighted(ks.map(k => [Number(k.weight) || 1, krProgress(db, k, depth)]));
  const kids = childObjectives(db, o.id);
  if (!kids.length || depth > 8) return null;
  return weighted(kids.map(c => [Number(c.weight_to_parent) || 1, objScore(db, c, depth + 1)]));
}

/** Organisation score = average of that org unit's objectives; a level with none inherits from the level above. */
export function orgScore(db: DB, orgId: string | null | undefined, depth = 0): number | null {
  if (!orgId || depth > 6) return null;
  const ck = 'g' + orgId; if (db.cache.has(ck)) return db.cache.get(ck);
  const v = orgScore0(db, orgId, depth); db.cache.set(ck, v); return v;
}
function orgScore0(db: DB, orgId: string, depth: number): number | null {
  const objs = db.objectives.filter(o => o.org_unit_id === orgId);
  const vals = objs.map(o => objScore(db, o)).filter(v => v != null) as number[];
  if (vals.length) return sum(vals) / vals.length;
  const org = db.org_units.find(u => u.id === orgId);
  return org ? orgScore(db, org.parent_id, depth + 1) : null;
}
export function orgShare(db: DB, level: string) {
  const w = db.settings.org_weights || { unit: 70, department: 60, division: 50, employee: 30 };
  const key = level === 'group' ? 'unit' : level;
  return (Number(w[key] ?? 30)) / 100;
}
/** Person result R = s·S_org + (1−s)·personal. */
export function personResult(db: DB, p: any) {
  const s = orgShare(db, p.level);
  if (p.status === 'Vacant') return { s, org: orgScore(db, p.org_unit_id), personal: null, R: null, basis: 'Vacant position', hr: null };
  const org = orgScore(db, p.org_unit_id);
  const dels = db.deliverables.filter(d => d.owner_position_id === p.id && !['removed', 'transferred'].includes(d.status));
  let personal: number | null = null, basis = 'No personal items yet';
  if (dels.length) { personal = weighted(dels.map(d => [Number(d.weight) || 1, d.status === 'accepted' ? Math.min(1, d.target ? Number(d.actual || d.target) / Number(d.target) : 1) : 0])); basis = `${dels.length} deliverables`; }
  else {
    const ks = db.key_results.filter(k => k.owner_position_id === p.id);
    if (ks.length) { personal = weighted(ks.map(k => [Number(k.weight) || 1, krProgress(db, k)])); basis = `${ks.length} key results owned`; }
  }
  const R = org == null && personal == null ? null : s * (org ?? 0) + (1 - s) * (personal ?? org ?? 0);
  const hrMax = Number(db.settings.hr_scale?.max ?? 70);
  return { s, org, personal, R, basis, hr: R == null ? null : R * hrMax };
}

// ---------------- statements ----------------
export type Stmt = { label: string; plan: number; act: number | null; base: number; bold?: boolean; indent?: boolean };
export function incomeStatement(db: DB, units: string[], months: number[]): Stmt[] {
  const P = (sec: string, g?: string[]) => sum(units.map(u => planBy(db, u, sec, months, g)));
  const B = (sec: string, g?: string[]) => sum(units.map(u => planBy(db, u, sec, months, g, true)));
  const A = (sec: string, g?: string[]) => { const v = units.map(u => actualBy(db, u, sec, months, g)); return v.every(x => x == null) ? null : sum(v); };
  const groups = (sec: string) => Array.from(new Set(units.flatMap(u => linesOf(db, u, sec).map(l => l.line_group || 'Other'))));
  const rows: Stmt[] = [];
  const revG = groups('rev');
  revG.forEach(g => rows.push({ label: g, plan: P('rev', [g]), act: A('rev', [g]), base: B('rev', [g]), indent: true }));
  const rev = { label: 'Revenue', plan: P('rev'), act: A('rev'), base: B('rev'), bold: true }; rows.push(rev);
  const cos = { label: 'Cost of sales', plan: P('cos'), act: A('cos'), base: B('cos') }; rows.push(cos);
  const gp = { label: 'Gross profit', plan: rev.plan - cos.plan, act: rev.act == null && cos.act == null ? null : (rev.act || 0) - (cos.act || 0), base: rev.base - cos.base, bold: true }; rows.push(gp);
  groups('opex').forEach(g => rows.push({ label: g, plan: P('opex', [g]), act: A('opex', [g]), base: B('opex', [g]), indent: true }));
  const opex = { label: 'Operating expenses', plan: P('opex'), act: A('opex'), base: B('opex') }; rows.push(opex);
  rows.push({ label: 'Operating profit', plan: gp.plan - opex.plan, act: gp.act == null && opex.act == null ? null : (gp.act || 0) - (opex.act || 0), base: gp.base - opex.base, bold: true });
  return rows;
}
export function cashFlow(db: DB, units: string[]) {
  const items = db.cash_items.filter(c => units.includes(c.unit_id));
  const val = (id: string, m: number, k: 'plan' | 'actual') => { const v = db.cash_values.find(x => x.item_id === id && x.month === m); return v && v[k] != null ? Number(v[k]) : null; };
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const opening = { plan: sum(items.filter(i => i.direction === 'opening').map(i => val(i.id, 1, 'plan'))), actual: sum(items.filter(i => i.direction === 'opening').map(i => val(i.id, 1, 'actual'))) };
  const flows = (dir: string, k: 'plan' | 'actual') => months.map(m => { const v = items.filter(i => i.direction === dir).map(i => val(i.id, m, k)); return v.every(x => x == null) ? null : sum(v); });
  const res: any = { items: items.filter(i => i.direction !== 'opening'), val, opening };
  (['plan', 'actual'] as const).forEach(k => {
    const inn = flows('in', k), out = flows('out', k);
    let bal = opening[k]; const close: (number | null)[] = [];
    months.forEach(m => { if (k === 'actual' && inn[m - 1] == null && out[m - 1] == null) { close.push(null); return; } bal += (inn[m - 1] || 0) - (out[m - 1] || 0); close.push(bal); });
    res[k] = { inn, out, close };
  });
  return res;
}

// ---------------- resources waterline ----------------
export function needsFor(db: DB, unit: string, q: number) {
  const ms = qMonths(q);
  const keys = new Map<string, { key: string; sec: string; grp: string; amount: number; must: boolean }>();
  for (const l of linesOf(db, unit)) {
    if (!['cos', 'opex', 'capex', 'proj'].includes(l.section)) continue;
    const key = `${l.section}|${l.line_group || 'Other'}`;
    const a = sum(ms.map(m => lineVals(l)[m - 1]));
    const cur = keys.get(key) || { key, sec: l.section, grp: l.line_group || 'Other', amount: 0, must: false };
    cur.amount += a; cur.must = cur.must || !!l.must_pay || l.section === 'opex';
    keys.set(key, cur);
  }
  const rank = (k: string) => db.need_priority.find(n => n.unit_id === unit && n.need_key === k)?.rank ?? 999;
  const list = Array.from(keys.values()).filter(n => n.amount > 0).sort((a, b) => (Number(b.must) - Number(a.must)) || rank(a.key) - rank(b.key));
  const f = db.funds.find(x => x.unit_id === unit && x.quarter === q) || { confirmed: 0, expected: 0 };
  let run = 0;
  return { funds: f, list: list.map(n => { run += n.amount; const tier = run <= Number(f.confirmed) ? 'Funded' : run <= Number(f.confirmed) + Number(f.expected) ? 'Conditional' : 'Backlog'; return { ...n, cum: run, tier, rank: rank(n.key) }; }) };
}
