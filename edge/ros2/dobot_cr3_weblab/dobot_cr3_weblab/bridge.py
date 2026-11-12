"""Thin wrapper over the Dobot CR3 driver's ROS 2 interface.

Everything that actually touches the robot goes through here, so the node above
it deals in intentions ('jog J2+', 'open the gripper') and this file deals in
the driver's service names and message shapes.

It degrades on purpose: if ``rclpy`` or the Dobot interfaces are not importable
— running on a laptop with no ROS sourced, or with the driver package not
built — the wrapper reports itself unavailable and every command returns a
clear error instead of raising. The web UI stays up, telemetry says the robot
is disconnected, and nothing pretends to have moved.
"""

from __future__ import annotations

import math
import threading
import time
from typing import Any, Callable, Dict, List, Optional

ROS_AVAILABLE = True
_IMPORT_ERROR = ''
try:
    from rclpy.action import ActionClient
    from rclpy.callback_groups import (
        MutuallyExclusiveCallbackGroup, ReentrantCallbackGroup)
    from rclpy.node import Node

    from control_msgs.action import GripperCommand
    from sensor_msgs.msg import JointState

    from dobot_cr_msgs.msg import ToolVectorActual
    from dobot_cr_msgs.srv import (
        ClearError, DisableRobot, EnableRobot, JointMovJ, MoveJog, MovJ,
        SpeedFactor,
    )
except Exception as exc:  # pragma: no cover - depends on the ROS environment
    ROS_AVAILABLE = False
    _IMPORT_ERROR = repr(exc)

# Imported on its own so a driver that predates this service costs only the
# supervision check. Folding it into the block above would make the whole node
# degrade to telemetry-only over one missing symbol, which is a much worse
# trade than losing the alarm.
MODE_QUERY_AVAILABLE = False
try:
    from dobot_cr_msgs.srv import RobotMode
    MODE_QUERY_AVAILABLE = True
except Exception:  # pragma: no cover - depends on the driver version
    pass

NUM_JOINTS = 6

# Gripper finger travel understood by the PGE50 action server, in metres.
GRIPPER_OPEN = 0.0
GRIPPER_CLOSED = 0.0142

# A feedback gap longer than this means the driver has stopped talking to us,
# whatever the last message said.
STALE_FEEDBACK_S = 1.5

# ── Knowing what the robot is actually doing ────────────────────────────────
#
# The vendor's TCP protocol has no authentication. Anything that can reach the
# controller on port 29999 can enable and move this arm without touching the
# platform: no session, no role, no lease, no gatekeeper. That is a property of
# the robot's firmware and cannot be fixed from here — the fix is to make the
# controller unreachable to anything but this computer (docs/robot-network.md).
#
# What this process *can* do is stop being the last to know. `enabled` used to
# be set from our own commands and never read back, so a command issued outside
# the platform was invisible: the console kept drawing a disabled arm while it
# moved. So the robot is asked instead, and when its answer does not match what
# we asked for, the telemetry says so to everyone watching.

# The vendor's robot modes.
MODE_LABELS = {
    1: 'init', 2: 'brakes released', 3: 'unknown', 4: 'disabled',
    5: 'enabled', 6: 'backdrive', 7: 'running program', 8: 'recording',
    9: 'error', 10: 'paused', 11: 'jogging',
}

# Modes in which the brakes are engaged and the arm cannot move on its own.
# Anything else — including a mode this table does not know — is treated as
# energised, so an unrecognised vendor mode raises the alarm rather than
# silencing it.
IDLE_MODES = frozenset({1, 4, 9})

# How long after one of our own commands to stop comparing. A command takes a
# moment to change the robot's mode, and the mismatch in between is ours.
COMMAND_GRACE_S = 3.0

# The mode query is a dashboard round trip; it must never hold up actuation, so
# it runs on the telemetry group with a short deadline and skips itself if the
# previous one is still outstanding.
MODE_POLL_TIMEOUT_S = 1.0

DRIVER_NS = '/dobot_cr3_bringup/srv'
GRIPPER_ACTION = '/gripper_group_controller/gripper_cmd'


def _fail(message: str) -> Dict[str, Any]:
    return {'ok': False, 'message': message}


def _ok(message: str = '') -> Dict[str, Any]:
    return {'ok': True, 'message': message}


