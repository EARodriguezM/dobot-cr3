# PRIMBIO — remote lab template

The barebone every PRIMBIO team forks to build its own remote laboratory at
`https://<slug>.primbiolab.org`. It ships the platform plumbing so a team only
adds its hardware-specific UI and ROS 2 logic.

Cross-repo contract: [PLATFORM-GUIDE.md](PLATFORM-GUIDE.md) — the canonical
copy lives in the hub repo and every lab repo carries an identical one.
**Never edit this copy locally**; propose the change against the hub and it is
copied back verbatim.

## How a lab is deployed

Two Cloudflare-managed hostnames, because the interface has to stay up whether
or not the robot does.

```text
user ──► <slug>.primbiolab.org            UI — always live, robot or not.
              │                           With the hardware down it shows an
              │  WebSocket + WebRTC       offline banner and goes view-only.
              ▼
         <slug>-control.primbiolab.org    Cloudflare Tunnel → lab computer
              ▼                           (Raspberry Pi: ROS 2 + bridges)
        foxglove_bridge :8765 · go2rtc :1984 · hardware driver
```

**Naming rule (TLS):** free Universal SSL covers only one wildcard level, so
the control hostname is `<slug>-control.primbiolab.org` — never
`control.<slug>.primbiolab.org`, which would fail TLS.

The hardware never opens a public port. Only the outbound tunnel reaches it.

## What you inherit, and what is yours

The distinction matters: anything **shared** may not be changed by a lab team
on its own, because every other lab depends on it behaving identically.

| Shared — do not diverge | Lab-owned — shape freely |
| --- | --- |
| Google sign-in, cross-subdomain session, the `@unal.edu.co` gate | All hardware-specific UI: control panels, visualizations, 3D views |
| The database schema and RLS (labs never run migrations) | The ROS 2 workspace: drivers, bringup, message definitions |
| Per-project roles: `owner`, `admin`, `operator`, `viewer` | Camera sources and layouts, behind the shared go2rtc pipeline |
| The concurrency model — one controller, N viewers, lease-free e-stop | Extra pages, docs and tooling local to the lab |
| The liveness heartbeat and how status is derived | Your own operator/viewer role assignments |
| Design tokens in `src/app/globals.css` | |

## What the template already implements

- **Auth** — shared Google sign-in via the platform's Supabase project, session
  in cookies (never localStorage, which is per-origin and silently breaks
  cross-subdomain SSO), the request proxy at `src/proxy.ts`, and a per-lab user
  admin page scoped by RLS at `/admin/users`.
- **Concurrency** (`src/lib/control/`, `src/app/api/control/`) — the control
  lease as a 15 s TTL extended by client heartbeats, a wait queue that promotes
  automatically, a presence list, and an SSE state stream. **The emergency stop
  requires the operator role and never the lease** — any operator can stop the
  hardware while somebody else drives. Do not "fix" that.
- **Heartbeat** — `scripts/heartbeat.mjs`, and the app itself when
  `LAB_HEARTBEAT_SECRET` is set. It beats straight to Supabase every ~30 s,
  never through the hub, so a hub outage cannot black out every lab. Silent for
  90 s ⇒ shown offline everywhere.
- **Stub panels** — a go2rtc WebRTC video player and a `foxglove_bridge`
  telemetry console behind a mock driver, so the template runs with zero
  hardware. These are the two files you are expected to replace.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS v4 · Supabase (shared platform
project) · Redis (control lease + spectator fan-out) · Cloudflare Tunnel →
foxglove_bridge (ROS 2) + go2rtc (WebRTC video) on the lab computer.

## Development

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck  # tsc --noEmit — must be clean before committing
npm run lint
npm run build      # must succeed with and without .env.local
```

The app must stay usable with **no environment configured and no hardware
attached**: offline banner, view-only mode, mock driver. That is a
requirement, not a convenience — a lab whose UI dies with its robot cannot
tell anyone that the robot died.

## Environment

| Variable | Meaning |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | central Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public anon key |
| `NEXT_PUBLIC_LAB_SLUG` | which `remote_labs` row this deployment is |
| `NEXT_PUBLIC_CONTROL_URL` | `https://<slug>-control.primbiolab.org`; empty = demo mode |
| `NEXT_PUBLIC_AUTH_COOKIE_DOMAIN` | `.primbiolab.org` in production; **unset in dev** |
| `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS` | defence-in-depth mirror of the DB table |
| `REDIS_URL` | control lease + Pub/Sub; unset = in-memory, single instance |
| `LAB_HEARTBEAT_SECRET` | set only on the lab computer |

Every one of these must be safe to leave unset. `SUPABASE_SERVICE_ROLE_KEY` is
server-side only and must never reach a browser bundle.

## Forking checklist (new lab)

1. Fork this repo and pick a slug (`<slug>.primbiolab.org`).
2. Replace the metadata in `src/app/layout.tsx` and set `NEXT_PUBLIC_LAB_SLUG`.
3. Ask a platform admin to register the lab (a `projects` row and a
   `remote_labs` row) and to add your origin to the Supabase auth redirect
   allowlist.
4. Have a project admin set the heartbeat secret with
   `set_lab_heartbeat_secret(lab_id, secret)` and put the same value on the lab
   computer.
5. Replace the video and telemetry stubs with your hardware's UI; build your
   ROS 2 nodes per [docs/ros2-node.md](docs/ros2-node.md).
6. Do not touch `PLATFORM-GUIDE.md`, the design tokens, or the auth code — they
   are the shared contract.

## Docs

- [docs/concurrency.md](docs/concurrency.md) — lease, queue, e-stop, SSE
  spectator stream.
- [docs/deploy-pi.md](docs/deploy-pi.md) — tunnel, go2rtc, foxglove_bridge and
  heartbeat systemd units on the lab computer.
- [docs/ros2-node.md](docs/ros2-node.md) — executor model, callback groups, and
  the JWT-verifying WebSocket gatekeeper.
- [PLATFORM-GUIDE.md](PLATFORM-GUIDE.md) — the cross-repo contract.
