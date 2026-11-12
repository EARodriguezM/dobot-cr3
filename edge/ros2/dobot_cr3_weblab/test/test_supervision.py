"""Noticing that the arm moved when the platform did not move it.

The Dobot's own TCP protocol has no authentication: anything that can reach the
controller on port 29999 can enable and drive this arm without a session, a
role, or the control lease. The platform cannot refuse that command — the robot
is the listener, and an unauthorised client never passes through the weblab
node at all. The fix for the reachability is a network one
(docs/robot-network.md); the fix for the *silence* is here.

Before this, `enabled` was set from the platform's own commands and never read
back, so an out-of-band command left the console drawing a disabled arm while
it moved. These tests pin the two things that changed: the robot is now the
authority on its own state, and a state the platform did not ask for is
reported rather than absorbed.

Runs without ROS: the reconciliation is pure state, so the ROS import is turned
off and a stand-in node is enough.
"""

import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from dobot_cr3_weblab import bridge as bridge_module  # noqa: E402

# Read at call time by __init__, so this keeps _build() (which needs a live ROS
# graph) out of the way without touching the logic under test.
bridge_module.ROS_AVAILABLE = False

from dobot_cr3_weblab.bridge import RobotBridge  # noqa: E402

DISABLED = 4
ENABLED = 5
JOGGING = 11
ERROR = 9


def bridge():
    return RobotBridge(node=None)


def supervision(b):
    return b.snapshot()['supervision']


# ── What the platform did ask for ───────────────────────────────────────────

def test_a_commanded_enable_is_accounted_for():
    b = bridge()
    b._commanded_motion = True          # what enable() records
    b._last_command_at = time.time()

    assert b._reconcile(ENABLED) is None, 'our own command was reported as foreign'
    assert supervision(b)['attributed'] is True
    assert supervision(b)['since'] is None


def test_a_command_still_taking_effect_is_covered_by_the_grace_window():
    """Between the command landing and the mode changing there is a mismatch,
    and it is ours."""
    b = bridge()
    b._last_command_at = time.time()    # commanded just now, mode not yet moved

    assert b._reconcile(ENABLED) is None
    assert supervision(b)['attributed'] is True


# ── What it did not ─────────────────────────────────────────────────────────

def test_an_arm_energised_by_nobody_is_reported():
    b = bridge()
    b._last_command_at = 0.0            # nothing commanded, ever

    message = b._reconcile(ENABLED)
    assert message is not None, 'the arm was energised and nothing said so'
    assert 'UNATTRIBUTED' in message
    state = supervision(b)
    assert state['attributed'] is False
    assert state['since'] is not None
    assert state['modeLabel'] == 'enabled'


def test_it_reports_the_change_not_the_condition():
    """A lab left in this state must not fill the log with one line a second."""
    b = bridge()
    b._last_command_at = 0.0

    assert b._reconcile(ENABLED) is not None
    assert b._reconcile(ENABLED) is None
    assert b._reconcile(JOGGING) is None
    assert supervision(b)['attributed'] is False


def test_since_marks_when_it_started_and_does_not_drift():
    b = bridge()
    b._last_command_at = 0.0

    b._reconcile(ENABLED)
    started = supervision(b)['since']
    time.sleep(0.05)
    b._reconcile(JOGGING)

    assert supervision(b)['since'] == started


def test_going_back_to_disabled_clears_it():
    b = bridge()
    b._last_command_at = 0.0
    b._reconcile(ENABLED)

    message = b._reconcile(DISABLED)
    assert message is not None and 'accounted for' in message
    state = supervision(b)
    assert state['attributed'] is True
    assert state['since'] is None


def test_an_unknown_mode_counts_as_energised():
    """A vendor mode this code has never heard of must raise the alarm, not
    silence it: the safe reading of 'I do not recognise this' is 'the arm may
    be moving'."""
    b = bridge()
    b._last_command_at = 0.0

    assert b._reconcile(97) is not None
    assert supervision(b)['attributed'] is False


def test_brakes_on_modes_are_never_an_alarm():
    for mode in (DISABLED, ERROR):
        b = bridge()
        b._last_command_at = 0.0
        assert b._reconcile(mode) is None, f'mode {mode} alarmed with the brakes on'
        assert supervision(b)['attributed'] is True


# ── The robot outranks our own bookkeeping ──────────────────────────────────

def test_enabled_now_comes_from_the_robot():
    """The bug underneath the blind spot: `enabled` was whatever we last
    commanded, so a disable issued outside the platform never showed up."""
    b = bridge()
    b._commanded_motion = True
    b._state['enabled'] = True          # what the platform believed
    b._last_command_at = time.time()

    b._reconcile(DISABLED)
    assert b.snapshot()['enabled'] is False


def test_an_out_of_band_stop_resyncs_instead_of_drifting():
    """Somebody disables the arm at the pendant. That is not an alarm, but the
    platform must not keep believing it holds an enabled arm — otherwise the
    next unattributed enable would look like ours."""
    b = bridge()
    b._commanded_motion = True
    b._last_command_at = 0.0

    b._reconcile(DISABLED)
    assert b._commanded_motion is False

    message = b._reconcile(ENABLED)
    assert message is not None and 'UNATTRIBUTED' in message
