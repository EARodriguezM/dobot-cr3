# Hardware — the ROS 2 side

What the browser can ask the Dobot CR3 to do, and what stands between the two.

```text
browser ──► gatekeeper ──► foxglove_bridge ──► /weblab/* (weblab node)
                                                    │
                                          /dobot_cr3_bringup/srv/*
                                          /gripper_group_controller/gripper_cmd
                                                    ▼
                                              Dobot CR3 controller
```

Nothing under `/dobot_cr3_bringup` is reachable from a browser. The weblab node
(`edge/ros2/dobot_cr3_weblab`) is the vetted front for it, and the gatekeeper
allowlists that front by name — so widening what the web can do takes an
explicit edit in two files, both of which are reviewed as security surface.

## The service surface

| Service | Type | Needs the lease? |
|---|---|---|
| `/weblab/estop` | `Trigger` | **no** — stops always work |
| `/weblab/disable` | `Trigger` | **no** |
| `/weblab/jog_stop` | `Trigger` | **no** |
| `/weblab/program_stop` | `Trigger` | **no** |
| `/weblab/enable` | `Trigger` | yes |
| `/weblab/clear_error` | `Trigger` | yes |
| `/weblab/home` | `Trigger` | yes |
| `/weblab/jog` | `Jog` | yes |
| `/weblab/set_speed` | `SetSpeed` | yes |
| `/weblab/joint_move` | `JointMove` | yes |
| `/weblab/cart_move` | `CartMove` | yes |
| `/weblab/gripper` | `Gripper` | yes |
| `/weblab/program_run` | `RunProgram` | yes |

All of them additionally require the `operator` role or above. `jog` axis ids
are `J1+ … J6-` in joint mode and `X+ … Rz-` in cartesian mode; an empty
`axis_id` stops motion.

Values are clamped in the node, not trusted from the caller: speed to 1–100,
gripper travel to the PGE50's 0–0.0142 m. A web client is not an authority on
what the mechanism will accept.

## Telemetry

`/weblab/telemetry` — `std_msgs/String` carrying one JSON document at 10 Hz:

```json
{
  "connected": true, "enabled": false, "speed": 50, "error": "",
  "joints_deg": [0,0,0,0,0,0], "joints_rad": [0,0,0,0,0,0],
  "pose": {"x":0,"y":0,"z":0,"rx":0,"ry":0,"rz":0},
  "program": {"running": false, "stepIndex": -1, "stepCount": 0,
              "programName": "", "operatorName": ""}
}
```

Published **once** and fanned out by `foxglove_bridge` to every viewer. The
driver's typed topics (`joint_states_robot`,
`dobot_cr_msgs/msg/ToolVectorActual`) are untouched and remain the right thing
for rviz, rosbag and Foxglove Studio. This document exists so the browser needs
no ROS message deserializer — it is the only CDR the web client decodes, and it
decodes it as a string. The duplication is deliberate; do not replace the typed
topics with it.

`connected` goes false after 1.5 s without driver feedback, whatever the last
message said.

## Safety behaviour that does not depend on the network

- **Jog watchdog.** A jog is a press-and-hold. A browser that dies mid-press
  sends no release, so the node stops motion after 1 s of silence — comfortably
  before the web tier's 15 s lease expires.
- **Program abort.** Every step checks the abort flag before it starts, so a
  stop takes effect at the next step boundary; a `wait` step is interruptible
  rather than sitting out its delay. A waypoint that is not reached within 30 s
  ends the program instead of wedging the lab.
- **Shutdown.** The node stops any jog on the way out, so killing it never
  leaves the arm moving.
- **Emergency stop** ends the program, stops the jog and disables the drive —
  each attempted regardless of whether the previous one succeeded.

## Offline mode

If `rclpy` or the Dobot interfaces are not importable — a laptop with no ROS
sourced, or the driver package not built — the bridge reports itself
unavailable, telemetry says `connected: false`, and every command returns a
clear error instead of raising. The web UI stays up and view-only. This is the
same contract the reference implementation had, and it is what makes the lab
developable without the robot.

## Building

```bash
git submodule update --init                  # the driver workspace
mkdir -p edge/ros2_ws/src && cp -r edge/ros2/* edge/ros2_ws/src/
cd edge/ros2_ws && colcon build && source install/setup.bash
```

Then the driver, then this node:

```bash
ros2 launch dobot_cr3_bringup dobot_cr3_bringup.launch.py   # IP_address=…
ros2 launch dobot_cr3_moveit dobot_cr3_moveit.launch.py     # gripper action
ros2 launch dobot_cr3_weblab weblab.launch.py
```

## Not yet verified against the robot

Everything above is implemented and unit-tested, but this repository has been
developed without the CR3 attached. Check these on the first run with hardware:

- `foxglove_bridge` must be started with the `services` capability, and its
  service-call encoding must be `json` — the web client and the gatekeeper both
  assume it. If the bridge negotiates `cdr` instead, service calls will fail
  and the fix belongs in `src/lib/robot/protocol.ts` and the gatekeeper's
  `_call_service_once`.
- Topic names `joint_states_robot` and
  `dobot_cr_msgs/msg/ToolVectorActual` are taken from the reference
  implementation; confirm they match what the driver publishes.
- The gripper travel constants (0 open, 0.0142 closed) come from the reference
  `gripper_action_server`; confirm against the fitted PGE50.
