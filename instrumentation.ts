// Server-start hook: when this app runs on the lab computer with a heartbeat
// secret configured, it reports liveness to the platform every ~30 s.
// Best-effort by contract: every failure is swallowed — the heartbeat must
// never interfere with hardware control. Deployments without the secret
// (e.g. the UI worker) simply never beat.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.LAB_HEARTBEAT_SECRET;
  const slug = process.env.NEXT_PUBLIC_LAB_SLUG;
  if (!url || !anonKey || !secret || !slug) return;

  const beat = async () => {
    try {
      await fetch(`${url}/rest/v1/rpc/lab_heartbeat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ p_slug: slug, p_secret: secret }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Swallowed on purpose (PLATFORM-GUIDE §2.4).
    }
  };

  void beat();
  setInterval(beat, 30_000);
}
