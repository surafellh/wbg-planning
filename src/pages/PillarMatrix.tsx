import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useData, useSave, type DB, type Row } from '../lib/data';
import { sb } from '../lib/supabase';
import { fmt } from '../lib/calc';
import { Page, Cmd, Seg, NumIn, Pill } from '../lib/ui';

/** share(u,p) = 100 × size_u^α × focus(u,p) ÷ Σ over units. Every pillar column adds to exactly 100. */
export function pillarMatrix(db: DB) {
  const cfg = db.settings.pillar_contribution || {}; const alpha = Number(cfg.alpha ?? 0.5); const floorPct = Number(cfg.floor_pct ?? 2);
  const pillars = db.group_pillars.slice().sort((a, b) => a.sort - b.sort);
  const units = db.org_units.filter(u => u.kind === 'unit' && u.active !== false);
  const sizeRaw = new Map(units.map(u => [u.id, Number(db.unit_size.find(s => s.unit_id === u.id)?.size) || 0]));
  const mx = Math.max(1, ...Array.from(sizeRaw.values())); const fl = mx * floorPct / 100;
  const size = new Map(units.map(u => [u.id, Math.max(sizeRaw.get(u.id) || 0, fl)]));
  const focus = (u: string, p: string) => Number(db.pillar_focus.find(f => f.unit_id === u && f.pillar_id === p)?.focus) || 0;
  const pw = pillars.map(p => Number(p.weight) || 0); const pwT = pw.reduce((a, b) => a + b, 0) || 1;
  const share = new Map<string, number[]>(units.map(u => [u.id, []]));
  pillars.forEach(p => { const raw = units.map(u => Math.pow(size.get(u.id)!, alpha) * focus(u.id, p.id)); const t = raw.reduce((a, b) => a + b, 0);
    units.forEach((u, i) => share.get(u.id)!.push(t ? 100 * raw[i] / t : 0)); });
  const overall = new Map(units.map(u => [u.id, share.get(u.id)!.reduce((a, s, i) => a + s * pw[i] / pwT, 0)]));
  return { cfg, alpha, floorPct, pillars, units, size, sizeRaw, focus, share, overall, pw: pw.map(x => x * 100 / pwT) };
}

export function PillarMatrix() {
  const { db, setUnit, can } = useData(); const save = useSave(); const [edit, setEdit] = useState(false);
  if (!db) return null;
  const m = pillarMatrix(db); const may = can('approve');
  const setCfg = (patch: Row) => save(() => sb.from('app_settings').upsert({ key: 'pillar_contribution', value: { ...m.cfg, ...patch } }), ['app_settings'], 'Saved');
  const setFocus = (u: string, p: string, v: number | null) => save(() => sb.from('pillar_focus').upsert({ unit_id: u, pillar_id: p, focus: v ?? 0, source: 'edited' }), ['pillar_focus'], 'Focus saved');
  const setSize = (u: string, v: number | null) => save(() => sb.from('unit_size').upsert({ unit_id: u, size: v, basis: 'entered' }), ['unit_size'], 'Size saved');
  const heat = (v: number) => ({ background: v > 0 ? `color-mix(in srgb, var(--accent) ${Math.min(55, v * 1.1)}%, transparent)` : undefined });
  const groups: [string, Row[]][] = [['Business units', m.units.filter(u => u.unit_type === 'business')], ['Corporate functions', m.units.filter(u => u.unit_type !== 'business')]];
  const colSum = (pi: number) => m.units.reduce((a, u) => a + m.share.get(u.id)![pi], 0);
  const approved = !!m.cfg.approved;
  return <Page title="Pillar contribution" desc="Every unit against all seven pillars. Each pillar column adds to 100%." help={<>
    <p><b>The rule.</b> A unit's share of a pillar = (its size ^ size influence) × (its focus on that pillar), divided by the same figure added over all units. So every column adds to exactly 100 and every unit shows, however small.</p>
    <p><b>Focus</b> is the proposal for how much of a unit's work goes to each pillar (the starting values are the draft from your manager's matrix, to be reviewed). <b>Size</b> is the unit's real scale of work (planned revenue + cost; units with no size take the floor so they still appear).</p>
    <p><b>Size influence</b> 0 treats all units alike; 1 makes a unit's share fully proportional to its size. The default of 0.5 lets the large business units lead without crushing the functions.</p>
    <p><b>Overall</b> = pillar shares added with the pillar weights of the Group strategy.</p></>}>
    <div className="cmdbar">{may && <Seg value={edit ? 'e' : 'v'} options={[['v', 'View'], ['e', 'Edit focus & size']]} onChange={v => setEdit(v === 'e')} />}
      <span className="sp" /><label className="mini">Size influence <b>{Math.round(m.alpha * 100)}%</b> {may ? <input type="range" min={0} max={100} step={5} value={Math.round(m.alpha * 100)} onChange={e => setCfg({ alpha: Number(e.target.value) / 100 })} style={{ verticalAlign: 'middle', width: 140 }} /> : null}</label>
      {may && <button className={'btn sm' + (approved ? '' : ' pri')} onClick={() => setCfg({ approved: !approved })}>{approved ? 'Approved — reopen' : 'Approve this matrix'}</button>}</div>
    <p className="note" style={{ margin: '8px 0' }}>{approved ? 'Approved. Scores can use these shares.' : 'Draft proposal — focus values come from the draft matrix and have not been approved.'}</p>
    <div className="tw"><table className="t"><thead><tr><th>Unit</th>{edit && <th className="n" data-tip="Planned revenue + cost. Empty takes the floor.">Size</th>}{m.pillars.map((p, i) => <th key={p.id} className="n" data-tip={p.name}>{p.code}<div className="mini">{fmt(m.pw[i], 0)}%</div></th>)}<th className="n">Overall</th></tr></thead><tbody>
      {groups.map(([g, us]) => [<tr key={g} className="g"><td colSpan={m.pillars.length + (edit ? 3 : 2)}><b>{g}</b></td></tr>,
        ...us.slice().sort((a, b) => (m.overall.get(b.id) || 0) - (m.overall.get(a.id) || 0)).map(u => { const none = m.pillars.every(p => !m.focus(u.id, p.id));
          return <tr key={u.id}><td className="ind"><Link to="/insights/map" onClick={() => setUnit(u.id)}>{u.name}</Link>{none && <> <Pill tone="bad">no focus set</Pill></>}</td>
            {edit && <td className="n"><NumIn w={70} value={m.sizeRaw.get(u.id) || null} onChange={v => setSize(u.id, v)} /></td>}
            {m.pillars.map((p, i) => edit ? <td key={p.id} className="n"><NumIn w={46} value={m.focus(u.id, p.id)} onChange={v => setFocus(u.id, p.id, v)} /></td>
              : <td key={p.id} className="n" style={heat(m.share.get(u.id)![i])}>{fmt(m.share.get(u.id)![i], 1)}</td>)}
            <td className="n"><b>{fmt(m.overall.get(u.id) || 0, 1)}</b></td></tr>; })])}
      {!edit && <tr className="g"><td><b>Total</b></td>{m.pillars.map((p, i) => <td key={p.id} className="n"><b>{fmt(colSum(i), 1)}</b></td>)}<td className="n"><b>{fmt(Array.from(m.overall.values()).reduce((a, b) => a + b, 0), 1)}</b></td></tr>}
    </tbody></table></div>
    {edit && <p className="note" style={{ margin: '8px 0' }}>Focus values are relative within a unit (they need not add to 100). The shares are recalculated so each pillar column adds to 100. Size: leave empty if unknown.</p>}
  </Page>;
}
