/* Spreadsheet-style grid: arrow keys, Enter / F2 to edit, type to overwrite, Tab, Delete to clear,
   paste a block copied from Excel, Ctrl+Z / Ctrl+Y undo and redo. The parent keeps the rows. */
import { useEffect, useRef, useState, type ReactNode } from 'react';

export type Col = { key: string; label: string; type?: 'text' | 'number' | 'select' | 'date' | 'ro'; options?: [string, string][]; width?: number; tip?: string; fmt?: (v: any, row: any) => ReactNode; total?: boolean; editable?: (row: any) => boolean };
type Change = { i: number; key: string; old: any; val: any };

export function Sheet({ cols, rows, onChange, onAdd, onDelete, readOnly, height, empty, footer }: {
  cols: Col[]; rows: any[]; onChange?: (i: number, key: string, v: any) => void; onAdd?: () => void; onDelete?: (i: number) => void; readOnly?: boolean; height?: number; empty?: string; footer?: ReactNode;
}) {
  const [sel, setSel] = useState<[number, number] | null>(null); const [edit, setEdit] = useState<string | null>(null);
  const undo = useRef<Change[]>([]); const redo = useRef<Change[]>([]); const box = useRef<HTMLDivElement>(null); const inp = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const can = (r: number, c: number) => !readOnly && !rows[r]?._header && cols[c].type !== 'ro' && (!cols[c].editable || cols[c].editable!(rows[r]));
  const parse = (c: Col, v: string) => c.type === 'number' ? (v.trim() === '' ? null : Number(v.replace(/[, ]/g, ''))) : v;
  const set = (i: number, key: string, val: any, rec = true) => { const old = rows[i][key]; if (old === val || (val !== null && typeof val === 'number' && isNaN(val))) return; if (rec) { undo.current.push({ i, key, old, val }); redo.current = []; } onChange?.(i, key, val); };
  const move = (dr: number, dc: number) => { if (!sel) return; let r = sel[0] + dr, c = sel[1] + dc; while (rows[r]?._header && r > 0 && r < rows.length - 1) r += dr || 1; r = Math.max(0, Math.min(rows.length - 1, r)); c = Math.max(0, Math.min(cols.length - 1, c)); setSel([r, c]); };
  const commit = () => { if (sel && edit !== null) { const c = cols[sel[1]]; set(sel[0], c.key, parse(c, edit)); } setEdit(null); };
  useEffect(() => { if (edit !== null) inp.current?.focus(); }, [edit]);
  useEffect(() => { const el = box.current?.querySelector('td.sel'); (el as HTMLElement | null)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [sel]);
  function onKey(e: React.KeyboardEvent) {
    if (!sel) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); const ch = undo.current.pop(); if (ch) { redo.current.push(ch); set(ch.i, ch.key, ch.old, false); } return; }
    if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); const ch = redo.current.pop(); if (ch) { undo.current.push(ch); set(ch.i, ch.key, ch.val, false); } return; }
    if (mod && e.key.toLowerCase() === 'c') { const v = rows[sel[0]][cols[sel[1]].key]; navigator.clipboard?.writeText(v == null ? '' : String(v)); return; }
    if (edit !== null) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); move(1, 0); } else if (e.key === 'Tab') { e.preventDefault(); commit(); move(0, e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') { setEdit(null); }
      return;
    }
    const k = e.key;
    if (k === 'ArrowDown') { e.preventDefault(); move(1, 0); } else if (k === 'ArrowUp') { e.preventDefault(); move(-1, 0); } else if (k === 'ArrowRight' || (k === 'Tab' && !e.shiftKey)) { e.preventDefault(); move(0, 1); } else if (k === 'ArrowLeft' || (k === 'Tab' && e.shiftKey)) { e.preventDefault(); move(0, -1); }
    else if ((k === 'Enter' || k === 'F2') && can(sel[0], sel[1])) { e.preventDefault(); const v = rows[sel[0]][cols[sel[1]].key]; setEdit(v == null ? '' : String(v)); }
    else if ((k === 'Delete' || k === 'Backspace') && can(sel[0], sel[1])) { e.preventDefault(); set(sel[0], cols[sel[1]].key, cols[sel[1]].type === 'number' ? null : ''); }
    else if (k.length === 1 && !mod && can(sel[0], sel[1]) && cols[sel[1]].type !== 'select') { e.preventDefault(); setEdit(k); }
  }
  function onPaste(e: React.ClipboardEvent) {
    if (!sel || readOnly || edit !== null) return; const text = e.clipboardData.getData('text'); if (!text) return; e.preventDefault();
    const lines = text.replace(/\r/g, '').split('\n').filter((l, i, a) => l !== '' || i < a.length - 1);
    lines.forEach((line, dr) => line.split('\t').forEach((v, dc) => { const r = sel[0] + dr, c = sel[1] + dc; if (r < rows.length && c < cols.length && can(r, c)) { const col = cols[c]; let val: any = parse(col, v); if (col.type === 'select' && col.options) { const o = col.options.find(([id, l]) => id === v || l.toLowerCase() === v.trim().toLowerCase()); val = o ? o[0] : rows[r][col.key]; } set(r, col.key, val); } }));
  }
  const totals = cols.map(c => c.total ? rows.filter(r => !r._header).reduce((s, r) => s + (Number(r[c.key]) || 0), 0) : null);
  return <div className="sheetwrap"><div className="sheet" ref={box} tabIndex={0} onKeyDown={onKey} onPaste={onPaste} style={height ? { maxHeight: height } : undefined}>
    <table><thead><tr><th className="rn">#</th>{cols.map(c => <th key={c.key} style={{ width: c.width }} data-tip={c.tip}>{c.label}</th>)}{onDelete && !readOnly && <th className="rn" />}</tr></thead>
      <tbody>{rows.map((r, i) => r._header ? <tr key={'h' + i} className="hdr-row"><td colSpan={cols.length + 2}>{r._header}</td></tr> : <tr key={r.id || i} className={r._dirty ? 'dirty' : ''}>
        <td className="rn">{i + 1}</td>
        {cols.map((c, j) => { const on = sel && sel[0] === i && sel[1] === j; const ed = on && edit !== null; const v = r[c.key]; const ro = !can(i, j);
          return <td key={c.key} className={(on ? 'sel ' : '') + (ro ? 'ro ' : '') + (c.type === 'number' ? 'n' : '')} onMouseDown={() => { if (!on) { commit(); setSel([i, j]); } }} onDoubleClick={() => can(i, j) && c.type !== 'select' && setEdit(v == null ? '' : String(v))}>
            {ed ? <input ref={el => { inp.current = el; }} value={edit!} onChange={e => setEdit(e.target.value)} onBlur={commit} />
              : c.type === 'select' && !ro ? <select value={v ?? ''} onChange={e => set(i, c.key, e.target.value || null)} onFocus={() => setSel([i, j])}>{<option value="">—</option>}{(c.options || []).map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select>
              : c.fmt ? c.fmt(v, r) : c.type === 'select' ? ((c.options || []).find(o => o[0] === v)?.[1] ?? '') : c.type === 'number' ? (v == null || v === '' ? '' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })) : (v ?? '')}
          </td>; })}
        {onDelete && !readOnly && <td className="rn"><button className="xdel" title="Delete row" onClick={() => onDelete(i)}>×</button></td>}
      </tr>)}
        {!rows.length && <tr><td colSpan={cols.length + 2} className="note" style={{ padding: 14 }}>{empty || 'No rows yet.'}</td></tr>}
        {totals.some(t => t != null) && <tr className="tot"><td className="rn" />{cols.map((c, j) => <td key={c.key} className={c.type === 'number' ? 'n' : ''}>{j === 0 ? 'Total' : totals[j] != null ? totals[j]!.toLocaleString('en-US', { maximumFractionDigits: 0 }) : ''}</td>)}{onDelete && !readOnly && <td />}</tr>}
      </tbody></table></div>
    <div className="sheetbar">{onAdd && !readOnly && <button className="btn sm" onClick={onAdd}>+ Row</button>}<span className="mini">Click a cell, type to fill, Enter to move down, paste a block from Excel, Ctrl+Z to undo.</span><span className="sp" />{footer}</div></div>;
}

