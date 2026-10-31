import { useEffect, useState } from 'react';
import { sb } from '../lib/supabase';
import { useData, useSave, byId, type Row } from '../lib/data';
import { Pill } from '../lib/ui';

const LEAD: Record<string, string> = { unit_head: 'Unit head', planning_head: 'Planning head', finance: 'Finance', dept_head: 'Department head', div_head: 'Division head' };

/** Shown to a signed-in user whose email is not on any position: they find their own position and link it. */
export function ClaimScreen() {
  const { user, reload } = useData();
  const [q, setQ] = useState(''); const [rows, setRows] = useState<Row[]>([]); const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null); const [note, setNote] = useState(''); const [mine, setMine] = useState<Row[]>([]);
  const name = (user.user_metadata?.full_name || '') as string;
  useEffect(() => { if (!q && name) setQ(name.split(' ')[0]); }, [name]);
  useEffect(() => { const t = setTimeout(async () => { if (q.trim().length < 2) { setRows([]); return; } const { data } = await sb.rpc('unlinked_positions', { q }); setRows(data || []); }, 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { sb.from('position_claims').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).then(({ data }) => setMine(data || [])); }, [user.id, msg]);
  async function claim(pid: string | null) {
    setBusy(true); setMsg(null);
    const { data, error } = await sb.rpc('claim_position', { pid, note: note.trim() || null });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    if (data === 'Linked' || data === 'already') { await reload(); return; }
    setMsg('Request sent. Group Strategy has been notified; you will get access as soon as they confirm.');
  }
  const pending = mine.find(c => c.status === 'Pending');
  return <div className="login"><div className="card stack" style={{ width: 'min(620px,100%)' }}>
    <div className="brand" style={{ padding: 0 }}><span>WBG</span>Planning</div>
    <h2>Find your position</h2>
    <p>You are signed in as <b>{user.email}</b>. Pick your position once and the app links it to your account. Team-member positions link straight away; leadership positions are confirmed by Group Strategy.</p>
    {pending && <div className="banner">Waiting for Group Strategy to confirm your request{pending.created_at ? ` (sent ${pending.created_at.slice(0, 10)})` : ''}.</div>}
    <label className="f">Your name or job title<input type="text" value={q} onChange={e => setQ(e.target.value)} autoFocus placeholder="e.g. Ataklti or Planning" /></label>
    {rows.length > 0 && <div className="tw"><table className="t"><tbody>{rows.map(r => <tr key={r.id}><td><b>{r.holder_name || 'Vacant'}</b><div className="note">{r.title} · {r.org}{r.unit && r.unit !== r.org ? ' · ' + r.unit : ''}</div></td>
      <td>{LEAD[r.role] && <Pill tone="info">{LEAD[r.role]} — needs confirmation</Pill>}</td>
      <td style={{ textAlign: 'right' }}><button className="btn sm pri" disabled={busy || !!pending} onClick={() => claim(r.id)}>This is me</button></td></tr>)}</tbody></table></div>}
    {q.trim().length >= 2 && !rows.length && <p className="note">No open position matches "{q}".</p>}
    <details><summary className="linkbtn">My position is not listed</summary>
      <div className="stack" style={{ marginTop: 8 }}><label className="f">Your unit, department and job title<textarea rows={2} value={note} onChange={e => setNote(e.target.value)} /></label>
        <div><button className="btn" disabled={busy || !note.trim() || !!pending} onClick={() => claim(null)}>Send to Group Strategy</button></div></div></details>
    {msg && <div className="banner">{msg}</div>}
    <div className="row"><span className="sp" /><button className="btn" onClick={() => sb.auth.signOut()}>Sign out</button></div>
  </div></div>;
}

/** Group Strategy: decide on people who linked themselves or asked to be linked. */
export function ClaimsPanel() {
  const { db } = useData(); const save = useSave(); const [pick, setPick] = useState<Record<string, string>>({});
  if (!db) return null;
  const list = db.position_claims.filter(c => c.status === 'Pending' || (c.status === 'Linked' && c.created_at > new Date(Date.now() - 14 * 864e5).toISOString()));
  if (!list.length) return null;
  const open = db.positions.filter(p => !p.user_id).sort((a, b) => (a.holder_name || '~').localeCompare(b.holder_name || '~'));
  const decide = (c: Row, approve: boolean) => save(() => sb.rpc('decide_claim', { cid: c.id, approve, pid: pick[c.id] || c.position_id || null }), ['position_claims', 'positions'], approve ? 'Linked' : 'Rejected');
  return <div className="card" style={{ marginBottom: 14 }}><h2>Sign-ins to confirm</h2>
    <div className="tw"><table className="t"><thead><tr><th>Person</th><th>Position chosen</th><th>Status</th><th /></tr></thead><tbody>
      {list.map(c => { const p = byId(db.positions, c.position_id); return <tr key={c.id}><td><b>{c.full_name || c.email}</b><div className="note">{c.email}</div>{c.note && <div className="note">“{c.note}”</div>}</td>
        <td>{p ? <>{p.holder_name || 'Vacant'}<div className="note">{p.title}</div></> : <select value={pick[c.id] || ''} onChange={e => setPick({ ...pick, [c.id]: e.target.value })}><option value="">Choose a position…</option>{open.map(o => <option key={o.id} value={o.id}>{(o.holder_name || 'Vacant') + ' · ' + o.title}</option>)}</select>}</td>
        <td><Pill tone={c.status === 'Linked' ? 'good' : 'warn'}>{c.status === 'Linked' ? 'Linked automatically' : 'Waiting'}</Pill></td>
        <td><div className="row">{c.status === 'Pending' && <button className="btn sm pri" disabled={!p && !pick[c.id]} onClick={() => decide(c, true)}>Confirm</button>}<button className="btn sm" onClick={() => decide(c, false)}>{c.status === 'Linked' ? 'Undo' : 'Reject'}</button></div></td></tr>; })}
    </tbody></table></div></div>;
}
