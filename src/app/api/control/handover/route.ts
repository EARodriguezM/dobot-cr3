import { NextResponse } from "next/server";
import { getControlStore } from "@/lib/control/store";
import { requireControlUser, requireOperate } from "@/lib/control/auth";
import { getLabSlug } from "@/lib/lab";

// Passing control between two operators who are both entitled to drive.
//
// Three actions on one route because they are one conversation: ask, then the
// holder accepts or declines. It is deliberately not the same thing as the
// queue (which waits for a lease to lapse) or an admin force (which takes it
// without asking) — this is the path where the person currently driving agrees
// to stop.
//
// Handing over moves the lease in a single step, so there is no moment where
// both people hold it and none where neither does. The outgoing operator loses
// authority immediately: the state stream tells their browser it is no longer
// the holder, which drops their lease token and revokes it at the edge on the
// spot, and their next heartbeat returns no replacement.
export async function POST(request: Request) {
  const auth = await requireControlUser();
  if (auth instanceof NextResponse) return auth;
  const denied = requireOperate(auth);
  if (denied) return denied;

  let body: { action?: string; userId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "malformed body" }, { status: 400 });
  }

  const store = await getControlStore();
  const lab = getLabSlug();

  switch (body.action) {
    case "request": {
      const ok = await store.requestHandover(lab, auth.user);
      return NextResponse.json({ ok });
    }
    case "accept": {
      const target = String(body.userId ?? "");
      // The store checks that the caller really is the holder; passing the id
      // here rather than trusting the client's word about who is driving.
      const moved = await store.acceptHandover(lab, auth.user.id, target);
      return NextResponse.json({ ok: moved });
    }
    case "decline": {
      const ok = await store.declineHandover(
        lab,
        auth.user.id,
        String(body.userId ?? ""),
      );
      return NextResponse.json({ ok });
    }
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}
