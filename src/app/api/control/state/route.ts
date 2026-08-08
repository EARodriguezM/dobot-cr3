import { NextResponse } from "next/server";
import { getControlStore, type ControlState } from "@/lib/control/store";
import { requireControlUser } from "@/lib/control/auth";
import { getLabSlug } from "@/lib/lab";

export const dynamic = "force-dynamic";

// Server-Sent Events stream of the control state (holder, queue, presence,
// e-stop). Connecting registers the client in the presence list; closing the
// stream removes it. Spectators get every mutation via the store's Pub/Sub
// plus a 5 s keepalive re-read that catches silent lease expiries.
export async function GET() {
  const auth = await requireControlUser();
  if (auth instanceof NextResponse) return auth;

  const store = await getControlStore();
  const labId = getLabSlug();
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (state: ControlState) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(state)}\n\n`),
          );
        } catch {
          // Stream already closed.
        }
      };

      await store.joinPresence(labId, auth.user);
      send(await store.state(labId));
      unsubscribe = await store.subscribe(labId, send);
      keepalive = setInterval(async () => {
        await store.joinPresence(labId, auth.user);
        send(await store.state(labId));
      }, 5000);
    },
    async cancel() {
      if (keepalive) clearInterval(keepalive);
      unsubscribe?.();
      await store.leavePresence(labId, auth.user.id);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
