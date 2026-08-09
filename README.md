# Dobot CR3 — PRIMBIO remote lab

Web interface for teleoperating the **Dobot CR3** collaborative arm at
`https://dobot-cr3.primbiolab.org`. Built from the PRIMBIO lab template, so it
inherits the platform's shared Google sign-in, per-project roles, design
system and control-lease concurrency model.

**One operator drives, everyone else watches — live.** Any number of
authenticated users can open the lab at once. Exactly one holds the control
lease at a time; every other viewer sees the same video, the same telemetry,
the same 3D pose, who is driving, and a running feed of the commands that
operator issues. See [docs/concurrency.md](docs/concurrency.md).

```text
 Browser ──────────────► dobot-cr3.primbiolab.org      UI (Cloudflare Worker,
   │  session cookie shared with primbiolab.org         always up, robot or not)
   │
   ├── /api/control/*  ─► lease, queue, presence, e-stop, activity (this app)
   │
   └── WebSocket + WebRTC ─► dobot-cr3-control.primbiolab.org   (Cloudflare
                                    │                            Tunnel)
                         ┌──────────┴───────────┐
                    gatekeeper :8766        go2rtc :1984
                    (verifies the Supabase JWT   (WebRTC video
                     + lease token, fans out      fan-out)
                     activity to all viewers)
                         │
                  foxglove_bridge :8765 ──► ROS 2 · Dobot CR3
```

Cross-repo contract: [PLATFORM-GUIDE.md](PLATFORM-GUIDE.md) — the canonical
copy lives in the hub repo; never edit this copy locally.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS v4 · Supabase (shared
platform project) · Redis (control lease) · Cloudflare Tunnel →
foxglove_bridge (ROS 2) + go2rtc (WebRTC video) on the lab computer.

## Development

```bash
git submodule update --init      # ROS 2 workspace; also feeds the 3D model
npm install
npm run dev        # http://localhost:3000
npm run typecheck  # tsc --noEmit — must be clean before committing
npm run lint
npm run build      # must succeed with and without .env.local

npm run test:lease    # control lease: one operator, N viewers, crash recovery
npm run test:gateway   # edge authorization and the program runner (needs pytest)
```

The app stays usable with no environment configured and no hardware attached:
offline banner, view-only mode, mock driver. The 3D model is generated from
the submodule into `public/robot/` on every build
(`scripts/sync-robot-assets.mjs`); without the submodule that step is skipped
and the 3D tab reports the model as unavailable.

## Docs

- [docs/concurrency.md](docs/concurrency.md) — lease, queue, e-stop, presence,
  and how spectators see what the operator is doing.
- [docs/hardware.md](docs/hardware.md) — ROS 2 graph, service map, the
  gatekeeper protocol, offline mode.
- [docs/deploy-pi.md](docs/deploy-pi.md) — tunnel, go2rtc, foxglove_bridge,
  gatekeeper and heartbeat systemd units on the lab computer.
- [docs/ros2-node.md](docs/ros2-node.md) — executor model and the
  JWT-verifying WebSocket gatekeeper.
- [edge/README.md](edge/README.md) — what runs on the lab computer and why the
  gatekeeper sits in front of everything.
- [DEPLOY.md](DEPLOY.md) — the two hostnames and how to release each half.

## Credits

Developed by the PRIMBIO research seedbed (Semillero de Investigación PRIMBIO,
Grupo de Investigación IAM-NANO, Universidad Nacional de Colombia — Sede La
Paz).
