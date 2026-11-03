/* Calculation rules (requirements doc §6), version 2.
   Everything is measured for a PERIOD — a month, quarter, half or the year — against that
   period's target. Status is judged on pace: what share of the period has passed. */
import type { DB, Row } from './data';

export const FY = '2026/27';
// ---------------- fiscal calendar ----------------
// FY starts 8 July (Hamle 1). Months carry Gregorian names but start on the Ethiopian month.
export const MONTHS = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
export function fyStartYear(fy: string) { return parseInt(fy.slice(0, 4), 10); }
/** Start date of fiscal month m (1..13; 13 = start of the next year). */
export function monthStart(fy: string, m: number): Date {
  const y = fyStartYear(fy);
  if (m >= 13) return monthStart(`${y + 1}/${String(y + 2).slice(2)}`, 1);
  if (m === 1) return new Date(Date.UTC(y, 6, 8));
  if (m === 2) return new Date(Date.UTC(y, 7, 7));
  const mesk = new Date(Date.UTC(y, 8, (y + 1) % 4 === 0 ? 12 : 11)); // Meskerem 1
  return new Date(mesk.getTime() + (m - 3) * 30 * 864e5);
}
export function monthOf(fy: string, d: Date): number { for (let m = 12; m >= 1; m--) if (d >= monthStart(fy, m)) return m; return 1; }
export const qOfMonth = (m: number) => Math.ceil(m / 3);
export const qMonths = (q: number) => [q * 3 - 2, q * 3 - 1, q * 3];
export function ymd(d: Date) { return d.toISOString().slice(0, 10); }
/** Saturday that starts the week containing d. */
export function weekStart(d: Date) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const back = (x.getUTCDay() + 1) % 7; return new Date(x.getTime() - back * 864e5); }
/** Week number inside its fiscal month (restarts at 1 each month). */
export function weekNo(fy: string, ws: Date) { const m = monthOf(fy, new Date(ws.getTime() + 3 * 864e5)); const s = weekStart(monthStart(fy, m)); return Math.floor((ws.getTime() - s.getTime()) / (7 * 864e5)) + 1; }
export function weekLabel(ws: Date) { const m = monthOf(FY, new Date(ws.getTime() + 3 * 864e5)); return `${MONTHS[m - 1]} W${weekNo(FY, ws)}`; }
/** Weekly cut-off: Saturday 2:00 PM (East Africa time) after the week ends. */
/** Calendar rules (Studio → Configuration → Cycle). Cut-off: day after the week starts (Saturday = 7, i.e. the next Saturday) at an hour in Addis Ababa time (UTC+3). */
export const CAL = { cutoffDay: 7, cutoffHour: 14, monthClose: 9 };
export function setCalendar(c: Partial<typeof CAL> | undefined) { if (c) Object.assign(CAL, Object.fromEntries(Object.entries(c).filter(([, v]) => v != null && String(v) !== '').map(([k, v]) => [k, Number(v)]))); }
const DAYN = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
export function cutoffLabel() { const h = CAL.cutoffHour; return `${DAYN[CAL.cutoffDay % 7]} ${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'}`; }
export function cutoffOf(ws: Date) { return new Date(ws.getTime() + CAL.cutoffDay * 864e5 + (CAL.cutoffHour - 3) * 3600e3); }
export const today = () => new Date();
export const curMonth = () => { const n = today(); if (n < monthStart(FY, 1)) return 1; if (n >= monthStart(FY, 13)) return 12; return monthOf(FY, n); };

// ---------------- periods ----------------
export type PT = 'M' | 'Q' | 'H' | 'Y';
export type Period = { t: PT; n: number };
export function periodMonths(p: Period): number[] { if (p.t === 'M') return [p.n]; if (p.t === 'Q') return qMonths(p.n); if (p.t === 'H') return p.n === 1 ? [1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12]; return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]; }
export function periodLabel(p: Period) { return p.t === 'M' ? MONTHS[p.n - 1] : p.t === 'Q' ? `Q${p.n}` : p.t === 'H' ? (p.n === 1 ? 'First half' : 'Second half') : 'Year'; }
export function currentPeriod(t: PT): Period { const m = curMonth(); return { t, n: t === 'M' ? m : t === 'Q' ? qOfMonth(m) : t === 'H' ? (m <= 6 ? 1 : 2) : 1 }; }
export function periodOptions(t: PT): Period[] { const k = t === 'M' ? 12 : t === 'Q' ? 4 : t === 'H' ? 2 : 1; return Array.from({ length: k }, (_, i) => ({ t, n: i + 1 })); }
export const pkey = (p: Period) => p.t + p.n;
/** Share of the period that has passed (0 before it starts, 1 after it ends). */
export function elapsed(p: Period) { const ms = periodMonths(p); const s = monthStart(FY, ms[0]).getTime(), e = monthStart(FY, ms[ms.length - 1] + 1).getTime(); return Math.max(0, Math.min(1, (today().getTime() - s) / (e - s))); }

