import { NextResponse } from "next/server";
import { getControlStore, type ControlState } from "@/lib/control/store";
import { requireControlUser } from "@/lib/control/auth";
import { getLabSlug } from "@/lib/lab";

export const dynamic = "force-dynamic";

// Server-Sent Events stream of the control state (holder, queue, presence,
// e-stop). Connecting registers the client in the presence list; closing the
// stream removes it. Spectators get every mutation via the store's Pub/Sub
// plus a 5 s re-read that catches silent lease expiries.
//
// Frames are only written when the state actually differs from the last one
// sent. The periodic re-read exists to notice expiries, not to talk: without
// this check every viewer would be handed an identical state object every 5 s
// and re-render their whole console on it.
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
      let lastSent: string | null = null;

      const send = (state: ControlState) => {
        const frame = JSON.stringify(state);
        if (frame === lastSent) return;
        lastSent = frame;
        try {
          controller.enqueue(encoder.encode(`data: ${frame}\n\n`));
        } catch {
          // Stream already closed.
        }
      };

      // A comment frame keeps the tunnel and any intermediary from closing an
      // idle stream without waking the client's EventSource handler.
      const ping = () => {
        try {
          controller.enqueue(encoder.encode(": ka\n\n"));
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
        ping();
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
