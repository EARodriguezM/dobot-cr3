# Concurrency model

N concurrent viewers, **one active controller**. Implemented in `src/lib/control/` and `src/app/api/control/`.

## The lease

Control of the hardware is a lease with a **15 s TTL**
(`LEASE_TTL_MS`), stored in Redis (`REDIS_URL`) or in-memory (single
instance) when Redis is absent — the semantics are identical, implemented
once and shared by both backends.

- `POST /api/control/take` — grant if free and nobody queued ahead;
  otherwise join the wait queue (position returned).
- `POST /api/control/heartbeat` — every 5 s from the client. The holder
  extends the TTL; a waiting client refreshes its queue slot (30 s TTL) and
  **automatically inherits the lease** when it heads the queue and the lease
  is free. Stop heartbeating — crash, tab close, network loss — and the
  lease expires by itself within 15 s; verified end-to-end at ~15.2 s.
- `POST /api/control/release` — voluntary release / leave the queue.

## E-stop

`POST /api/control/estop` requires the **operator role only, never the
lease** — any operator can stop the hardware while someone else drives. The
event is broadcast to every client and forwarded best-effort to the
hardware backend (`{CONTROL_URL}/api/estop`). Do not "fix" this by adding a
lease check.

## Spectators

`GET /api/control/state` is an SSE stream: connecting registers the client
in the presence list, closing removes it. Every mutation publishes the new
state through the store's Pub/Sub (Redis channel per lab), and a 5 s
keepalive re-read catches silent lease expiries. The edge hardware
publishes telemetry once; fan-out to spectators happens here, not on the
Pi.

## Authorization

Every endpoint resolves the session server-side (`@supabase/ssr` cookies)
and the role from the lab's project (owner / `project_members`). Take,
heartbeat and e-stop require `operator|admin|owner`; the state stream
accepts any authenticated user. With Supabase unconfigured the app runs in
demo mode: a local pseudo-user with operator rights, mock telemetry, no
hardware.
