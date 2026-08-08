"""Tests for the program runner.

Runs without ROS: the runner only ever talks to the bridge through a handful of
methods, so a stand-in is enough to pin the behaviour that matters — that a
program can always be stopped, and that a step which never completes ends the
program instead of wedging the lab.
"""

import json
import pathlib
import sys
import threading
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from dobot_cr3_weblab.programs import ProgramRunner  # noqa: E402


class FakeBridge:
    """Stand-in arm. Reaches every commanded target unless told otherwise."""

    def __init__(self, arrives=True):
        self.arrives = arrives
        self.calls = []
        self.joints = [0.0] * 6
        self._lock = threading.Lock()

    def joint_move(self, joints_deg):
        with self._lock:
            self.calls.append(('joint_move', list(joints_deg)))
            if self.arrives:
                self.joints = list(joints_deg)
        return {'ok': True}

    def gripper(self, position, max_effort=50.0):
        with self._lock:
            self.calls.append(('gripper', position))
        return {'ok': True}

    def jog_stop(self):
        with self._lock:
            self.calls.append(('jog_stop', None))
        return {'ok': True}

    def snapshot(self):
        with self._lock:
            return {'joints_deg': list(self.joints)}


def wait_until(predicate, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return False


def program(steps):
    return json.dumps(steps)


def test_runs_every_step_in_order():
    bridge = FakeBridge()
    runner = ProgramRunner(bridge)
    result = runner.start('pick', program([
        {'kind': 'waypoint', 'joints': [10, 0, 0, 0, 0, 0]},
        {'kind': 'gripper', 'position': 0.0142},
        {'kind': 'waypoint', 'joints': [20, 0, 0, 0, 0, 0]},
    ]))
    assert result['ok']
    assert wait_until(lambda: not runner.status()['running'])

    kinds = [call[0] for call in bridge.calls]
    assert kinds == ['joint_move', 'gripper', 'joint_move']


def test_status_reports_progress_for_spectators():
    # The step counter is what every viewer sees in telemetry, so it has to be
    # populated the whole time the program is running, not only at the end.
    bridge = FakeBridge()
    runner = ProgramRunner(bridge)
    runner.start('demo', program([
        {'kind': 'wait', 'seconds': 0.4},
        {'kind': 'wait', 'seconds': 0.4},
    ]), operator='María Gómez')

    assert wait_until(lambda: runner.status()['stepIndex'] == 0)
    status = runner.status()
    assert status['running'] is True
    assert status['stepCount'] == 2
    assert status['programName'] == 'demo'
    assert status['operatorName'] == 'María Gómez'

    assert wait_until(lambda: not runner.status()['running'], timeout=5)


def test_stop_interrupts_a_long_wait_promptly():
    bridge = FakeBridge()
    runner = ProgramRunner(bridge)
    runner.start('slow', program([{'kind': 'wait', 'seconds': 30}]))
    assert wait_until(lambda: runner.status()['running'])

    started = time.time()
    runner.stop()
    assert wait_until(lambda: not runner.status()['running'], timeout=3)
    # A stop must not have to sit out the wait it interrupted.
    assert time.time() - started < 2.0


def test_a_step_that_never_arrives_ends_the_program():
    # Without this the lab would be held by a program that can never finish.
    bridge = FakeBridge(arrives=False)
    runner = ProgramRunner(bridge)
    import dobot_cr3_weblab.programs as programs_module

    original = programs_module.STEP_TIMEOUT_S
    programs_module.STEP_TIMEOUT_S = 0.4
    try:
        runner.start('stuck', program([
            {'kind': 'waypoint', 'joints': [90, 0, 0, 0, 0, 0]},
            {'kind': 'gripper', 'position': 0.0},
        ]))
        assert wait_until(lambda: not runner.status()['running'], timeout=5)
    finally:
        programs_module.STEP_TIMEOUT_S = original

    # It stopped at the unreachable waypoint instead of carrying on.
    assert [call[0] for call in bridge.calls] == ['joint_move']


def test_only_one_program_runs_at_a_time():
    bridge = FakeBridge()
    runner = ProgramRunner(bridge)
    runner.start('first', program([{'kind': 'wait', 'seconds': 1}]))
    assert wait_until(lambda: runner.status()['running'])

    second = runner.start('second', program([{'kind': 'wait', 'seconds': 1}]))
    assert second['ok'] is False

    runner.stop()
    assert wait_until(lambda: not runner.status()['running'], timeout=3)


def test_malformed_programs_are_refused():
    runner = ProgramRunner(FakeBridge())
    assert runner.start('bad', 'not json')['ok'] is False
    assert runner.start('empty', '[]')['ok'] is False
    assert runner.start('object', '{}')['ok'] is False
    assert runner.status()['running'] is False


def test_unknown_step_kind_stops_rather_than_being_skipped():
    bridge = FakeBridge()
    runner = ProgramRunner(bridge)
    runner.start('weird', program([
        {'kind': 'teleport'},
        {'kind': 'gripper', 'position': 0.0},
    ]))
    assert wait_until(lambda: not runner.status()['running'])
    assert bridge.calls == [], 'execution continued past an unknown step'


def test_wait_is_clamped():
    # A program should not be able to park the hardware for an hour.
    bridge = FakeBridge()
    runner = ProgramRunner(bridge)
    started = time.time()
    runner.start('long', program([{'kind': 'wait', 'seconds': 100000}]))
    assert wait_until(lambda: runner.status()['running'])
    runner.stop()
    assert wait_until(lambda: not runner.status()['running'], timeout=3)
    assert time.time() - started < 5
