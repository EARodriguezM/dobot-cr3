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

All four matter, because they fail differently, and a loaded module is not
evidence of a camera: `uvcvideo` sits loaded with no device bound quite
happily. If the nodes are missing, check that the webcam is plugged into the
**computer** and not into a monitor's USB hub — a hub that is not passing the
device through looks exactly like no camera at all.

### Running it

`ffmpeg` is not installed on this bench and there is no sudo, so go2rtc runs
in Docker, whose image bundles ffmpeg:

```bash
docker run -d --name primbio-go2rtc \
  --device /dev/video0 \
  -p 127.0.0.1:1984:1984 \
  -v "$PWD/edge/go2rtc.bench.yaml:/config/go2rtc.yaml:ro" \
  alexxit/go2rtc
```

Publishing to `127.0.0.1` only is deliberate: go2rtc has no authentication, and
the gatekeeper is what is supposed to be reachable.

Read the camera's real capabilities before writing the config rather than
assuming them — `v4l2-ctl --list-formats-ext` if it is installed, otherwise the
`VIDIOC_ENUM_FMT` ioctl. The C270 on this bench offers MJPEG and YUYV up to
1280x720, and the config pins MJPEG because the camera compresses it in
hardware.

### Verifying it

```bash
curl -s localhost:1984/api/streams                      # is the stream registered?
curl -s -o /tmp/f.jpg "localhost:1984/api/frame.jpeg?src=bench"   # a real frame?
```

**Expect the first snapshot to be black.** That is not a fault. With no client
streaming, go2rtc starts the producer for the snapshot and stops it again, so
every snapshot is the camera's first frame — taken before auto-exposure has
settled. It compresses to a few KB, whereas a real scene is tens of KB, which
is the quickest way to tell them apart. Capture a few seconds instead and the
difference is obvious:

```bash
docker exec primbio-go2rtc sh -c \
  "ffmpeg -loglevel error -f v4l2 -input_format mjpeg -video_size 1280x720 \
   -i /dev/video0 -t 6 -vf fps=1 -f image2 -y /tmp/w%d.jpg; ls -l /tmp/w*.jpg"
```

Frame 1 comes out around 7 KB and black; frames 2 onward around 73 KB and
correctly exposed. The lab UI never sees this, because a WebRTC viewer holds
the producer open and exposure settles within about a second.

The `unable to decode APP fields` warnings from the MJPEG decoder are noise
from this camera's JPEG headers and can be ignored — frames decode fine.

## Building the ROS 2 packages

```bash
sudo apt install ros-jazzy-foxglove-bridge
mkdir -p edge/ros2_ws/src && cp -r edge/ros2/* edge/ros2_ws/src/
ln -s "$PWD/ros2_interfaces/dobot_cr3_control/src/dobot_cr_msgs" edge/ros2_ws/src/
cd edge/ros2_ws
source /opt/ros/jazzy/setup.bash
colcon build --symlink-install --cmake-args -DPYTHON_EXECUTABLE=/usr/bin/python3
```

`-DPYTHON_EXECUTABLE` is not optional on this machine: Homebrew's `python3`
comes first on `PATH` and has no `empy`, so `rosidl` dies with
`No module named 'em'` while pointing at a CMake file that has nothing to do
with the problem. The same shadowing makes `aiohttp` look absent to the
gateway — run it as `/usr/bin/python3 -m primbio_gateway.server`.

Then, in three terminals:

```bash
ros2 launch foxglove_bridge foxglove_bridge_launch.xml port:=8765 address:=127.0.0.1
ros2 run dobot_cr3_weblab weblab
/usr/bin/python3 -m primbio_gateway.server      # from edge/gateway
```

`ros2 service list | grep /weblab/` should show the vetted surface, and
`ros2 topic echo /weblab/telemetry --once` a JSON document with
`"connected": false` until the driver is running.

## What still differs from the Pi

- **Cloudflare WARP is running on this workstation** (`CloudflareWARP`
  interface). It can route or block traffic in ways the Pi will not, so if the
  tunnel or the LAN scan behaves oddly, turn it off before debugging anything
  else.
- The Pi's systemd units in `edge/systemd/` assume `/opt/dobot-cr3`; on a bench
  it is usually easier to run each service in its own terminal and skip systemd
  until the Pi arrives.
