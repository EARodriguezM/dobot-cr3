import { NextResponse } from "next/server";
import { getControlStore } from "@/lib/control/store";
import { requireControlUser, requireOperate } from "@/lib/control/auth";
import { getAccessToken, getControlUrl, getLabSlug } from "@/lib/lab";

// Emergency stop. Deliberately requires only the operator role, NOT the
// control lease: any operator can stop the hardware while someone else
// drives. Do not "fix" this by adding a lease check.
//
// This is the second of two independent paths to the same stop. The primary
// one is the operator's own WebSocket straight to the edge gatekeeper, which
// is faster; this server-side path exists because a wedged socket must not be
// able to leave the arm moving with no way to stop it.
export async function POST() {
  const auth = await requireControlUser();
  if (auth instanceof NextResponse) return auth;
  const denied = requireOperate(auth);
  if (denied) return denied;

  const store = await getControlStore();
  await store.estop(getLabSlug(), auth.user);

  // Forward to the hardware backend when one is configured; best-effort —
  // the event is already broadcast to every client either way.
  const controlUrl = getControlUrl();
  let delivered = false;
  if (controlUrl) {
    try {
      // The gatekeeper authenticates this the same way it authenticates a
      // browser: with the caller's own Supabase access token. It re-checks the
      // role itself rather than trusting this app's say-so.
      const accessToken = await getAccessToken();
      const response = await fetch(`${controlUrl}/api/estop`, {
        method: "POST",
        headers: accessToken
          ? { Authorization: `Bearer ${accessToken}` }
          : undefined,
        signal: AbortSignal.timeout(3000),
      });
      delivered = response.ok;
    } catch {
      // Hardware unreachable: the tunnel-side watchdog owns physical safety.
    }
  }

  return NextResponse.json({ ok: true, delivered });
}
