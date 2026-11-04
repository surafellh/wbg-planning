import { useState } from 'react';
import { sb } from '../lib/supabase';

export default function Login({ session, onDone, temp }: { session: any; onDone?: () => void; temp?: boolean }) {
  const [mode, setMode] = useState<'in' | 'up' | 'forgot' | 'reset'>(session ? 'reset' : 'in');
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    let r: any;
    if (mode === 'in') r = await sb.auth.signInWithPassword({ email, password: pw });
    if (mode === 'up') { r = await sb.auth.signUp({ email, password: pw, options: { data: { full_name: name }, emailRedirectTo: location.origin } }); if (!r.error) setMsg(r.data.session ? 'Account created.' : 'Check your email to confirm your account, then sign in.'); }
    if (mode === 'forgot') { r = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin }); if (!r.error) setMsg('If that email has an account, a reset link is on its way.'); }
    if (mode === 'reset') { r = await sb.auth.updateUser({ password: pw, data: { must_change_password: false } }); if (!r.error) { setMsg('Password changed.'); history.replaceState(null, '', '/'); onDone?.(); } }
    if (r?.error) setMsg(r.error.message);
    setBusy(false);
  }
  const t = { in: 'Sign in', up: 'Create account', forgot: 'Reset password', reset: 'Choose a new password' }[mode];
  return <div className="login"><form className="card stack" onSubmit={go}>
    <div className="brand" style={{ padding: 0 }}><span>WBG</span>Planning &amp; Performance</div>
    <h2>{t}</h2>
    {mode === 'reset' && temp && <p className="note">You signed in with a temporary password. Choose your own password to continue (at least 6 characters).</p>}
    {mode === 'up' && <label className="f">Full name<input type="text" value={name} onChange={e => setName(e.target.value)} required /></label>}
    {mode !== 'reset' && <label className="f">Work email<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>}
    {mode !== 'forgot' && <label className="f">Password<input type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={6} value={pw} onChange={e => setPw(e.target.value)} required /></label>}
    {msg && <div className="banner">{msg}</div>}
    <button className="btn pri" disabled={busy}>{busy ? 'Please wait…' : t}</button>
    {mode !== 'reset' && <div className="row note">
      {mode !== 'in' && <button type="button" className="linkbtn" onClick={() => setMode('in')}>Sign in</button>}
      {mode !== 'up' && <button type="button" className="linkbtn" onClick={() => setMode('up')}>Create account</button>}
      {mode !== 'forgot' && <button type="button" className="linkbtn" onClick={() => setMode('forgot')}>Forgot password</button>}
    </div>}
    {mode !== 'reset' && <p className="note">First time here? Choose <b>Create account</b> with your company email — passwords from the weekly tracker do not carry over. After that, just sign in. Your access follows the position your email is on. Can't get in? Ask Corporate Planning for a temporary password.</p>}
  </form></div>;
}
