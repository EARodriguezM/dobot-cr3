# Edge — what runs on the lab computer

Everything in this directory runs on the machine wired to the Dobot CR3, not
in the browser and not on Cloudflare. It is reachable at
`https://dobot-cr3-control.primbiolab.org` through an outbound-only tunnel:
**the hardware never opens a public port.**

```text
                    dobot-cr3-control.primbiolab.org
                                 │
                          cloudflared (outbound)
                                 │  one ingress rule
                                 ▼
                     gatekeeper  :8766   ← the only door
                     ┌───────────┴────────────┐
              /ws    │                        │  /api/video/*
                     ▼                        ▼
        foxglove_bridge :8765         go2rtc :1984
         (localhost only)             (localhost only)
                     │
                weblab node  ──►  dobot_cr3_bringup  ──►  Dobot CR3
```

| Service | Port | Purpose |
|---|---|---|
| `cloudflared` | — | the only ingress; outbound tunnel |
| [`gateway/`](gateway/) | 8766 | authenticates every socket, authorizes every command, broadcasts activity, proxies video |
| `foxglove_bridge` | 8765 | ROS 2 ⇄ WebSocket. **No authentication of its own** — localhost only |
| `go2rtc` | 1984 | pulls each camera once, fans it out over WebRTC |
| [`ros2/dobot_cr3_weblab`](ros2/dobot_cr3_weblab/) | — | the vetted `/weblab/*` service surface, telemetry document, program runner, motion watchdog |
| `heartbeat` | — | reports liveness straight to the platform database |

## Why the gatekeeper is in the middle

`foxglove_bridge` will happily let anyone who reaches it call any ROS service,
including the driver's. So it is bound to localhost, and the tunnel points at
the gatekeeper instead, which:

1. requires a Supabase access token in the first WebSocket frame and verifies
   it against the platform's public keys — **no service-role key or database
   credential exists on this machine**;
2. refuses anything outside the `/weblab/*` allowlist, and within it enforces
   that stops need only the operator role while motion needs the operator role
   *and* a live control-lease token;
3. broadcasts each accepted command to every connected viewer, which is what
   lets a spectator see who is driving and what they just asked for.

See [`gateway/README.md`](gateway/README.md) and
[`gateway/primbio_gateway/policy.py`](gateway/primbio_gateway/policy.py) — the
whole authorization surface is that one file.

## Why the ROS node is in the middle

`ros2/dobot_cr3_weblab` wraps `dobot_cr3_bringup` so the browser-reachable
surface is small, named and bounds-checked: speeds are clamped, gripper travel
is clamped, and a change to the driver's interface never widens what the web
can do. It also owns two things the web tier cannot:

- **The program runner.** Teach-pendant programs are sequenced here, so they
  survive an operator's laptop closing mid-sequence, and the step counter
  reaches every spectator through telemetry.
- **The motion watchdog.** A jog is a press-and-hold; a browser that dies
  mid-press sends no release. The node stops the arm after 1 s of silence,
  well before the web tier's 15 s lease expires.

## Install

```bash
sudo useradd --system --create-home primbio
sudo git clone <this repo> /opt/dobot-cr3
cd /opt/dobot-cr3 && sudo git submodule update --init

# 1. Gatekeeper
sudo python3 -m pip install -r edge/gateway/requirements.txt

# 2. ROS 2 packages (into a workspace beside the driver's)
mkdir -p edge/ros2_ws/src && cp -r edge/ros2/* edge/ros2_ws/src/
cd edge/ros2_ws && colcon build && cd ../..

# 3. Secrets, never in a unit file
sudo install -d -m 0700 /etc/primbio
printf 'LAB_CONTROL_SIGNING_SECRET=%s\n' "$SHARED_WITH_THE_WEB_APP" \
  | sudo tee /etc/primbio/gateway.env >/dev/null
printf 'SUPABASE_ANON_KEY=%s\nLAB_HEARTBEAT_SECRET=%s\n' "$ANON" "$SECRET" \
  | sudo tee /etc/primbio/heartbeat.env >/dev/null
sudo chmod 0600 /etc/primbio/*.env

# 4. Services
sudo cp edge/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now primbio-foxglove primbio-weblab \
                              primbio-go2rtc primbio-gateway primbio-heartbeat
```

Full walkthrough, including the tunnel and the heartbeat secret, in
[`../docs/deploy-pi.md`](../docs/deploy-pi.md).

## Checking it

```bash
curl localhost:8766/health          # gatekeeper liveness; exposes no lab data
ros2 service list | grep /weblab/   # the surface the web can reach
ros2 topic echo /weblab/telemetry   # the document every viewer receives
curl localhost:1984/api/streams     # cameras go2rtc has
```

`LAB_CONTROL_SIGNING_SECRET` unset is the failure worth recognising: everything
connects, telemetry flows, and every motion command is refused. The gatekeeper
logs it as a warning at startup.