class RobotBridge:
    """Owns the driver clients and the latest known robot state."""

    def __init__(self, node: 'Node', service_timeout: float = 4.0):
        self.node = node
        self.service_timeout = service_timeout
        self._lock = threading.Lock()
        self._state: Dict[str, Any] = {
            'connected': False,
            'enabled': None,
            # Null until the robot has answered once: "we do not know" is a
            # different statement from "nobody is driving it".
            'supervision': {
                'mode': None,
                'modeLabel': '',
                'attributed': True,
                'since': None,
            },
            'speed': 50,
            'error': '' if ROS_AVAILABLE else 'ROS no disponible',
            'joints_deg': [0.0] * NUM_JOINTS,
            'joints_rad': [0.0] * NUM_JOINTS,
            'pose': {'x': 0.0, 'y': 0.0, 'z': 0.0,
                     'rx': 0.0, 'ry': 0.0, 'rz': 0.0},
        }
        self._last_feedback = 0.0
        # Attribution: what we asked for, and when we last asked for anything.
        self._commanded_motion = False
        self._last_command_at = 0.0
        self._mode_seen = False
        self._mode_in_flight = False
        self._clients: Dict[str, Any] = {}
        self._gripper: Optional[Any] = None
        if ROS_AVAILABLE:
            self._build()

    @property
    def available(self) -> bool:
        return ROS_AVAILABLE

    # ── Wiring ──────────────────────────────────────────────────────────────

    def _build(self) -> None:
        # Actuation is mutually exclusive: physical commands execute one at a
        # time, in order, never interleaved (docs/ros2-node.md).
        self.actuation_group = MutuallyExclusiveCallbackGroup()

        # The driver clients must NOT share that group. A service handler runs
        # on the actuation group and then blocks waiting for the driver's
        # reply; if the reply can only be delivered by the same mutually
        # exclusive group, it waits for a callback that cannot run until it
        # returns. The result is a deadlock that surfaces to the browser as
        # "Service failed to send a response" — the command never reaches the
        # robot and nothing in the log says why.
        self.client_group = ReentrantCallbackGroup()

        def client(kind, name):
            return self.node.create_client(
                kind, f'{DRIVER_NS}/{name}', callback_group=self.client_group)

        self._clients = {
            'enable': client(EnableRobot, 'EnableRobot'),
            'disable': client(DisableRobot, 'DisableRobot'),
            'clear_error': client(ClearError, 'ClearError'),
            'speed': client(SpeedFactor, 'SpeedFactor'),
            'jog': client(MoveJog, 'MoveJog'),
            'joint_move': client(JointMovJ, 'JointMovJ'),
            'cart_move': client(MovJ, 'MovJ'),
        }
        if MODE_QUERY_AVAILABLE:
            self._clients['mode'] = client(RobotMode, 'RobotMode')
        self._gripper = ActionClient(
            self.node, GripperCommand, GRIPPER_ACTION,
            callback_group=self.client_group)

    def subscribe(self, telemetry_group) -> None:
        """Attach the feedback subscriptions on the reentrant group."""
        if not ROS_AVAILABLE:
            return
        self.node.create_subscription(
            JointState, 'joint_states_robot', self._on_joints, 10,
            callback_group=telemetry_group)
        self.node.create_subscription(
            ToolVectorActual, 'dobot_cr_msgs/msg/ToolVectorActual',
            self._on_pose, 10, callback_group=telemetry_group)

    # ── Feedback ────────────────────────────────────────────────────────────

    def _on_joints(self, msg) -> None:
        radians = list(msg.position[:NUM_JOINTS])
        with self._lock:
            self._state['joints_rad'] = radians
            self._state['joints_deg'] = [math.degrees(r) for r in radians]
            self._state['connected'] = True
        self._last_feedback = time.time()

    def _on_pose(self, msg) -> None:
        with self._lock:
            self._state['pose'] = {
                'x': msg.x, 'y': msg.y, 'z': msg.z,
                'rx': msg.rx, 'ry': msg.ry, 'rz': msg.rz,
            }
            self._state['connected'] = True
        self._last_feedback = time.time()

    def poll_mode(self) -> Optional[str]:
        """Ask the robot what it is actually doing and reconcile it with what
        we asked for. Returns a message to log when the verdict changes.

        This is the only thing standing between an unauthenticated command on
        the vendor's TCP port and nobody noticing. It cannot prevent that
        command — the robot is the listener and an unauthorised client never
        passes through this process — but it does mean the arm cannot be
        energised without the console saying so to every person watching.

        Deliberately never acts on what it finds. Disabling the arm here would
        also disable it under an engineer legitimately using the teach pendant,
        possibly mid-move, which trades an intruder for a hazard. The report
        goes to the people who can look at the robot and decide.
        """
        if not ROS_AVAILABLE or not MODE_QUERY_AVAILABLE:
            return None
        client = self._clients.get('mode')
        if client is None or self._mode_in_flight:
            return None
        # Never wait on the driver here: if it is not up, telemetry already
        # says disconnected and there is nothing to reconcile against.
        if not client.service_is_ready():
            return None

        self._mode_in_flight = True
        try:
            future = client.call_async(RobotMode.Request())
            deadline = time.time() + MODE_POLL_TIMEOUT_S
            while not future.done() and time.time() < deadline:
                time.sleep(0.01)
            if not future.done():
                return None
            response = future.result()
            if response is None or int(getattr(response, 'res', 0) or 0) != 0:
                return None
            raw = str(getattr(response, 'mode', '') or '').strip()
            if not raw.lstrip('-').isdigit():
                return None
            mode = int(raw)
        except Exception:
            # A failed query is not evidence of anything; the next one decides.
            return None
        finally:
            self._mode_in_flight = False

        return self._reconcile(mode)

    def _reconcile(self, mode: int) -> Optional[str]:
        """Fold one mode reading into the state. Returns a line to log when the
        attribution verdict changes, so a steady state is not logged forever."""
        now = time.time()
        energised = mode not in IDLE_MODES
        label = MODE_LABELS.get(mode, f'mode {mode}')

        with self._lock:
            # The robot's own answer outranks what we assumed from our own
            # commands. This is the field the console draws.
            self._state['enabled'] = energised

            previous = self._state['supervision']
            was_attributed = previous['attributed']
            first_reading = not self._mode_seen
            self._mode_seen = True

            # Ours if we asked for it, or if we asked for anything at all in
            # the last few seconds and the robot is still catching up.
            attributed = (
                not energised
                or self._commanded_motion
                or now - self._last_command_at < COMMAND_GRACE_S
            )
            if attributed:
                # Believing the robot keeps the two views from drifting apart
                # after a stop the platform did not issue.
                self._commanded_motion = energised
                since = None
            else:
                since = previous['since'] or now

            self._state['supervision'] = {
                'mode': mode,
                'modeLabel': label,
                'attributed': attributed,
                'since': since,
            }

        if attributed:
            if not was_attributed:
                return f'robot state is accounted for again ({label})'
            return None

        if was_attributed or first_reading:
            when = 'was already' if first_reading else 'has been'
            return (
                f'UNATTRIBUTED ROBOT STATE: the arm {when} {label} and this '
                'platform did not command it. The vendor TCP protocol is '
                'unauthenticated, so anything that can reach the controller '
                'can do this. Check who is at the robot, and see '
                'docs/robot-network.md.'
            )
        return None

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            state = dict(self._state)
            state['pose'] = dict(state['pose'])
            state['supervision'] = dict(state['supervision'])
            state['joints_deg'] = list(state['joints_deg'])
            state['joints_rad'] = list(state['joints_rad'])
        if state['connected'] and time.time() - self._last_feedback > STALE_FEEDBACK_S:
            state['connected'] = False
        return state

    # ── Dispatch ────────────────────────────────────────────────────────────

    def _call(self, key: str, request) -> Dict[str, Any]:
        if not ROS_AVAILABLE:
            return _fail('ROS no disponible (modo sin hardware)')
        # Every command the platform issues passes through here, which makes it
        # the one place to record that whatever the robot does next is ours.
        self._last_command_at = time.time()
        client = self._clients.get(key)
        if client is None:
            return _fail(f'servicio desconocido: {key}')
        if not client.wait_for_service(timeout_sec=self.service_timeout):
            return _fail(f'el servicio {key} no responde (¿está corriendo el driver?)')
        future = client.call_async(request)
        deadline = time.time() + self.service_timeout
        while not future.done() and time.time() < deadline:
            time.sleep(0.01)
        if not future.done():
            return _fail(f'el servicio {key} agotó el tiempo de espera')

        # The driver answering is not the robot agreeing. Every one of these
        # services replies with `int32 res`, the controller's error id, and 0
        # is the only value that means the command was accepted. Returning
        # success for any completed call reported a refused command — a wrong
        # payload, an arm in an error state, a move outside its limits — as
        # done, and the operator saw nothing at all.
        response = future.result()
        code = int(getattr(response, 'res', 0) or 0)
        if code != 0:
            return _fail(
                f'el robot rechazó el comando ({key}: código {code})')
        return _ok()

    # ── Commands ────────────────────────────────────────────────────────────

    def enable(self, payload: float = 0.0) -> Dict[str, Any]:
        if not ROS_AVAILABLE:
            return _fail('ROS no disponible')
        result = self._call('enable', EnableRobot.Request(load=float(payload)))
        if result['ok']:
            with self._lock:
                self._state['enabled'] = True
                self._commanded_motion = True
        return result

    def disable(self) -> Dict[str, Any]:
        if not ROS_AVAILABLE:
            return _fail('ROS no disponible')
        result = self._call('disable', DisableRobot.Request())
        if result['ok']:
            with self._lock:
                self._state['enabled'] = False
                self._commanded_motion = False
        return result

    def clear_error(self) -> Dict[str, Any]:
        if not ROS_AVAILABLE:
            return _fail('ROS no disponible')
        return self._call('clear_error', ClearError.Request())

    def set_speed(self, ratio: int) -> Dict[str, Any]:
        if not ROS_AVAILABLE:
            return _fail('ROS no disponible')
        # Clamped here, not trusted from the caller: the web client is not an
        # authority on what the hardware will accept.
        ratio = max(1, min(100, int(ratio)))
        result = self._call('speed', SpeedFactor.Request(ratio=ratio))
        if result['ok']:
            with self._lock:
                self._state['speed'] = ratio
        return result

    def jog(self, axis_id: str) -> Dict[str, Any]:
        if not ROS_AVAILABLE:
            return _fail('ROS no disponible')
        request = MoveJog.Request()
        request.axis_id = axis_id
        request.param_value = []
        return self._call('jog', request)

    def jog_stop(self) -> Dict[str, Any]:
        return self.jog('')

    def joint_move(self, joints_deg: List[float]) -> Dict[str, Any]:
        if not ROS_AVAILABLE:
            return _fail('ROS no disponible')
        if len(joints_deg) != NUM_JOINTS:
            return _fail(f'se esperaban {NUM_JOINTS} ángulos articulares')
        request = JointMovJ.Request()
        (request.j1, request.j2, request.j3,
         request.j4, request.j5, request.j6) = [float(v) for v in joints_deg]
        request.param_value = []
        return self._call('joint_move', request)

    def home(self) -> Dict[str, Any]:
        return self.joint_move([0.0] * NUM_JOINTS)

    def cart_move(self, pose: Dict[str, float]) -> Dict[str, Any]:
        if not ROS_AVAILABLE:
            return _fail('ROS no disponible')
        request = MovJ.Request()
        for axis in ('x', 'y', 'z', 'rx', 'ry', 'rz'):
            setattr(request, axis, float(pose.get(axis, 0.0)))
        request.param_value = []
        return self._call('cart_move', request)

    def gripper(self, position: float, max_effort: float = 50.0) -> Dict[str, Any]:
        if not ROS_AVAILABLE:
            return _fail('ROS no disponible')
        if self._gripper is None or not self._gripper.wait_for_server(
                timeout_sec=self.service_timeout):
            return _fail('el servidor de la pinza no está disponible')
        self._last_command_at = time.time()
        goal = GripperCommand.Goal()
        goal.command.position = float(position)
        goal.command.max_effort = float(max_effort)
        send = self._gripper.send_goal_async(goal)
        deadline = time.time() + self.service_timeout
        while not send.done() and time.time() < deadline:
            time.sleep(0.01)
        if not send.done():
            return _fail('la pinza no aceptó el comando a tiempo')
        handle = send.result()
        if handle is None or not handle.accepted:
            return _fail('la pinza rechazó el comando')
        return _ok()


def import_error() -> str:
    return _IMPORT_ERROR
