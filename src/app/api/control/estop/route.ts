import { NextResponse } from "next/server";
import { getControlStore } from "@/lib/control/store";
import { requireControlUser, requireOperate } from "@/lib/control/auth";
import { getControlUrl, getLabSlug } from "@/lib/lab";

// Emergency stop. Deliberately requires only the operator role, NOT the
// control lease: any operator can stop the hardware while someone else
// drives. Do not "fix" this by adding a lease check.
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
  if (controlUrl) {
    try {
      await fetch(`${controlUrl}/api/estop`, {
        method: "POST",
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // Hardware unreachable: the tunnel-side watchdog owns physical safety.
    }
  }

  return NextResponse.json({ ok: true });
}
