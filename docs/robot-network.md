# Robot network — who can command the arm

The Dobot CR3's own TCP protocol has **no authentication**. Ports 29999
(dashboard: `EnableRobot`, `ClearError`), 30003 (motion: `MovJ`, `ServoJ`) and
30004 (feedback) accept commands from anyone who can open a socket. There is no
password, no token, no allowlist, and no vendor setting that adds one.

So the only thing deciding who may move this arm is **who can reach it on the
network**. That is worth being blunt about, because everything else in this
platform is authorization and none of it is in that path:

```text
browser ─► Supabase session ─► project role ─► control lease ─► gatekeeper
          ─► weblab node ─► driver ─────────────────────────────┐
                                                                ▼
anything on the same network ──────────────────────────► robot :29999
```

The lower path skips the session, the role, the 15 s lease, the gatekeeper's
service allowlist and the node's value clamping. Those defend the *web* route
into the robot. They cannot defend a route that does not pass through them.

[bench-setup.md](bench-setup.md) records where this stands today: the robot was
found on `<robot-ip>`, on the **shared campus LAN**, in the same broadcast
domain as the lab computer and every other host on `<campus-subnet>`.

## Why the lab computer cannot fix this with a firewall

It is the obvious first idea and it does not work. The robot is the *listener*.
A packet from another campus host to `<robot-ip>:29999` is switched straight
to the robot and never traverses the lab computer, so there is nothing on this
machine for `nftables` to filter. Host firewall rules here would protect the
lab computer's own ports and change nothing about the arm.

The fix has to remove reachability, which means changing where the robot sits.

## Three ways to do that

All three keep the platform working unchanged: the driver still opens the same
TCP ports, and only its address changes. go2rtc, foxglove_bridge, the gatekeeper
and cloudflared all bind to localhost and are unaffected.

### A. Private link on the built-in wired port

The robot gets its own subnet on the lab computer's Ethernet port; the lab
computer reaches the campus network over wifi. No new hardware — on the current
bench machine wifi already carries a default route.

Robot side, from the teach pendant's network settings: static
`192.168.5.1/24`, no gateway. That is the CR3's factory address.

Lab computer, NetworkManager:

```bash
nmcli con add type ethernet ifname enp0s31f6 con-name robot-link \
  ipv4.method manual ipv4.addresses 192.168.5.100/24 \
  ipv4.never-default yes ipv6.method disabled
```

`ipv4.never-default yes` is the part that matters: without it this link can win
the default route and the lab computer starts sending campus traffic at a robot
arm.

Or netplan, for a server or Pi image:

```yaml
network:
  version: 2
  ethernets:
    enp0s31f6:
      dhcp4: no
      addresses: [192.168.5.100/24]
      # Deliberately no gateway4 and no nameservers: this link goes to one
      # device and must never become the way out to anywhere else.
```

Then point the driver at it:

```bash
export IP_address=192.168.5.1
```

**Trade-off:** the platform's uplink now depends on wifi. If wifi drops, the
lab goes offline — though the arm stays reachable to the driver, which is the
right way round.

### B. Private link on a USB-Ethernet adapter

Identical, except the private subnet lives on a USB Ethernet dongle and the
built-in port keeps the campus connection. Costs one adapter and is the better
answer wherever wifi is unreliable or absent; it is also the topology that
transfers to the Raspberry Pi, which has one Ethernet port and needs it for the
tunnel.

Use the dongle's interface name (`ip -brief addr` will show it, typically
`enx` followed by its MAC) in place of `enp0s31f6` above.

### C. Campus switch or VLAN ACL

No re-cabling: ask the university network team to restrict the robot's switch
port so only the lab computer may reach it. The request to file:

> On the switch port serving the Dobot CR3 (`<robot-mac>`), permit
> inbound TCP 29999, 30003, 30004, 30005 and 30006 **only** from the lab
> computer's address, and deny all other inbound traffic to that host. The
> device speaks an unauthenticated control protocol and any host that reaches
> those ports can physically move it.

Also ask for a **DHCP reservation** so the robot's address stops moving.

**Trade-offs:** it depends on someone else's change window, you cannot re-apply
it yourself when the robot moves bench, and you cannot see whether it is still
in place except by testing. Prefer A or B where the cabling is yours; C is the
right answer when it is not.

## Verifying it — from both sides

Isolation is not something to assume. `edge/scripts/verify-robot-isolation.py`
opens TCP connections and closes them without sending a byte — it never speaks
the Dobot protocol, because a stray payload on 29999 moves a real arm.

On the lab computer, where the robot **must** answer:

```bash
./edge/scripts/verify-robot-isolation.py --role lab --robot 192.168.5.1
```

It fails if the robot is unreachable (the driver would not work either), and
also if the robot is reached over an interface that carries a default route —
that is the shared-network condition this whole page exists to remove.

Then from **any other machine on the campus network**, where it must not:

```bash
./edge/scripts/verify-robot-isolation.py --role outsider --robot 192.168.5.1 \
  --robot-is-up
```

`--robot-is-up` is your assertion that the arm is powered and the `--role lab`
check passes right now. Without it the script reports success but exits 2,
because a robot that is switched off is unreachable from everywhere and proves
nothing at all. Re-run both sides after anything moves the robot.

## What the platform does in the meantime

It cannot refuse an unauthenticated command. It can refuse to be the last to
know one happened.

The weblab node polls the robot's real mode once a second
(`/dobot_cr3_bringup/srv/RobotMode`) and compares it with what the platform
actually commanded. `enabled` in the telemetry is now the robot's answer rather
than an assumption from our own commands — it used to be set optimistically and
never read back, so an arm energised from outside stayed drawn as disabled while
it moved. When the arm is energised and the platform did not do it, telemetry
carries `supervision.attributed: false`, the node logs it once, and every
console shows a red banner naming the state.

Two deliberate limits:

- **It reports; it never acts.** Disabling the arm on a mismatch would also
  disable it under an engineer legitimately using the teach pendant, possibly
  mid-move. That trades an intruder for a hazard.
- **It is a smoke alarm, not a lock.** It tells you the arm moved without the
  platform. It cannot stop that, and it is not a substitute for A, B or C.
