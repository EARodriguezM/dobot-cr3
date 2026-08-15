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

Then the driver, the gripper, then this node:

```bash
ros2 launch dobot_cr3_bringup dobot_cr3_bringup.launch.py   # IP_address=…
ros2 run dobot_cr3_moveit gripper_action_server             # gripper action
ros2 launch dobot_cr3_weblab weblab.launch.py
```

Only one node in `dobot_cr3_moveit` matters here, so it is run directly rather
than through `dobot_cr3_moveit.launch.py`: that launch file pulls in the whole
`dobot_cr3_moveit_config` stack — move_group, planners, rviz — none of which a
remote lab uses. `gripper_action_server` depends on nothing but the bringup's
Modbus services, and without it `/weblab/gripper` answers "el servidor de la
pinza no está disponible" while every other control works normally.

The gripper calibrates on startup: it opens and closes once, and refuses goals
until it reports `DH PGE-50 gripper initialised successfully`.

## Verified against the robot

Confirmed on the bench with the CR3 and a fitted PGE50:

- **Service-call encoding is `cdr`, not `json`.** foxglove_bridge 3.4.1
  advertises `cdr` per service and answers anything else with "Unsupported
  encoding"; a Trigger request is the 4-byte encapsulation header plus one
  placeholder byte, and the header alone comes back as "Service failed to send
  a response". Both `src/lib/robot/protocol.ts` and the gatekeeper's
  `_call_service_once` speak CDR. The bridge must still be started with the
  `services` capability, and it negotiates the `foxglove.sdk.v1` subprotocol.
- Topic names `joint_states_robot` and `dobot_cr_msgs/msg/ToolVectorActual`
  match what the driver publishes; telemetry reports `connected: true`.
- Gripper travel: 0 open, 0.0142 closed, mapped to DH register values
  1000 → 0. An open command reports `reached=True`.
- `MoveJog` takes its dynamic parameters unpacked. The driver used to pass the
  `param_value` list as a single argument, producing `MoveJog(J3+,[])`, which
  the controller rejects with `-40001` — every jog and every jog-stop failed
  while reporting success. The accepted form is `MoveJog(J3+)` / `MoveJog()`.
