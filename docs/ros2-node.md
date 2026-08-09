# ROS 2 node guidelines for remote labs

Execution and security rules for the hardware-side ROS 2 code, drawn from the
platform architecture document.

## Executor and callback groups

A single-threaded executor processes callbacks sequentially: a slow sensor
callback would delay a halt command. Remote labs therefore run a
**MultiThreadedExecutor** with explicit callback groups:

- **Actuation** (move commands, gripper, e-stop): `MutuallyExclusiveCallbackGroup`
  — physical commands execute one at a time, in order, never interleaved.
- **Telemetry** (joint states, sensor publishers): `ReentrantCallbackGroup`
  — many subscribers can be served concurrently without queueing behind
  actuation.

```python
from rclpy.executors import MultiThreadedExecutor
from rclpy.callback_groups import (
    MutuallyExclusiveCallbackGroup, ReentrantCallbackGroup)

class HardwareNode(Node):
    def __init__(self):
        super().__init__("hardware_node")
        self.act_group = MutuallyExclusiveCallbackGroup()
        self.tel_group = ReentrantCallbackGroup()
        self.create_subscription(
            JointCommand, "/cmd", self.on_cmd, 10, callback_group=self.act_group)
        self.create_timer(
            0.05, self.publish_state, callback_group=self.tel_group)

rclpy.spin(node, executor=MultiThreadedExecutor())
```

The e-stop callback belongs in the actuation group **and** must preempt: on
e-stop, set an aborted flag checked inside every motion loop before each
segment, then command the hardware halt.

## WebSocket security node

The `/ws/*` tunnel path bypasses Cloudflare Access (browsers cannot follow
its interactive redirect during the upgrade), so authentication happens at
the application layer:

1. The web client sends its Supabase **access token** as the first payload
   after the WebSocket opens (or as a `?token=` query parameter).
2. A gatekeeper node verifies the JWT **signature** against the Supabase
   project's JWT secret / JWKS (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`)
   and checks expiry.
3. It reads the `project_roles` claim (injected by the platform's access
   token hook) and requires `operator`, `admin` or `owner` on this lab's
   project for any topic that moves hardware; `viewer` may only subscribe.
4. Any failure ⇒ close the socket immediately. No unauthenticated socket
   stays open past the first message.

With foxglove_bridge (which does not authenticate by itself) the practical
pattern is to keep the bridge bound to localhost and put the gatekeeper in
front of it (a small WebSocket proxy on :8765 that performs steps 1–4 and
then pipes frames), or to expose only read-only topics through the bridge
and route all actuation through the authenticated control API instead.

The second pattern is what the template assumes by default: **telemetry via
foxglove_bridge (read-only), actuation via the lab app's `/api/control/*`**
(session-checked, lease-gated), with the lab app forwarding validated
commands to ROS 2. Start there; move to a custom gatekeeper only when you
need low-latency browser→ROS command streams.

## Safety invariants

- The control lease lives in the web tier; the hardware node must still
  rate-limit and bounds-check every command it receives.
- E-stop is never gated by the lease — any operator's stop must reach the
  hardware even while someone else drives.
- On tunnel loss or 15 s without commands, the node stops motion on its own:
  the web tier's crash-release frees the lease, and the hardware must match
  that assumption locally.
