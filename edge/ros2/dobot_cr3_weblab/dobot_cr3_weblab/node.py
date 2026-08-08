"""The /weblab node: the only ROS surface the web client can reach.

The gatekeeper allowlists services by name, and every name it allows is
declared here. Nothing under ``/dobot_cr3_bringup/srv`` is exposed to a
browser: this node is the vetted, bounds-checked front for it, so a change to
the driver's interface never widens what the web can do.

Two responsibilities beyond forwarding commands:

* **Publish one telemetry document.** ``/weblab/telemetry`` is a
  ``std_msgs/String`` of JSON, published once at a fixed rate and fanned out by
  foxglove_bridge to however many people are watching. Typed topics
  (``joint_states_robot``, ``ToolVectorActual``) stay exactly as the driver
  publishes them for rviz and rosbag; this one exists so the browser needs no
  ROS message deserializer, and the duplication is deliberate.
* **Stop on its own.** If no command arrives for the watchdog period while the
  arm is jogging, the node stops motion without being asked. The web tier's
  lease expires in 15 s when an operator's browser dies; the hardware must not
  depend on being told about it.

Execution model follows docs/ros2-node.md: a MultiThreadedExecutor with
actuation on a mutually exclusive callback group so physical commands never
interleave, and telemetry on a reentrant group so publishing never queues
behind a move.
"""

from __future__ import annotations

import json
import time

import rclpy
from rclpy.callback_groups import (
    MutuallyExclusiveCallbackGroup, ReentrantCallbackGroup)
from rclpy.executors import MultiThreadedExecutor
from rclpy.node import Node

from std_msgs.msg import String
from std_srvs.srv import Trigger

from dobot_cr3_weblab_msgs.srv import (
    CartMove, Gripper, JointMove, Jog, RunProgram, SetSpeed)

from .bridge import GRIPPER_CLOSED, GRIPPER_OPEN, RobotBridge, import_error
from .programs import ProgramRunner

TELEMETRY_TOPIC = '/weblab/telemetry'
TELEMETRY_HZ = 10.0

# If the arm is jogging and nothing has been commanded for this long, stop it.
# Comfortably shorter than the web tier's 15 s lease TTL, so the hardware is
# already safe by the time the lease expires.
JOG_WATCHDOG_S = 1.0