/** Local draft of rows with dirty tracking: edit freely, then Save or Discard. */
type T = Record<string, any>;
export function useDraft(source: T[], deps: any[] = []) {
  const [rows, setRows] = useState<T[]>(source); const [dirty, setDirty] = useState<Set<number>>(new Set()); const [added, setAdded] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setRows(source); setDirty(new Set()); setAdded(0); }, deps);
  const change = (i: number, key: string, v: any) => { setRows(rs => rs.map((r, j) => j === i ? { ...r, [key]: v, _dirty: true } : r)); setDirty(d => new Set(d).add(i)); };
  const add = (row: T) => { setRows(rs => [...rs, { ...row, _dirty: true, _new: true }]); setAdded(n => n + 1); };
  const remove = (i: number) => setRows(rs => rs.map((r, j) => j === i ? { ...r, _deleted: true, _dirty: true } : r));
  const reset = () => { setRows(source); setDirty(new Set()); setAdded(0); };
  const visible = rows.filter(r => !(r as any)._deleted);
  return { rows: visible, all: rows, change: (i: number, k: string, v: any) => change(rows.indexOf(visible[i]), k, v), add, remove: (i: number) => remove(rows.indexOf(visible[i])), reset, dirty: dirty.size + added > 0 || rows.some(r => (r as any)._deleted) };
}
