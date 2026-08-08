import { NextResponse } from "next/server";
import { getControlStore } from "@/lib/control/store";
import { requireControlUser, requireOperate } from "@/lib/control/auth";
import { getLabSlug } from "@/lib/lab";

// Lease heartbeat: the active controller extends the 15 s TTL; a waiting
// client refreshes its queue slot and takes over when it heads the queue and
// the lease is free. Stop heartbeating (crash, tab close) and the lease
// expires on its own.
export async function POST() {
  const auth = await requireControlUser();
  if (auth instanceof NextResponse) return auth;
  const denied = requireOperate(auth);
  if (denied) return denied;

  const store = await getControlStore();
  const result = await store.heartbeat(getLabSlug(), auth.user);
  return NextResponse.json(result);
}