class WeblabNode(Node):
    def __init__(self):
        super().__init__('weblab')

        self.actuation_group = MutuallyExclusiveCallbackGroup()
        self.telemetry_group = ReentrantCallbackGroup()

        self.bridge = RobotBridge(self)
        self.bridge.subscribe(self.telemetry_group)
        self.runner = ProgramRunner(
            self.bridge, log=lambda msg: self.get_logger().warn(msg))

        self._last_jog = 0.0
        self._jogging = False

        self.telemetry_pub = self.create_publisher(
            String, TELEMETRY_TOPIC, 10, callback_group=self.telemetry_group)
        self.create_timer(
            1.0 / TELEMETRY_HZ, self._publish_telemetry,
            callback_group=self.telemetry_group)
        self.create_timer(
            0.2, self._watchdog, callback_group=self.telemetry_group)

        self._declare_services()

        if not self.bridge.available:
            self.get_logger().warn(
                'ROS interfaces for the Dobot driver are unavailable '
                f'({import_error()}). Serving telemetry only; every command '
                'will return an error. The web UI stays up.')

    # ── Service surface ─────────────────────────────────────────────────────

    def _declare_services(self) -> None:
        def trigger(name, handler):
            self.create_service(
                Trigger, f'/weblab/{name}', handler,
                callback_group=self.actuation_group)

        def typed(kind, name, handler):
            self.create_service(
                kind, f'/weblab/{name}', handler,
                callback_group=self.actuation_group)

        # Stops. The gatekeeper lets any operator call these without holding
        # the control lease.
        trigger('estop', self._on_estop)
        trigger('disable', self._on_disable)
        trigger('jog_stop', self._on_jog_stop)
        trigger('program_stop', self._on_program_stop)

        # Motion. Lease-gated at the edge.
        trigger('enable', self._on_enable)
        trigger('clear_error', self._on_clear_error)
        trigger('home', self._on_home)
        typed(Jog, 'jog', self._on_jog)
        typed(SetSpeed, 'set_speed', self._on_set_speed)
        typed(JointMove, 'joint_move', self._on_joint_move)
        typed(CartMove, 'cart_move', self._on_cart_move)
        typed(Gripper, 'gripper', self._on_gripper)
        typed(RunProgram, 'program_run', self._on_program_run)

    # ── Handlers ────────────────────────────────────────────────────────────

    @staticmethod
    def _reply(response, result):
        response.success = bool(result.get('ok'))
        response.message = str(result.get('message') or '')
        return response

    @staticmethod
    def _reply_typed(response, result):
        response.ok = bool(result.get('ok'))
        response.message = str(result.get('message') or '')
        return response

    def _on_estop(self, _request, response):
        # An emergency stop is three things at once: end any program, stop the
        # jog, and cut the drive. Each is attempted regardless of whether the
        # previous one succeeded.
        self.get_logger().warn('EMERGENCY STOP')
        self.runner.stop()
        self.bridge.jog_stop()
        self._jogging = False
        return self._reply(response, self.bridge.disable())

    def _on_disable(self, _request, response):
        self.runner.stop()
        self._jogging = False
        return self._reply(response, self.bridge.disable())

    def _on_jog_stop(self, _request, response):
        self._jogging = False
        return self._reply(response, self.bridge.jog_stop())

    def _on_program_stop(self, _request, response):
        return self._reply(response, self.runner.stop())

    def _on_enable(self, _request, response):
        return self._reply(response, self.bridge.enable())

    def _on_clear_error(self, _request, response):
        return self._reply(response, self.bridge.clear_error())

    def _on_home(self, _request, response):
        return self._reply(response, self.bridge.home())

    def _on_jog(self, request, response):
        self._last_jog = time.time()
        self._jogging = bool(request.axis_id)
        return self._reply_typed(response, self.bridge.jog(request.axis_id))

    def _on_set_speed(self, request, response):
        return self._reply_typed(response, self.bridge.set_speed(request.ratio))

    def _on_joint_move(self, request, response):
        return self._reply_typed(
            response, self.bridge.joint_move(list(request.joints_deg)))

    def _on_cart_move(self, request, response):
        pose = {axis: getattr(request, axis)
                for axis in ('x', 'y', 'z', 'rx', 'ry', 'rz')}
        return self._reply_typed(response, self.bridge.cart_move(pose))

    def _on_gripper(self, request, response):
        # Clamp to the mechanism's travel: a web client must not be able to
        # command the fingers past their stops.
        position = max(GRIPPER_OPEN, min(GRIPPER_CLOSED, float(request.position)))
        effort = request.max_effort if request.max_effort > 0 else 50.0
        return self._reply_typed(
            response, self.bridge.gripper(position, effort))

    def _on_program_run(self, request, response):
        return self._reply_typed(
            response, self.runner.start(request.name, request.steps_json))

    # ── Periodic ────────────────────────────────────────────────────────────

    def _publish_telemetry(self) -> None:
        state = self.bridge.snapshot()
        state['program'] = self.runner.status()
        message = String()
        message.data = json.dumps(state)
        self.telemetry_pub.publish(message)

    def _watchdog(self) -> None:
        """Stop a jog nobody is holding down any more.

        A jog is a press-and-hold: the browser sends a stop on release, but a
        browser that crashed mid-press sends nothing at all. The hardware
        cannot wait for the web tier to notice.
        """
        if not self._jogging:
            return
        if time.time() - self._last_jog > JOG_WATCHDOG_S:
            self.get_logger().warn('jog watchdog fired — stopping motion')
            self._jogging = False
            self.bridge.jog_stop()


def main(args=None) -> None:
    rclpy.init(args=args)
    node = WeblabNode()
    executor = MultiThreadedExecutor()
    executor.add_node(node)
    try:
        executor.spin()
    except KeyboardInterrupt:
        pass
    finally:
        # Never leave the arm moving because the node went away.
        node.bridge.jog_stop()
        executor.shutdown()
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()
