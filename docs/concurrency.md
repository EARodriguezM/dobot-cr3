# Concurrency — one operator, many viewers

N concurrent viewers, **one active controller** (PLATFORM-GUIDE §2.3). This is
the part of the lab that makes it a shared instrument rather than a
single-user machine, so it is worth being precise about what each person can
see and do.

| Can | viewer | operator | admin / owner |
| --- | --- | --- | --- |
| Video, telemetry, 3D model | ✔ | ✔ | ✔ |
| See who is driving and what they command | ✔ | ✔ | ✔ |
| Queue for control | — | ✔ | ✔ |
| Drive the arm | — | while holding the lease | while holding the lease |
| Emergency stop | — | **always** | **always** |
| Take control from a live holder | — | — | ✔ |
| Edit programs and the camera wall | — | ✔ | ✔ |
| Lab settings, roles | — | — | ✔ |

## The lease

Control is a lease with a **15 s TTL** (`LEASE_TTL_MS`), held in Redis
(`REDIS_URL`) or in memory when Redis is absent — identical semantics,
implemented once and shared by both backends.

- `POST /api/control/take` — grant if free and nobody queued ahead; otherwise
  join the wait queue and return the position.
- `POST /api/control/heartbeat` — every 5 s from the client. The holder extends
  the TTL; a waiting client refreshes its queue slot (30 s TTL) and
  **automatically inherits the lease** when it heads the queue and the lease is
  free.
- `POST /api/control/release` — voluntary release, or leave the queue.
- `POST /api/control/force` — admins and the owner only. A lease is held by a
  browser and browsers get left open; an arm parked by someone who went to
  lunch would otherwise block the lab until their tab stopped beating.

Stop heartbeating — crash, tab close, network loss — and the lease expires by
itself within 15 s. Nothing has to notice, and nothing has to be revoked.

## Reaching the hardware with it

The lease lives in Redis, on Cloudflare. The hardware is on a Raspberry Pi
behind an outbound-only tunnel and cannot see Redis at all. So "I hold the
lease" travels to the edge as a **short-lived signed token**:

```text
take/heartbeat ──► lease token (HS256, 20 s, bound to user + lab slug)
                        │
                        ▼  sent on the WebSocket, refreshed every heartbeat
              edge gatekeeper verifies it before relaying any motion command
```

The token is minted with `LAB_CONTROL_SIGNING_SECRET`, shared only between this
app and the gatekeeper. Its lifetime is the safety property: when a lease
expires, the token stops being reissued and the hardware stops accepting motion
within one token lifetime — no revocation message has to arrive for the arm to
become safe. With the secret unset the app cannot mint tokens at all, and the
lab is view-only rather than open.

## Emergency stop

`POST /api/control/estop` and the `/weblab/estop` service both require the
**operator role only, never the lease**. Any operator can stop the hardware
while somebody else drives. There are deliberately two independent paths — the
operator's own WebSocket straight to the edge, and a server-to-server call from
this app — because a wedged socket must not be able to leave an arm moving with
no way to stop it. Do not "fix" either by adding a lease check.

The lab computer stops on its own too: the weblab node halts a jog after 1 s of
silence, well before the lease expires.

## What spectators see

A spectator who can only see joint angles cannot tell a deliberate move from a
fault, nor who is responsible. Three streams answer that, and every connected
person receives all three regardless of role:

1. **Telemetry** — joints, TCP pose, enabled state, speed, and the running
   program's step counter. Published once by the weblab node and fanned out by
   `foxglove_bridge`.
2. **Activity** — every command the gatekeeper accepts, broadcast to all
   sessions with the name of whoever issued it. It is a log of commands
   *dispatched*, not of completed motions: a command ROS later rejects still
   appears. Telemetry is what says the arm actually moved.
3. **Presence and lease state** — `GET /api/control/state`, an SSE stream.
   Connecting registers the client in the presence list; closing removes it.
   Every mutation publishes through the store's Pub/Sub, and a 5 s keepalive
   re-read catches silent lease expiries.

## Authorization

Two independent gates, and they do not trust each other:

- **This app** resolves the session from cookies and the role from the lab's
  project (`owner_id` / `project_members`), then decides whether to grant a
  lease and mint a token.
- **The edge gatekeeper** verifies the Supabase token itself against the
  platform's public keys and reads the role from the `project_roles` JWT claim,
  then applies its own allowlist. It would refuse a forged lease token from a
  compromised web tier, and it holds no database credential of its own.

The UI's disabled buttons are cosmetic. With Supabase unconfigured the app runs
in demo mode: a local pseudo-user with operator affordances, mock telemetry, no
hardware.

## Verifying it

```bash
node --experimental-strip-types scripts/test-control-lease.mjs
REDIS_URL=redis://localhost:6379 \
  node --experimental-strip-types scripts/test-control-lease.mjs
```

Covers: a second operator is queued rather than granted; a holder that stops
heartbeating loses control within the TTL; the next in line inherits it on
their own heartbeat; force displaces a live holder and the displaced holder
does not reclaim it on their next beat; e-stop is recorded from someone holding
nothing; and every mutation reaches a subscriber. Both backends must pass
identically.

The edge half is covered by `edge/gateway/tests/` — in particular that a viewer
who does nothing still receives the operator's commands, and that a viewer's
own command is refused and never reaches ROS.
