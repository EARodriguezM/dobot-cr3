# Running the edge stack on a workstation

How to stand in for the Raspberry Pi with an ordinary computer, so the lab can
be exercised end to end before the Pi exists. Everything the Pi would run
(gatekeeper, foxglove_bridge, go2rtc, the weblab node, the heartbeat) runs the
same way here — see [edge/README.md](../edge/README.md) — this document only
covers what is different about a workstation.

## Finding the robot

The CR3 ships on `192.168.5.1` and is normally wired directly to the lab
computer. It is worth checking whether that is actually how yours is
connected before assuming it:

```bash
ip route get 192.168.5.1
```

If that comes back `via <your gateway>` rather than naming a direct link, the
robot is **not** on a dedicated cable to this machine — it is somewhere on the
shared network, and you have to go looking for it.

### Sweep, then fingerprint

Scanning every port of a whole subnet is slow and rude. The CR controller has
a distinctive signature instead: it listens on the Dobot TCP/IP ports, and
nothing else on a campus network usually does.

```bash
# 1. Which hosts exist at all (fast: ~12 s for a /23).
nmap -sn -n 172.16.2.0/23

# 2. Which of them speak Dobot.
#    29999 dashboard · 30003 motion · 30004 feedback · 30005-6 auxiliary
nmap -Pn -n --open -p 29999,30003,30004,30005,30006 172.16.2.0/23
```

A host with all five open is the controller. Substitute your own subnet — read
it from `ip -brief addr show`.

### Confirm before trusting it

An open port is not proof. Ask the controller what it is, with a query that
**reads and does not move anything**:

```bash
python3 - <<'EOF'
import socket
s = socket.create_connection(("172.16.2.26", 29999), timeout=4)
s.sendall(b"RobotMode()\n")
print(s.recv(1024).decode())
EOF
```

A real CR controller answers in the dashboard format
`ErrorID,{value},Command();` — for example:

```text
0,{4},RobotMode();
```

`0` is "no error" and `{4}` is the robot mode. **4 means disabled**: powered
and reachable, brakes engaged, not accepting motion. That is the state you want
to find it in, and the state to leave it in.

Useful modes: `1` init, `2` brakes released, `4` disabled, `5` enabled,
`7` running a program, `9` error, `11` jogging. `GetErrorID()` is also
read-only and returns empty arrays when the controller is healthy.

> **Only ever send read-only commands while exploring.** `RobotMode()` and
> `GetErrorID()` are safe. Anything in the enable/move family will engage the
> brakes and move a physical arm that may have someone standing next to it.

### What was found on this bench

| | |
|---|---|
| Robot | `172.16.2.26` (MAC `00:0e:c6:94:01:55`) |
| Ports open | 29999, 30003, 30004, 30005, 30006 |
| Mode at discovery | 4 — disabled, no active errors |
| Workstation | `172.16.2.44` on `enp0s31f6` |

**The robot is on the shared campus LAN, not on a private link.** Two
consequences worth being deliberate about:

- Anyone on that LAN can reach ports 29999/30003 and command the arm. There is
  no authentication in the Dobot TCP/IP protocol at all. The platform's
  gatekeeper protects the *web* path, not this one. For anything beyond bench
  testing, put the robot behind a second NIC on its own subnet so the lab
  computer is the only machine that can talk to it.
- Its address comes from the campus DHCP server, so it can change. Either
  reserve it, or re-run the fingerprint scan when the robot moves.

Set the driver's address when launching the ROS 2 stack:

```bash
export IP_address=172.16.2.26
ros2 launch dobot_cr3_bringup dobot_cr3_bringup.launch.py
```

## Cameras on a workstation

`edge/go2rtc.yaml` assumes IP cameras. On a bench you would normally use the
built-in webcam instead:

```yaml
streams:
  bench: exec:ffmpeg -f v4l2 -i /dev/video0 -c:v libx264 -preset ultrafast
         -tune zerolatency -f rtsp {output}
```

Check what the machine actually has before writing that config:

```bash
ls /dev/video*                     # device nodes
ls /sys/class/video4linux/         # what the kernel enumerated
lsusb | grep -i cam                # external cameras
lsmod | grep uvcvideo              # driver loaded?
```

All four matter, because they fail differently. **On this machine `uvcvideo` is
loaded but there are no `/dev/video*` nodes, nothing under
`/sys/class/video4linux/`, and no camera among its USB devices** — the driver
is ready and there is simply no camera attached for it to bind. A loaded module
is not evidence of a camera.

If you hit the same thing, the options in order of effort: plug in a USB
webcam, re-enable the integrated camera in firmware if it was disabled there,
or point go2rtc at any RTSP/MJPEG camera on the network and skip the local
device entirely. Until one of those, the lab runs exactly as it does with no
hardware at all — the camera tiles say "Cámara no disponible" and everything
else works, which is the behaviour the app is built to have.

## What still differs from the Pi

- **Cloudflare WARP is running on this workstation** (`CloudflareWARP`
  interface). It can route or block traffic in ways the Pi will not, so if the
  tunnel or the LAN scan behaves oddly, turn it off before debugging anything
  else.
- The Pi's systemd units in `edge/systemd/` assume `/opt/dobot-cr3`; on a bench
  it is usually easier to run each service in its own terminal and skip systemd
  until the Pi arrives.
