# Lab computer deployment (Raspberry Pi)

How to expose the Dobot CR3 at `https://dobot-cr3-control.primbiolab.org` from
the lab computer behind the university NAT. Unit files and configuration live
in [`edge/`](../edge/) — this document is the walkthrough around them.

Five services, all outbound-only — **the hardware never opens a public port**:

| Service | Port (local) | Purpose |
|---|---|---|
| `cloudflared` | — | Outbound tunnel; the only ingress path |
| **gatekeeper** | **8766** | **Authenticates every socket and authorizes every command; the only service the tunnel reaches** |
| `go2rtc` | 1984 | WebRTC camera fan-out, MSE fallback. Localhost only |
| `foxglove_bridge` | 8765 | ROS 2 ⇄ WebSocket. **No auth of its own** — localhost only |
| `weblab` node | — | The vetted `/weblab/*` surface, telemetry, program runner, watchdog |
| `heartbeat` | — | Liveness beat to the platform DB |

> The tunnel points at the gatekeeper, never at `foxglove_bridge`. The bridge
> lets anyone who reaches it call any ROS service, so exposing it would expose
> the robot. See [hardware.md](hardware.md) and [`edge/README.md`](../edge/README.md).

## 1. Cloudflare Tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create <slug>-control
cloudflared tunnel route dns <slug>-control <slug>-control.primbiolab.org
```

`/etc/cloudflared/config.yml` — path-based ingress with a mandatory
catch-all so unmatched requests cannot probe the LAN:

```yaml
tunnel: <TUNNEL-UUID>
credentials-file: /etc/cloudflared/<TUNNEL-UUID>.json

ingress:
  - hostname: dobot-cr3-control.primbiolab.org
    service: http://127.0.0.1:8766
  - service: http_status:404
```

One rule, because Cloudflare ingress cannot rewrite paths: a rule pointing
`/api/video/*` straight at go2rtc would deliver `/api/video/api/webrtc` to a
server that serves `/api/webrtc`. The gatekeeper owns path routing instead.
The ready-made file is [`edge/cloudflared/config.yml`](../edge/cloudflared/config.yml).

Run as systemd so it survives power cuts:

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

**Cloudflare Access note:** if the hostname is behind a Zero Trust Access
policy, add a bypass for `/ws/*` — browsers cannot follow the interactive
302 during the WebSocket upgrade. Security then lives at the application
layer: the JWT-verifying node below closes unauthorized sockets.

## 2. go2rtc (video)

`/opt/go2rtc/go2rtc.yaml`:

```yaml
streams:
  cam: rtsp://…            # or exec:libcamera-vid …, usb device, etc.

webrtc:
  ice_servers:
    - urls: [stun:stun.l.google.com:19302]

api:
  listen: "127.0.0.1:1984"
```

WebRTC negotiates UDP through STUN; when the university NAT defeats hole
punching, the player falls back to MSE over TCP through the tunnel
(marginally higher latency, never blank). The template's video panel speaks
WHEP at `/api/video/api/webrtc?src=cam`.

## 3. foxglove_bridge (telemetry)

```bash
sudo apt install ros-$ROS_DISTRO-foxglove-bridge
ros2 launch foxglove_bridge foxglove_bridge_launch.xml \
  port:=8765 address:=127.0.0.1 \
  capabilities:=[clientPublish,services,connectionGraph,assets]
```

`address:=127.0.0.1` is not optional — it is what keeps the unauthenticated
bridge off the network. `services` must be in the capability list or every
robot command fails.

C++ bridge, chosen over rosbridge_suite deliberately: the Python rosbridge
stalls under multiple concurrent clients and large messages. The template's
telemetry console subscribes to every JSON-encoded channel automatically.

## 4. Heartbeat

A project admin sets the secret once (SQL editor or hub session):

```sql
select set_lab_heartbeat_secret('<remote_labs.id>', '<random ≥16 chars>');
```

`/etc/systemd/system/lab-heartbeat.service`:

```ini
[Unit]
Description=PRIMBIO lab heartbeat
After=network-online.target

[Service]
Environment=SUPABASE_URL=https://<project>.supabase.co
Environment=SUPABASE_ANON_KEY=<anon key>
Environment=LAB_SLUG=<slug>
Environment=LAB_HEARTBEAT_SECRET=<the secret>
ExecStart=/usr/bin/node /opt/lab/scripts/heartbeat.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Silent for 90 s ⇒ the platform shows the lab offline and the hub's "open
lab" button deactivates. The beat goes straight to Supabase — never through
the hub — so a hub outage cannot black out the labs.

## 5. ROS 2 execution model

See [ros2-node.md](ros2-node.md): multi-threaded executor, mutually
exclusive callback group for actuation, reentrant group for telemetry, and
the JWT-verifying security node that guards the WebSocket path.
