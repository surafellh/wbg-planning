import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { sb } from './supabase';
import { useData, useSave, type DB } from './data';

/** Users mentioned as @Firstname or @Full Name in a text. */
export function mentionedUsers(db: DB, text: string): string[] {
  if (!text.includes('@')) return [];
  const low = text.toLowerCase(); const out = new Set<string>();
  db.positions.forEach(p => { if (!p.user_id || !p.holder_name) return; const full = p.holder_name.toLowerCase(); const first = full.split(' ')[0];
    if (low.includes('@' + full) || new RegExp('@' + first.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '\\b').test(low)) out.add(p.user_id); });
  return Array.from(out);
}

/** Comment thread used everywhere (objectives, key results, activities, deliverables). @mentions notify people. */
export function Thread({ entity, id, link, title }: { entity: string; id: string; link: string; title: string }) {
  const { db, user } = useData(); const save = useSave(); const [t, setT] = useState(''); if (!db) return null;
  const list = db.comments.filter(c => c.entity_type === entity && c.entity_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  async function post() {
    const body = t.trim(); if (!body) return;
    if (await save(() => sb.from('comments').insert({ entity_type: entity, entity_id: id, body, created_by: user.id }), ['comments'])) {
      const who = mentionedUsers(db!, body); if (who.length) await sb.rpc('notify', { user_ids: who, kind: 'mention', title: `${db!.profiles.find(p => p.id === user.id)?.full_name || 'Someone'} mentioned you: ${title}`, body, link });
      setT('');
    }
  }
  return <div className="stack" style={{ gap: 6 }}>{list.map(c => <div key={c.id} className="lg"><small>{c.created_at.slice(0, 16).replace('T', ' ')} · {db.profiles.find(p => p.id === c.created_by)?.full_name || 'someone'}</small><div>{c.body}</div></div>)}
    <div className="row"><input type="text" style={{ flex: 1 }} value={t} onChange={e => setT(e.target.value)} placeholder="Write a comment — type @name to notify someone" onKeyDown={e => { if (e.key === 'Enter') post(); }} /><button className="btn sm" disabled={!t.trim()} onClick={post}>Post</button></div></div>;
}

export function Bell() {
  const { db, reload } = useData(); const [open, setOpen] = useState(false); const nav = useNavigate(); if (!db) return null;
  const list = db.notifications.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)); const unread = list.filter(n => !n.read_at).length;
  const read = async (ids: string[]) => { if (ids.length) { await sb.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids); await reload(['notifications']); } };
  return <div style={{ position: 'relative' }}>
    <button className="bell" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} onClick={() => setOpen(!open)}>🔔{unread > 0 && <i>{unread}</i>}</button>
    {open && <div className="bellpop" role="dialog" aria-label="Notifications"><div className="row" style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)' }}><b style={{ flex: 1 }}>Notifications</b>{unread > 0 && <button className="linkbtn" onClick={() => read(list.filter(n => !n.read_at).map(n => n.id))}>Mark all read</button>}</div>
      {list.length ? list.slice(0, 30).map(n => <button key={n.id} className={'bellitem' + (n.read_at ? '' : ' unread')} onClick={() => { read([n.id]); setOpen(false); if (n.link) nav(n.link); }}><b>{n.title}</b>{n.body && <span>{n.body.slice(0, 120)}</span>}<small>{n.created_at.slice(0, 16).replace('T', ' ')}</small></button>) : <p className="note" style={{ padding: 12 }}>Nothing yet.</p>}
    </div>}
  </div>;
}
