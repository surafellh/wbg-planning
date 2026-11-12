import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
/** Demo or Live: every request carries the space it belongs to; the database reads and writes only that space. Live is the default. */
export type Space = 'live' | 'demo';
export const SPACE: Space = (() => { try { const q = new URLSearchParams(location.search).get('space'); if (q === 'demo' || q === 'live') localStorage.setItem('wbg.space', q); return localStorage.getItem('wbg.space') === 'demo' ? 'demo' : 'live'; } catch { return 'live'; } })();
export function setSpace(s: Space) { try { localStorage.setItem('wbg.space', s); } catch { /* ignore */ } location.href = location.pathname.startsWith('/') ? '/today' : '/'; }
export const sb = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true }, global: { headers: { 'x-space': SPACE } } });

/** Read a whole table (pages of 1000 rows). */
export async function fetchAll(table: string, order = 'id'): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select('*').order(order).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function must<T>(p: PromiseLike<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
