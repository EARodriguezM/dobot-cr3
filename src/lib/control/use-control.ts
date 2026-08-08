"use client";

import { useCallback, useEffect, useState } from "react";
import type { ControlState } from "./store";

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
  };
}
