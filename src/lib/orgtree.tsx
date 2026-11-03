/* Expandable organisation rows for tables: a unit row opens to its departments, a department to its divisions. */
import { Fragment, useState, type ReactNode } from 'react';
import { byId, type DB, type Row } from './data';
import { subtreeIds, krsOf, liveObj, orgScore, orgScoreOwn, type Period } from './calc';

export function orgKids(db: DB, id: string) { return db.org_units.filter(c => c.parent_id === id && c.active !== false && c.kind !== 'unit' && c.kind !== 'group').sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name)); }
/** Organisation key results of an organisation and everything below it. */
export function subtreeKrs(db: DB, id: string) { const ids = subtreeIds(db, id); return db.objectives.filter(o => ids.has(o.org_unit_id) && o.level !== 'individual' && liveObj(o)).flatMap(o => krsOf(db, o.id)); }
/** Score shown for a row: a unit uses its cascaded score; a department or division its own objectives (null when it has none). */
export function rowScore(db: DB, id: string, p: Period) { const o = byId(db.org_units, id); return o?.kind === 'unit' ? orgScore(db, id, p) : orgScoreOwn(db, id, p); }

export function useOpen() {
  const [open, setOpen] = useState<Set<string>>(new Set());
  return { open, setOpen, tg: (id: string) => setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }) };
}
const LVL: Record<string, string> = { unit: 'Unit', department: 'Department', division: 'Division', team: 'Team' };

/** Rows for the given organisations; each with children gets a ▸ toggle. `cells` renders the remaining columns. */
export function OrgRows({ db, ids, open, tg, cells, sub, depth = 0, onRow }: { db: DB; ids: string[]; open: Set<string>; tg: (id: string) => void; cells: (o: Row, depth: number) => ReactNode; sub?: (o: Row) => ReactNode; depth?: number; onRow?: (o: Row) => void }) {
  return <>{ids.map(id => { const o = byId(db.org_units, id); if (!o) return null; const kids = orgKids(db, id); const on = open.has(id);
    return <Fragment key={id}>
      <tr className={(depth === 1 ? 'orgsub ' : depth >= 2 ? 'orgsub2 ' : '') + (onRow ? 'click' : '')} onClick={onRow ? () => onRow(o) : undefined}>
        <td>{kids.length ? <button className="tgl" aria-label={on ? 'Collapse' : 'Show departments'} onClick={e => { e.stopPropagation(); tg(id); }}>{on ? '▾' : '▸'}</button> : <span className="tgl0" />}<b style={depth ? { fontWeight: 600 } : undefined}>{o.name}</b>
          <div className="mini" style={{ marginLeft: 22 }}>{sub ? sub(o) : depth ? LVL[o.kind] || o.kind : kids.length ? `${kids.length} ${kids.length > 1 ? 'departments' : 'department'} — open to see them` : ''}</div></td>
        {cells(o, depth)}</tr>
      {on && <OrgRows db={db} ids={kids.map(k => k.id)} open={open} tg={tg} cells={cells} sub={sub} depth={depth + 1} onRow={onRow} />}
    </Fragment>; })}</>;
}
export const ExpandAll = ({ db, ids, open, setOpen }: { db: DB; ids: string[]; open: Set<string>; setOpen: (s: Set<string>) => void }) =>
  <button className="btn sm" onClick={() => setOpen(new Set(open.size ? [] : ids.flatMap(id => Array.from(subtreeIds(db, id)))))}>{open.size ? 'Collapse all' : 'Show departments'}</button>;
