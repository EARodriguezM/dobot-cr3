"use client";

import { useCallback, useEffect, useState } from "react";
import type { ControlState, ControlUser } from "./store";

// Client half of the control lease.
//
// The lease itself lives in Redis on the server; this hook is what keeps it
// alive and what turns "I hold it" into the credential the hardware will
// accept. Two things travel together on every heartbeat: the TTL extension and
// a freshly minted lease token. Stop heartbeating — close the tab, lose the
// network, crash the browser — and both stop, so the lease expires and the
// hardware stops accepting motion without anything having to be told.

const HEARTBEAT_MS = 5000;

interface TakeResponse {
  granted: boolean;
  position: number;
  leaseToken: string | null;
}

export interface ControlSession {
  state: ControlState | null;
  /** Fresh lease token while we hold control, else null. */
  leaseToken: string | null;
  iAmHolder: boolean;
  /** 0-based position in the wait queue, or -1 when not queued. */
  queuePosition: number;
  waiting: boolean;
  take: () => Promise<void>;
  force: () => Promise<void>;
  release: () => Promise<void>;
  estop: () => Promise<void>;
  /** Ask the current holder to hand control over. */
  requestHandover: () => Promise<void>;
  /** Holder only: accept or decline a pending request. */
  respondToHandover: (userId: string, accept: boolean) => Promise<void>;
  /** Operators waiting on this holder to pass control over. */
  handoverRequests: ControlUser[];
  /** True while this client is waiting for the holder to answer. */
  awaitingHandover: boolean;
}

export function useControl(userId: string | null): ControlSession {
  const [state, setState] = useState<ControlState | null>(null);
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);

  const iAmHolder = state?.holder != null && state.holder.id === userId;
  const queuePosition = state?.queue.findIndex((u) => u.id === userId) ?? -1;

  // Control state stream. Connecting also registers presence server-side, so
  // opening the page is what puts someone on the "who is watching" list.
  useEffect(() => {
    const source = new EventSource("/api/control/state");
    source.onmessage = (event) => {
      try {
        setState(JSON.parse(event.data) as ControlState);
      } catch {
        // Malformed frame: skip it rather than tearing down the stream.
      }
    };
    return () => source.close();
  }, []);

  // Heartbeat while holding or waiting. This is also the promotion mechanism:
  // a queued client that heads the queue inherits the lease on its next beat
  // and receives a token with it.
  useEffect(() => {
    if (!waiting) return;
    const beat = async () => {
      try {
        const response = await fetch("/api/control/heartbeat", {
          method: "POST",
        });
        if (!response.ok) return;
        const result = (await response.json()) as TakeResponse;
        setMintedToken(result.leaseToken);
      } catch {
        // Offline: the lease will expire on its own, which is the correct
        // outcome — no need to do anything here.
      }
    };
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [waiting]);

  // Losing the lease — to an expiry or to an admin override — must invalidate
  // the token immediately rather than at the next heartbeat, so the UI stops
  // offering controls the hardware would now refuse. Derived rather than
  // cleared, so there is no window where the two disagree.
  const leaseToken = iAmHolder ? mintedToken : null;

  const post = useCallback(async (path: string): Promise<TakeResponse | null> => {
    try {
      const response = await fetch(path, { method: "POST" });
      if (!response.ok) return null;
      return (await response.json()) as TakeResponse;
    } catch {
      return null;
    }
  }, []);

  const take = useCallback(async () => {
    setWaiting(true);
    const result = await post("/api/control/take");
    if (result) setMintedToken(result.leaseToken);
  }, [post]);

  const force = useCallback(async () => {
    setWaiting(true);
    const result = await post("/api/control/force");
    if (result) setMintedToken(result.leaseToken);
  }, [post]);

  const release = useCallback(async () => {
    setWaiting(false);
    setMintedToken(null);
    await post("/api/control/release");
  }, [post]);

  const estop = useCallback(async () => {
    await post("/api/control/estop");
  }, [post]);

  const handover = useCallback(
    async (action: string, userId?: string) => {
      try {
        await fetch("/api/control/handover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, userId }),
        });
      } catch {
        // The state stream is the source of truth; a failed ask just means the
        // request never registered, which the UI shows by not listing it.
      }
    },
    [],
  );

  const requestHandover = useCallback(async () => {
    await handover("request");
    // Waiting for control counts as wanting it, so start heartbeating: if the
    // holder simply disappears instead of answering, the queue promotes us.
    setWaiting(true);
  }, [handover]);

  const respondToHandover = useCallback(
    async (userId: string, accept: boolean) => {
      await handover(accept ? "accept" : "decline", userId);
      if (accept) {
        // We are no longer the holder; stop heartbeating so the lease is not
        // kept alive on behalf of somebody who has handed it over.
        setWaiting(false);
        setMintedToken(null);
      }
    },
    [handover],
  );

  const handoverRequests = state?.handoverRequests ?? [];
  const awaitingHandover = handoverRequests.some((u) => u.id === userId);

  return {
    state,
    leaseToken,
    iAmHolder,
    queuePosition,
    waiting,
    take,
    force,
    release,
    estop,
    requestHandover,
    respondToHandover,
    handoverRequests,
    awaitingHandover,
  };
}
