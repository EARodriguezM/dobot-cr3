#!/usr/bin/env node
// Standalone lab heartbeat for the lab computer (Raspberry Pi). Reports
// liveness straight to the platform database every ~30 s — never through the
// hub app, so a hub outage cannot black out the labs. Run it as a systemd
// service next to the hardware bridges.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, LAB_SLUG, LAB_HEARTBEAT_SECRET
// (the secret is set by a project admin via the set_lab_heartbeat_secret RPC).

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const slug = process.env.LAB_SLUG;
const secret = process.env.LAB_HEARTBEAT_SECRET;

if (!url || !anonKey || !slug || !secret) {
  console.error(
    "heartbeat: missing env (SUPABASE_URL, SUPABASE_ANON_KEY, LAB_SLUG, LAB_HEARTBEAT_SECRET)",
  );
  process.exit(1);
}

async function beat() {
  try {
    const res = await fetch(`${url}/rest/v1/rpc/lab_heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ p_slug: slug, p_secret: secret }),
      signal: AbortSignal.timeout(10_000),
    });
    const ok = res.ok ? await res.json() : false;
    if (ok !== true) {
      console.warn(`heartbeat: rejected (http ${res.status}, accepted=${ok})`);
    }
  } catch (e) {
    // Best-effort by contract: log and keep beating.
    console.warn(`heartbeat: ${e instanceof Error ? e.message : e}`);
  }
}

await beat();
setInterval(beat, 30_000);