// ---------------- formatting ----------------
export function fmt(v: number | null | undefined, d = 0) { if (v == null || isNaN(v)) return '—'; return v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }); }
export function money(v: number | null | undefined) { if (v == null || isNaN(v)) return '—'; const a = Math.abs(v); if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M'; if (a >= 1e3) return (v / 1e3).toFixed(0) + 'K'; return v.toFixed(0); }
export function pct(v: number | null | undefined, d = 0) { return v == null || isNaN(v) ? '—' : (v * 100).toFixed(d) + '%'; }
export const sum = (a: (number | null | undefined)[]) => a.reduce<number>((s, x) => s + (x || 0), 0);
export const avg = (a: (number | null | undefined)[]) => { const v = a.filter(x => x != null) as number[]; return v.length ? sum(v) / v.length : null; };
function agg(vals: (number | null)[], how: string): number | null {
  const v = vals.filter(x => x != null) as number[]; if (!v.length) return null;
  if (how === 'sum') return sum(v); if (how === 'average') return sum(v) / v.length; if (how === 'max') return Math.max(...v); if (how === 'min') return Math.min(...v); return v[v.length - 1];
}
export const AGG_NAME: Record<string, string> = { sum: 'Adds up (total of the period)', average: 'Average of the months', latest: 'Latest value (level reached)', max: 'Highest value', min: 'Lowest value' };
export const DIR_NAME: Record<string, string> = { increase: 'Progressive — higher is better', decrease: 'Regressive — lower is better', maintain: 'Maintain — stay on target' };

// ---------------- plan maths ----------------
export function lineVals(l: any, base = false): number[] { const v = (base ? l.val0 : l.val) || l.val0 || []; return Array.from({ length: 12 }, (_, i) => Number(v[i] || 0)); }
export function lineQty(l: any, base = false): number[] { const v = (base ? l.qty0 : l.qty) || l.qty0 || []; return Array.from({ length: 12 }, (_, i) => Number(v[i] || 0)); }
export function linesOf(db: DB, unit: string, sec?: string) { return db.plan_lines.filter(l => l.unit_id === unit && (!sec || l.section === sec)); }
export function planBy(db: DB, unit: string, sec: string, months: number[], groups?: string[] | null, base = false, metric: 'value' | 'quantity' = 'value') {
  return sum(linesOf(db, unit, sec).filter(l => !groups || !groups.length || groups.includes(l.line_group)).map(l => sum(months.map(m => (metric === 'quantity' ? lineQty(l, base) : lineVals(l, base))[m - 1]))));
}
/** Actual rows: recorded per line where Finance has line figures, otherwise one figure for the whole group.
    For a group and month with line figures, any group-level figure is ignored so nothing is counted twice. */
export function actualRows(db: DB, unit: string, sec: string, months: number[], groups?: string[] | null) {
  const rows = db.actuals.filter(a => a.unit_id === unit && a.section === sec && months.includes(a.month) && (!groups || !groups.length || groups.includes(a.line_group)));
  const hasLines = new Set(rows.filter(r => r.line_id).map(r => (r.line_group || '') + '|' + r.month));
  return rows.filter(r => r.line_id || !hasLines.has((r.line_group || '') + '|' + r.month));
}
export function actualBy(db: DB, unit: string, sec: string, months: number[], groups?: string[] | null, metric: 'value' | 'quantity' = 'value') {
  const f = metric === 'quantity' ? 'qty' : 'value';
  const rows = actualRows(db, unit, sec, months, groups).filter(r => r[f] != null);
  return rows.length ? sum(rows.map(r => Number(r[f]))) : null;
}
/** Actual of one plan line (null when Finance recorded only a group figure, or nothing). */
export function lineActual(db: DB, lineId: string, months: number[], metric: 'value' | 'quantity' = 'value') {
  const f = metric === 'quantity' ? 'qty' : 'value';
  const rows = db.actuals.filter(a => a.line_id === lineId && months.includes(a.month) && a[f] != null);
  return rows.length ? sum(rows.map(r => Number(r[f]))) : null;
}
/** Whether a group's actuals for these months were recorded per line. */
export function groupHasLineActuals(db: DB, unit: string, sec: string, grp: string, months: number[]) { return db.actuals.some(a => a.unit_id === unit && a.section === sec && a.line_group === grp && a.line_id && months.includes(a.month)); }
export function lastActualMonth(db: DB, unit?: string) { let m = 0; db.actuals.forEach(a => { if ((!unit || a.unit_id === unit) && a.value != null && a.month > m) m = a.month; }); return m; }

// ---------------- key results ----------------
export function currentQ(_db?: DB) { return qOfMonth(curMonth()); }
export function lastCheckIn(db: DB, krId: string) { let best: any = null; for (const c of db.check_ins) if (c.kr_id === krId && (!best || c.created_at > best.created_at)) best = c; return best; }
export function unitOfObjective(db: DB, oid: string) { return db.objectives.find(o => o.id === oid)?.unit_id; }
/** Active key results of an objective (paused and dropped ones are kept but not scored). */
export function krsOf(db: DB, oid: string, all = false) { return db.key_results.filter(k => k.objective_id === oid && !k.retired_at && (all || (k.state || 'active') === 'active')).sort((a, b) => (a.sort || 0) - (b.sort || 0)); }
/** A deliverable counts once the manager accepts it — or once delivered, when acceptance is switched off in Studio → Configuration → Approvals. */
export const isAccepted = (db: DB, d: Row) => d.status === 'accepted' || (d.status === 'done' && db.settings.approvals?.accept_deliverables === false);
export const liveObj = (o: Row) => o.status !== 'Archived' && (o.state || 'active') === 'active';
export function childObjectives(db: DB, oid: string) { return db.objectives.filter(o => o.parent_objective_id === oid && liveObj(o)); }
/** Organisation key results of a unit (unit, department and division objectives — not archived personal ones). */
export function orgKrs(db: DB, unit: string) { return db.objectives.filter(o => o.unit_id === unit && o.level !== 'individual' && liveObj(o)).flatMap(o => krsOf(db, o.id)); }
/** The chain from an objective up to the pillar: [objective, parent…, goal, pillar]. */
export function chainUp(db: DB, o: Row): { kind: string; label: string; id: string; score?: number | null }[] {
  const out: { kind: string; label: string; id: string }[] = []; let cur: Row | undefined = o; let n = 0;
  while (cur && n < 10) { out.push({ kind: 'objective', label: cur.text, id: cur.id }); const kr: Row | null | undefined = cur.parent_kr_id ? db.key_results.find(k => k.id === cur!.parent_kr_id) : null;
    const par: Row | undefined = db.objectives.find(x => x.id === cur!.parent_objective_id) || (kr ? db.objectives.find(x => x.id === kr.objective_id) : undefined);
    if (!par) { const g = db.unit_goals.find(x => x.id === cur!.unit_goal_id); if (g) { out.push({ kind: 'goal', label: g.name, id: g.id }); const pil = db.unit_pillars.find(x => x.id === g.pillar_id); if (pil) out.push({ kind: 'pillar', label: pil.name, id: pil.id }); const gg = db.group_goals.find(x => x.id === g.group_goal_id); if (gg) out.push({ kind: 'group', label: gg.name, id: gg.id }); } }
    cur = par; n++; }
  return out;
}
const aggOf = (k: Row) => k.aggregation || (k.kr_type === 'cumulative' ? 'sum' : 'latest');
const dirOf = (k: Row) => k.direction || (k.lower_is_better ? 'decrease' : 'increase');

/** Monthly check-in values (latest check-in per month). */
export function monthlyValues(db: DB, k: Row): (number | null)[] {
  const out: (number | null)[] = Array(12).fill(null); const at: string[] = Array(12).fill('');
  for (const c of db.check_ins) { if (c.kr_id !== k.id || c.value == null) continue; const m = c.month || (c.quarter ? c.quarter * 3 : null); if (!m) continue; if (c.created_at >= at[m - 1]) { out[m - 1] = Number(c.value); at[m - 1] = c.created_at; } }
  return out;
}
/** Target for a period, from monthly, quarterly or annual targets (whichever the key result uses). */
export function krTarget(db: DB, k: Row, p: Period): number | null {
  const ms = periodMonths(p), a = aggOf(k);
  if (k.measure === 'plan') { const l = db.kr_plan_links.find(x => x.kr_id === k.id); const u = unitOfObjective(db, k.objective_id); return l && u ? planBy(db, u, l.section, ms, l.line_groups, false, l.metric) : null; }
  const mt = db.kr_month_targets.filter(t => t.kr_id === k.id);
  if (k.target_mode === 'monthly' && mt.length) { const v = ms.map(m => { const t = mt.find(x => x.month === m); return t ? Number(t.target) : null; }); return agg(v, a); }
  const qt = db.kr_targets.filter(t => t.kr_id === k.id);
  if (qt.length && k.target_mode !== 'annual') {
    const tq = (q: number) => { const t = qt.find(x => x.quarter === q); return t ? Number(t.target) : null; };
    if (p.t === 'M') { const v = tq(qOfMonth(p.n)); return v == null ? null : a === 'sum' ? v / 3 : v; }
    return agg(Array.from(new Set(ms.map(qOfMonth))).map(tq), a);
  }
  if (k.year_target == null) return null;
  const yt = Number(k.year_target), b = Number(k.baseline ?? 0);
  if (a === 'sum') return yt * ms.length / 12;
  if (a === 'latest' && dirOf(k) !== 'maintain' && k.baseline != null) return b + (yt - b) * (ms[ms.length - 1] / 12);
  return yt;
}
/** Actual for a period (null when nothing has been recorded yet). */
export function krActual(db: DB, k: Row, p: Period): number | null {
  const ms = periodMonths(p), a = aggOf(k);
  if (k.measure === 'plan') { const l = db.kr_plan_links.find(x => x.kr_id === k.id); const u = unitOfObjective(db, k.objective_id); return l && u ? actualBy(db, u, l.section, ms, l.line_groups, l.metric) : null; }
  const mv = monthlyValues(db, k);
  if (a === 'latest') { for (let m = ms[ms.length - 1]; m >= 1; m--) if (mv[m - 1] != null) return mv[m - 1]; return null; }
  return agg(ms.map(m => mv[m - 1]), a);
}
function ratioFor(k: Row, act: number | null, tgt: number | null): number | null {
  if (act == null || tgt == null) return null;
  const d = dirOf(k), a = aggOf(k), b = k.baseline != null ? Number(k.baseline) : null;
  if (d === 'maintain') { const tol = k.tolerance != null ? Number(k.tolerance) : Math.abs(tgt) * 0.05; const dev = Math.abs(act - tgt); return dev <= tol ? 1 : Math.max(0, 1 - (dev - tol) / Math.max(Math.abs(tgt), 1e-9)); }
  if (d === 'decrease') {
    if (a !== 'sum' && b != null && b !== tgt) return Math.max(0, (b - act) / (b - tgt));
    return act <= tgt ? 1 : Math.max(0, tgt / act);
  }
  if (a !== 'sum' && b != null && b !== tgt) return Math.max(0, (act - b) / (tgt - b));
  return tgt > 0 ? Math.max(0, act / tgt) : act > 0 ? 1 : 0;
}
export type KrState = { target: number | null; actual: number | null; progress: number | null; ratio: number | null; expected: number; label: string; tone: 'good' | 'warn' | 'bad' | 'none'; toDate: boolean };
/** Progress, pace and status of a key result for a period. */
export function krState(db: DB, k: Row, p: Period = currentPeriod('Q'), depth = 0): KrState {
  const ck = `k${k.id}${pkey(p)}`; if (db.cache.has(ck)) return db.cache.get(ck);
  const e = elapsed(p); const ms = periodMonths(p); let target: number | null = null, actual: number | null = null, progress: number | null = null, toDate = false;
  if (e <= 0) { const r0: KrState = { target: k.measure === 'manual' ? krTarget(db, k, p) : null, actual: null, progress: null, ratio: null, expected: 0, label: 'Not started', tone: 'none', toDate: false }; db.cache.set(ck, r0); return r0; }
  if (k.measure === 'children') {
    const kids = db.objectives.filter(o => o.parent_kr_id === k.id);
    progress = kids.length && depth < 8 ? weighted(kids.map(o => [Number(o.weight_to_parent) || 1, objScore(db, o, p, depth + 1)])) : null; toDate = true;
  } else if (k.measure === 'deliverables') {
    const cm = curMonth();
    const ds = db.deliverables.filter(d => d.key_result_id === k.id && ms.includes(d.month) && !['removed', 'transferred'].includes(d.status));
    const due = ds.filter(d => d.month <= cm);
    target = sum(ds.map(d => Number(d.weight) || 1)); actual = sum(ds.filter(d => isAccepted(db, d)).map(d => Number(d.weight) || 1));
    progress = due.length ? weighted(due.map(d => [Number(d.weight) || 1, isAccepted(db, d) ? 1 : 0])) : null; toDate = true;
  } else if (k.measure === 'plan') {
    const l = db.kr_plan_links.find(x => x.kr_id === k.id); const u = unitOfObjective(db, k.objective_id);
    if (l && u) { const last = lastActualMonth(db, u); const done = ms.filter(m => m <= last); target = planBy(db, u, l.section, ms, l.line_groups, false, l.metric); actual = done.length ? actualBy(db, u, l.section, done, l.line_groups, l.metric) : null; const t2 = done.length ? planBy(db, u, l.section, done, l.line_groups, false, l.metric) : null; progress = ratioFor(k, actual, t2); toDate = true; }
  } else { target = krTarget(db, k, p); actual = krActual(db, k, p); progress = ratioFor(k, actual, target); }
  const st = statusFor(db, progress, k.confidence, e, toDate);
  const r: KrState = { target, actual, progress, expected: e, toDate, ...st };
  db.cache.set(ck, r); return r;
}
/** Pace rule: expected progress = share of the period passed (measures that are already "to date" are compared directly). */
export function statusFor(db: DB, progress: number | null, conf: string | null | undefined, e: number, toDate = false): { label: string; tone: 'good' | 'warn' | 'bad' | 'none'; ratio: number | null } {
  const sm = db.settings.status_method || { method: 'pace', grace_pct: 15 }; const t = db.settings.status_thresholds || { on_track: 95, off_track: 70 };
  if (e <= 0) return { label: 'Not started', tone: 'none', ratio: null };
  if (progress == null) return e * 100 < Number(sm.grace_pct ?? 15) ? { label: 'Too early', tone: 'none', ratio: null } : { label: 'No update', tone: 'warn', ratio: null };
  const ratio = sm.method === 'absolute' || toDate || e >= 1 ? progress : progress / Math.max(e, 0.1);
  if (ratio * 100 < t.off_track) return { label: 'Off track', tone: 'bad', ratio };
  if (ratio * 100 < t.on_track || (conf === 'Low' && sm.low_confidence !== 'ignore')) return { label: 'Behind', tone: 'warn', ratio };
  return { label: 'On track', tone: 'good', ratio };
}
/** Backwards-compatible helpers */
export function krProgress(db: DB, k: Row, p?: Period) { return krState(db, k, p).progress; }
export function statusOf(p: number | null, conf: string | null | undefined, db: DB): [string, 'good' | 'warn' | 'bad' | 'none'] { const s = statusFor(db, p, conf, 1, true); return [s.label, s.tone]; }
export function bandOf(p: number | null, db: DB) { if (p == null) return '—'; const bands = (db.settings.bands || []) as { name: string; min: number }[]; for (const b of bands) if (p * 100 >= b.min) return b.name; return bands.length ? bands[bands.length - 1].name : '—'; }
export function weighted(items: [number, number | null][]) { const ok = items.filter(x => x[1] != null) as [number, number][]; if (!ok.length) return null; const w = sum(ok.map(x => x[0])); return w ? sum(ok.map(x => x[0] * Math.min(1, x[1]))) / w : null; }

// ---------------- objectives, organisation, people ----------------
/** Objective score = Σ w·min(progress,1) / Σ w for the period; an objective with no key results takes its children's weighted score. */
export function objScore(db: DB, o: Row, p: Period = currentPeriod('Q'), depth = 0): number | null {
  const ck = `o${o.id}${pkey(p)}`; if (db.cache.has(ck)) return db.cache.get(ck);
  let v: number | null; const ks = krsOf(db, o.id); const kids = depth < 8 ? childObjectives(db, o.id).filter(c => c.level !== 'individual') : [];
  const own = ks.length ? weighted(ks.map(k => [Number(k.weight) || 1, krState(db, k, p, depth).progress])) : null;
  const below = kids.length ? weighted(kids.map(c => [Number(c.weight_to_parent) || 1, objScore(db, c, p, depth + 1)])) : null;
  // An objective with both its own key results and objectives below blends them by its "own share" (default 50%).
  if (own != null && below != null) { const w = ownShare(db, o) / 100; v = w * own + (1 - w) * below; } else v = own ?? below;
  db.cache.set(ck, v); return v;
}
/** Share (%) of an objective's score taken from its own key results when it also has objectives below it.
    Set per objective by its owner; until set, the default for its level from Studio → Configuration → Scoring. */
export function ownShare(db: DB, o: Row) { if (o.own_weight != null && o.own_weight !== '') return Number(o.own_weight); const d = db.settings.own_share || {}; return Number(d[o.level] ?? d.default ?? 50); }
export function objState(db: DB, o: Row, p: Period = currentPeriod('Q')) { const ks = krsOf(db, o.id); const toDate = ks.length > 0 && ks.every(k => k.measure !== 'manual'); return statusFor(db, objScore(db, o, p), null, elapsed(p), toDate); }
/** Organisation score = average of its own objectives; a level with none takes the level above. */
export function orgScore(db: DB, orgId: string | null | undefined, p: Period = currentPeriod('Q'), depth = 0): number | null {
  if (!orgId || depth > 6) return null;
  const ck = `g${orgId}${pkey(p)}`; if (db.cache.has(ck)) return db.cache.get(ck);
  const vals = db.objectives.filter(o => o.org_unit_id === orgId && o.level !== 'individual' && liveObj(o)).map(o => objScore(db, o, p)).filter(v => v != null) as number[];
  let v: number | null = vals.length ? sum(vals) / vals.length : null;
  if (v == null) { const org = db.org_units.find(u => u.id === orgId); v = org ? orgScore(db, org.parent_id, p, depth + 1) : null; }
  db.cache.set(ck, v); return v;
}
/** Score from the org unit's own objectives only (null when it has none with data). */
export const isOrgObj = (o: Row) => o.level !== 'individual' && o.status !== 'Archived';
export function orgScoreOwn(db: DB, orgId: string, p: Period = currentPeriod('Q')) { return avg(db.objectives.filter(o => o.org_unit_id === orgId && isOrgObj(o) && liveObj(o)).map(o => objScore(db, o, p))); }
/** Whole-subtree score (unit with all its departments and divisions) — used for rankings. */
export function subtreeIds(db: DB, id: string) { const ids = new Set<string>([id]); let grew = true; while (grew) { grew = false; db.org_units.forEach(u => { if (u.parent_id && ids.has(u.parent_id) && !ids.has(u.id)) { ids.add(u.id); grew = true; } }); } return ids; }
export function orgShare(db: DB, level: string) { const w = db.settings.org_weights || { unit: 70, department: 60, division: 50, employee: 30 }; return Number(w[level === 'group' ? 'unit' : level] ?? 30) / 100; }
export function delivScore(db: DB, posIds: Set<string>, p: Period) {
  const ms = periodMonths(p), cm = curMonth();
  const ds = db.deliverables.filter(d => posIds.has(d.owner_position_id) && ms.includes(d.month) && !['removed', 'transferred'].includes(d.status));
  const due = ds.filter(d => d.month <= cm);
  return { total: ds.length, due: due.length, accepted: ds.filter(d => isAccepted(db, d)).length, done: ds.filter(d => d.status === 'done' && !isAccepted(db, d)).length, score: due.length ? weighted(due.map(d => [Number(d.weight) || 1, isAccepted(db, d) ? (d.rating ? Math.min(1, 0.6 + d.rating * 0.1) : 1) : 0])) : null };
}
/** The agreed scorecard for the quarter a period falls in (if any). */
export function scorecardFor(db: DB, posId: string, p: Period) {
  const q = p.t === 'Q' ? p.n : p.t === 'M' ? qOfMonth(p.n) : null; if (!q) return null;
  return db.scorecards.find(s => s.position_id === posId && s.quarter === q && s.status === 'Agreed') || null;
}
/** Person result R = s·S_org + (1−s)·personal, for the period. Personal part: agreed scorecard → deliverables → own objectives and key results. */
/** How a person's result is built, per level (Studio → Configuration → Scoring).
    source: 'led' = the organisation the position heads (unit head → unit, department head → department, division head → division);
    'own' = the department or division the person sits in; 'unit' = the whole business unit; 'none' = personal work only. */
export function resultRule(db: DB, level: string): { share: number; source: 'led' | 'own' | 'unit' | 'none' } {
  const rr = db.settings.result_rules || {}; const lv = level === 'group' ? 'unit' : level;
  const def = { unit: { share: 70, source: 'led' }, department: { share: 60, source: 'led' }, division: { share: 50, source: 'led' }, employee: { share: 0, source: 'none' } } as any;
  const legacy = lv !== 'employee' ? db.settings.org_weights?.[lv] : null; const r = { ...(def[lv] || def.employee), ...(legacy != null ? { share: Number(legacy) } : {}), ...(rr[lv] || {}) };
  return { share: Number(r.share), source: r.source };
}
const LEVEL_WORD: Record<string, string> = { unit: 'Unit', department: 'Department', division: 'Division' };
/** The organisation part of a person's result: which organisation, its score and a label for it. */
export function orgPartOf(db: DB, pos: Row, p: Period) {
  const rule = resultRule(db, pos.level); const org = byIdC(db.org_units, pos.org_unit_id);
  if (rule.source === 'none' || !org) return { rule, orgId: null as string | null, score: null as number | null, label: 'Personal work only' };
  if (rule.source === 'unit') { const u = byIdC(db.org_units, pos.unit_id) || org; return { rule, orgId: u.id, score: orgScore(db, u.id, p), label: `Unit performance · ${u.name}` }; }
  if (rule.source === 'led' && pos.level !== 'employee') return { rule, orgId: org.id, score: orgScoreOwn(db, org.id, p), label: `${LEVEL_WORD[org.kind] || 'Organisation'} performance · ${org.name}` };
  return { rule, orgId: org.id, score: orgScore(db, org.id, p), label: `${LEVEL_WORD[org.kind] || 'Organisation'} performance · ${org.name}` };
}
const byIdC = (rows: Row[], id: any) => rows.find(r => r.id === id);
/** Person result R = share × organisation part + (1 − share) × personal part, for the period.
    Organisation part: the organisation the person leads (heads) or sits in, per the level's rule. Personal part: agreed scorecard → deliverables → key results owned. */
export function personResult(db: DB, pos: Row, p: Period = currentPeriod('Q')) {
  const op = orgPartOf(db, pos, p); const s = op.rule.source === 'none' ? 0 : op.rule.share / 100; const org = op.score;
  if (pos.status === 'Vacant') return { s, org, personal: null as number | null, R: null as number | null, basis: 'Vacant position', hr: null as number | null, orgLabel: op.label };
  let personal: number | null = null, basis = '';
  const sc = scorecardFor(db, pos.id, p);
  if (sc) {
    const items = db.scorecard_items.filter(i => i.scorecard_id === sc.id);
    personal = weighted(items.map(i => { const w = Number(i.weight) || 1; if (i.item_type === 'kr') { const k = db.key_results.find(x => x.id === i.item_id); return [w, k ? krState(db, k, p).progress : null]; }
      const d = db.deliverables.find(x => x.id === i.item_id); if (!d || (p.t === 'M' && d.month !== p.n) || d.month > curMonth()) return [w, null]; return [w, isAccepted(db, d) ? (d.rating ? Math.min(1, 0.6 + d.rating * 0.1) : 1) : 0]; }));
    basis = `Agreed scorecard · ${items.length} items`;
  }
  if (personal == null) { const d = delivScore(db, new Set([pos.id]), p); personal = d.score; if (d.total) basis = `${d.accepted}/${d.due} due deliverables accepted`; }
  if (personal == null) {
    const own = db.objectives.filter(o => o.owner_position_id === pos.id && o.level === 'individual' && o.status !== 'Archived');
    const ks = db.key_results.filter(k => k.owner_position_id === pos.id && (k.state || 'active') === 'active' && !own.some(o => o.id === k.objective_id) && db.objectives.some(o => o.id === k.objective_id && o.status !== 'Archived'));
    const items: [number, number | null][] = [...own.map(o => [1, objScore(db, o, p)] as [number, number | null]), ...ks.map(k => [Number(k.weight) || 1, krState(db, k, p).progress] as [number, number | null])];
    if (items.length) { personal = weighted(items); basis = `${ks.length} key results owned`; }
  }
  if (!basis) basis = 'No personal items yet';
  const R = org == null && personal == null ? null : org == null ? personal : personal == null ? org : s * org + (1 - s) * personal;
  return { s, org, personal, R, basis, hr: R == null ? null : R * Number(db.settings.hr_scale?.max ?? 70), orgLabel: op.label };
}

/** What drives a key result: its deliverables and the weekly activities linked to them (latest week of each task). */
export function krDrivers(db: DB, krId: string) {
  const dels = db.deliverables.filter(d => d.key_result_id === krId && d.status !== 'removed');
  const delIds = new Set(dels.map(d => d.id));
  const rows = db.activities.filter(a => (a.deliverable_id && delIds.has(a.deliverable_id)) || (!a.deliverable_id && a.key_result_id === krId));
  const latest = new Map<string, Row>(); rows.forEach(a => { const key = a.code || a.id; const cur = latest.get(key); if (!cur || a.week_start > cur.week_start) latest.set(key, a); });
  const acts = Array.from(latest.values());
  const done = acts.filter(a => a.status === 'Done').length, stuck = acts.filter(a => a.status === 'Stuck' || a.status === 'Delayed').length;
  const completion = acts.length ? sum(acts.map(a => a.status === 'Done' ? 100 : Number(a.pct) || 0)) / (acts.length * 100) : null;
  const lastUpdate = rows.reduce((m, a) => (a.updated_at || a.created_at || '') > m ? (a.updated_at || a.created_at) : m, '');
  return { dels, acts, done, stuck, completion, lastUpdate, weeks: new Set(rows.map(a => a.week_start)).size };
}

// ---------------- work ----------------
export function workStats(db: DB, posIds: Set<string>, wk: string) {
  const a = db.activities.filter(x => posIds.has(x.owner_position_id) && x.week_start === wk);
  const cut = cutoffOf(new Date(wk + 'T00:00:00Z')).toISOString();
  const updated = new Set(a.filter(x => (x.updated_at || x.created_at) <= cut).map(x => x.owner_position_id));
  return { total: a.length, done: a.filter(x => x.status === 'Done').length, stuck: a.filter(x => x.status === 'Stuck').length, people: new Set(a.map(x => x.owner_position_id)).size, onTime: updated.size,
    completion: a.length ? sum(a.map(x => x.status === 'Done' ? 100 : Number(x.pct) || 0)) / (a.length * 100) : null };
}

// ---------------- statements ----------------
export type Stmt = { sec?: string; grp?: string; key?: string; label: string; plan: number; act: number | null; base: number; bold?: boolean; indent?: boolean; cost?: boolean };
const isDA = (g: string) => /depreciation|amorti/i.test(g); const isFin = (g: string) => /financ|interest|bank charge/i.test(g);
/** Income statement from the annual plan, down to net income. Tax is applied at the configured rate on positive profit before tax. */
export function incomeStatement(db: DB, units: string[], months: number[], detail = true): Stmt[] {
  const P = (sec: string, g?: string[]) => sum(units.map(u => planBy(db, u, sec, months, g)));
  const B = (sec: string, g?: string[]) => sum(units.map(u => planBy(db, u, sec, months, g, true)));
  const A = (sec: string, g?: string[]) => { const v = units.map(u => actualBy(db, u, sec, months, g)); return v.every(x => x == null) ? null : sum(v); };
  const groups = (sec: string) => Array.from(new Set(units.flatMap(u => linesOf(db, u, sec).map(l => l.line_group || 'Other'))));
  const add = (a: number | null, b: number | null, sign = 1) => a == null && b == null ? null : (a || 0) + sign * (b || 0);
  const row = (label: string, sec: string, g?: string[], extra: Partial<Stmt> = {}): Stmt => ({ label, plan: P(sec, g), act: A(sec, g), base: B(sec, g), ...extra });
  const rows: Stmt[] = [];
  if (detail) groups('rev').forEach(g => rows.push(row(g, 'rev', [g], { ...{ indent: true }, sec: 'rev', grp: g })));
  const rev = row('Revenue', 'rev', undefined, { bold: true, key: 'rev' }); rows.push(rev);
  if (detail) groups('cos').forEach(g => rows.push(row(g, 'cos', [g], { ...{ indent: true, cost: true }, sec: 'cos', grp: g })));
  const cos = row('Cost of sales', 'cos', undefined, { key: 'cos', cost: true }); rows.push(cos);
  const gp: Stmt = { key: 'gp', label: 'Gross profit', plan: rev.plan - cos.plan, act: add(rev.act, cos.act, -1), base: rev.base - cos.base, bold: true }; rows.push(gp);
  const og = groups('opex'); const opG = og.filter(g => !isDA(g) && !isFin(g)); const daG = og.filter(isDA); const finG = og.filter(isFin);
  if (detail) opG.forEach(g => rows.push(row(g, 'opex', [g], { indent: true, cost: true, sec: 'opex', grp: g })));
  const opex = opG.length ? row('Operating expenses', 'opex', opG, { key: 'opex', cost: true }) : { key: 'opex', label: 'Operating expenses', plan: 0, act: null, base: 0, cost: true }; rows.push(opex);
  const ebitda: Stmt = { key: 'ebitda', label: 'EBITDA', plan: gp.plan - opex.plan, act: add(gp.act, opex.act, -1), base: gp.base - opex.base, bold: true }; rows.push(ebitda);
  const da = daG.length ? row('Depreciation & amortisation', 'opex', daG, { key: 'da', cost: true }) : { key: 'da', label: 'Depreciation & amortisation', plan: 0, act: null, base: 0, cost: true }; rows.push(da);
  const ebit: Stmt = { key: 'ebit', label: 'Operating profit (EBIT)', plan: ebitda.plan - da.plan, act: add(ebitda.act, da.act, -1), base: ebitda.base - da.base, bold: true }; rows.push(ebit);
  const fin = finG.length ? row('Interest & financial charges', 'opex', finG, { key: 'fin', cost: true }) : { key: 'fin', label: 'Interest & financial charges', plan: 0, act: null, base: 0, cost: true }; rows.push(fin);
  const pbt: Stmt = { key: 'pbt', label: 'Profit before tax', plan: ebit.plan - fin.plan, act: add(ebit.act, fin.act, -1), base: ebit.base - fin.base, bold: true }; rows.push(pbt);
  const rate = Number(db.settings.tax_rate?.rate ?? 30) / 100; const tx = (v: number | null) => v == null ? null : Math.max(0, v) * rate;
  const tax: Stmt = { key: 'tax', label: `Profit tax (${Math.round(rate * 100)}%)`, plan: tx(pbt.plan)!, act: tx(pbt.act), base: tx(pbt.base)!, cost: true }; rows.push(tax);
  rows.push({ key: 'ni', label: 'Net income', plan: pbt.plan - tax.plan, act: pbt.act == null ? null : pbt.act - (tax.act || 0), base: pbt.base - tax.base, bold: true });
  return rows;
}
export const IS_KEY = (rows: Stmt[], k: string) => rows.find(r => r.key === k)!;
export function cashFlow(db: DB, units: string[]) {
  const items = db.cash_items.filter(c => units.includes(c.unit_id));
  const val = (id: string, m: number, k: 'plan' | 'actual') => { const v = db.cash_values.find(x => x.item_id === id && x.month === m); return v && v[k] != null ? Number(v[k]) : null; };
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const opening = { plan: sum(items.filter(i => i.direction === 'opening').map(i => val(i.id, 1, 'plan'))), actual: sum(items.filter(i => i.direction === 'opening').map(i => val(i.id, 1, 'actual'))) };
  const flows = (dir: string, k: 'plan' | 'actual') => months.map(m => { const v = items.filter(i => i.direction === dir).map(i => val(i.id, m, k)); return v.every(x => x == null) ? null : sum(v); });
  const res: any = { items: items.filter(i => i.direction !== 'opening'), val, opening };
  (['plan', 'actual'] as const).forEach(k => {
    const inn = flows('in', k), out = flows('out', k); let bal = opening[k]; const close: (number | null)[] = [];
    months.forEach(m => { if (k === 'actual' && inn[m - 1] == null && out[m - 1] == null) { close.push(null); return; } bal += (inn[m - 1] || 0) - (out[m - 1] || 0); close.push(bal); });
    res[k] = { inn, out, close };
  });
  // actual cash from bank positions (weekly tracker) when the unit has them
  const ca = db.cash_actual.filter(c => units.includes(c.unit_id));
  if (ca.length) {
    const byM = (m: number, f: string) => { const v = ca.filter(c => c.month === m).map(c => Number(c[f])); return v.length ? sum(v) : null; };
    res.actual = { inn: months.map(m => byM(m, 'inflow')), out: months.map(m => byM(m, 'outflow')), close: months.map(m => byM(m, 'closing')) };
    res.opening.actual = byM(1, 'opening') ?? res.opening.actual; res.actualSource = 'Bank positions from the weekly tracker';
  }
  return res;
}

// ---------------- resources waterline ----------------
/** Spending needs by line for a set of months, grouped by budget group, in payment order:
    committed lines first (the lines marked "must pay"), then groups in the unit's priority order and, inside a group, lines in their own order.
    Amounts are the plan in force — after approved rescopes — not the original baseline. */
export type NeedLine = { key: string; gkey: string; line: Row; sec: string; grp: string; amount: number; base: number; must: boolean; rank: number; grank: number; cum: number; tier: string; plan: Row | null; byMonth: number[] };
export type NeedGroup = { key: string; sec: string; grp: string; rank: number; amount: number; lines: NeedLine[]; committed: NeedLine[] };
export const NEED_SECS = ['cos', 'opex', 'capex', 'proj'];
export const PAY_PATTERN: Record<string, string> = { planned: 'As in the plan', monthly: 'Monthly (recurring)', once: 'One payment', twice: 'Two payments' };
/** Payment plan of a line for a quarter (when and how it is paid), if one was set. */
export function payPlan(db: DB, unit: string, key: string, q: number) { return db.need_plan.find(p => p.unit_id === unit && p.quarter === q && p.need_key === key) || null; }
/** What a line pays in month m: from its payment plan for that quarter, otherwise the plan in force for that month. */
export function payIn(db: DB, unit: string, l: Row, key: string, m: number) {
  const p = payPlan(db, unit, key, qOfMonth(m)); if (!p || p.pattern === 'planned') return lineVals(l)[m - 1];
  const i = (p.months || []).indexOf(m); return i < 0 ? 0 : Number(p.amounts?.[i] || 0);
}
/** Ordering mode for a unit: by budget group (groups, then lines inside each) or one list of lines across groups. */
export function needMode(db: DB, unit: string): 'group' | 'line' { return db.need_priority.find(n => n.unit_id === unit && n.need_key === '#mode')?.rank === 1 ? 'line' : 'group'; }
/** Spending needs by line for a set of months, in payment order. Committed lines ("must pay") come first.
    By group: groups in the unit's priority order and, inside a group, lines in their own order.
    By line: one priority list across all groups (e.g. two transformer lines, then three hardware lines, then …).
    Amounts follow each line's payment plan where set, otherwise the plan in force (after approved rescopes) — not the original baseline. */
export function needLines(db: DB, unit: string, months: number[], funds: { confirmed: number; expected: number }, modeArg?: 'group' | 'line') {
  const mode = modeArg || needMode(db, unit);
  const rank = (k: string, d = 999) => db.need_priority.find(n => n.unit_id === unit && n.need_key === k)?.rank ?? d;
  const groups = new Map<string, NeedGroup>();
  linesOf(db, unit).filter(l => NEED_SECS.includes(l.section)).sort((a, b) => (a.sort || 0) - (b.sort || 0)).forEach((l, i) => {
    const grp = l.line_group || 'Other', gkey = `${l.section}|${grp}`, key = `${gkey}|${l.id}`; const byMonth = months.map(m => payIn(db, unit, l, key, m)); const amount = sum(byMonth);
    const base = sum(months.map(m => lineVals(l, true)[m - 1])); if (amount <= 0 && base <= 0) return;
    const g = groups.get(gkey) || { key: gkey, sec: l.section, grp, rank: rank(gkey), amount: 0, lines: [], committed: [] };
    const n: NeedLine = { key, gkey, line: l, sec: l.section, grp, amount, base, must: !!l.must_pay, rank: rank(key, 1000 + i), grank: 0, cum: 0, tier: '', plan: payPlan(db, unit, key, qOfMonth(months[0])), byMonth };
    g.amount += amount; (n.must ? g.committed : g.lines).push(n); groups.set(gkey, g);
  });
  const list = Array.from(groups.values()).sort((a, b) => a.rank - b.rank || NEED_SECS.indexOf(a.sec) - NEED_SECS.indexOf(b.sec));
  list.forEach(g => g.lines.sort((a, b) => a.rank - b.rank));
  // the group order gives every line a default place in the across-groups list
  const byGroup = list.flatMap(g => g.lines); byGroup.forEach((n, i) => { n.grank = rank('L|' + n.key, 100000 + i); });
  const rest = mode === 'line' ? byGroup.slice().sort((a, b) => a.grank - b.grank) : byGroup;
  const order = [...list.flatMap(g => g.committed), ...rest]; let run = 0;
  order.forEach(n => { run += n.amount; n.cum = run; n.tier = n.amount <= 0 ? 'Not this period' : run <= Number(funds.confirmed) ? 'Funded' : run <= Number(funds.confirmed) + Number(funds.expected) ? 'Conditional' : 'Backlog'; });
  return { groups: list, order, rest, total: run, mode };
}
export function needsFor(db: DB, unit: string, q: number) {
  const ms = qMonths(q); const keys = new Map<string, { key: string; sec: string; grp: string; amount: number; must: boolean }>();
  for (const l of linesOf(db, unit)) {
    if (!['cos', 'opex', 'capex', 'proj'].includes(l.section)) continue;
    const key = `${l.section}|${l.line_group || 'Other'}`; const a = sum(ms.map(m => lineVals(l)[m - 1]));
    const cur = keys.get(key) || { key, sec: l.section, grp: l.line_group || 'Other', amount: 0, must: false };
    cur.amount += a; cur.must = cur.must || !!l.must_pay || l.section === 'opex'; keys.set(key, cur);
  }
  const rank = (k: string) => db.need_priority.find(n => n.unit_id === unit && n.need_key === k)?.rank ?? 999;
  const list = Array.from(keys.values()).filter(n => n.amount > 0).sort((a, b) => (Number(b.must) - Number(a.must)) || rank(a.key) - rank(b.key));
  const f = db.funds.find(x => x.unit_id === unit && x.quarter === q) || { confirmed: 0, expected: 0 };
  let run = 0;
  return { funds: f, list: list.map(n => { run += n.amount; const tier = run <= Number(f.confirmed) ? 'Funded' : run <= Number(f.confirmed) + Number(f.expected) ? 'Conditional' : 'Backlog'; return { ...n, cum: run, tier, rank: rank(n.key) }; }) };
}
