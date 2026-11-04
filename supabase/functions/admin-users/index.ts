// Sign-in help for people who struggle to sign in: Group Strategy or the system admin sets a temporary password
// for a position's company email (creating the account if there is none), confirms the email, links the position,
// and the person must choose their own password at first sign-in.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

function tempPassword() {
  const letters = "ABCDEFGHJKMNPQRSTUVWXYZ", lower = "abcdefghjkmnpqrstuvwxyz", digits = "23456789";
  const r = (s: string) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  return "Wbg-" + r(letters) + r(lower) + r(lower) + r(lower) + "-" + r(digits) + r(digits) + r(digits) + r(digits);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: ok, error: e1 } = await caller.rpc("is_group_admin");
    if (e1 || !ok) return json({ error: "Only Group Strategy or the system admin can set temporary passwords." }, 403);

    const { position_id } = await req.json();
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: pos } = await admin.from("positions").select("id, email, holder_name, user_id").eq("id", position_id).single();
    if (!pos?.email) return json({ error: "This position has no company email. Add the email first (People & access)." }, 400);
    const email = String(pos.email).trim().toLowerCase();

    let user: any = null;
    for (let page = 1; page < 20 && !user; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      user = data.users.find((u) => (u.email || "").toLowerCase() === email) || null;
      if (data.users.length < 200) break;
    }
    const password = tempPassword(); let created = false;
    if (user) {
      const { error } = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true, user_metadata: { ...(user.user_metadata || {}), must_change_password: true } });
      if (error) throw error;
    } else {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: pos.holder_name, must_change_password: true } });
      if (error) throw error; user = data.user; created = true;
    }
    await admin.from("profiles").upsert({ id: user.id, email, full_name: pos.holder_name }, { onConflict: "id", ignoreDuplicates: true });
    await admin.from("positions").update({ user_id: user.id }).eq("id", pos.id).is("user_id", null);
    return json({ email, password, created });
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
