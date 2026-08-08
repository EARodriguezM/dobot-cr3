"""Unit tests for the authorization rules.

These encode the two invariants named at the top of policy.py. If a change
makes one of these fail, the change is wrong, not the test.
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from primbio_gateway.auth import Identity  # noqa: E402
from primbio_gateway import policy  # noqa: E402

VIEWER = Identity('u-viewer', 'v@unal.edu.co', 'Viewer', 'viewer')
OPERATOR = Identity('u-op', 'o@unal.edu.co', 'Operator', 'operator')
ADMIN = Identity('u-admin', 'a@unal.edu.co', 'Admin', 'admin')
OWNER = Identity('u-owner', 'w@unal.edu.co', 'Owner', 'owner')


# ── Invariant 1: stopping is never gated by the lease ───────────────────────

def test_every_stop_works_without_the_lease():
    for service in policy.STOP_SERVICES:
        decision = policy.check_service_call(service, OPERATOR, holds_lease=False)
        assert decision.allowed, f'{service} must not require the lease'
        assert decision.is_stop


def test_stops_still_require_the_operator_role():
    for service in policy.STOP_SERVICES:
        assert not policy.check_service_call(service, VIEWER, holds_lease=False).allowed
        # Even holding a lease does not promote a viewer.
        assert not policy.check_service_call(service, VIEWER, holds_lease=True).allowed


# ── Invariant 2: motion needs role AND lease ────────────────────────────────

def test_motion_requires_both_role_and_lease():
    for service in policy.LEASED_SERVICES:
        assert not policy.check_service_call(service, OPERATOR, holds_lease=False).allowed
        assert not policy.check_service_call(service, VIEWER, holds_lease=True).allowed
        assert policy.check_service_call(service, OPERATOR, holds_lease=True).allowed


def test_owner_and_admin_may_drive():
    for identity in (ADMIN, OWNER):
        assert policy.check_service_call('/weblab/jog', identity, holds_lease=True).allowed


# ── Default deny ────────────────────────────────────────────────────────────

def test_unknown_and_raw_driver_services_are_denied():
    for service in (
        None,
        '/dobot_cr3_bringup/srv/EnableRobot',   # the raw driver is never exposed
        '/weblab/../etc/passwd',
        '/rosout/set_logger_levels',
    ):
        assert not policy.check_service_call(service, OWNER, holds_lease=True).allowed


def test_read_only_ops_are_open_to_viewers():
    # A spectator must be able to subscribe: that is how they see what the
    # operator is doing.
    for op in ('subscribe', 'unsubscribe', 'getParameters', 'fetchAsset'):
        assert policy.check_json_op(op, VIEWER, holds_lease=False).allowed


def test_parameter_writes_need_admin_and_lease():
    assert not policy.check_json_op('setParameters', OPERATOR, holds_lease=True).allowed
    assert not policy.check_json_op('setParameters', ADMIN, holds_lease=False).allowed
    assert policy.check_json_op('setParameters', ADMIN, holds_lease=True).allowed


def test_publishing_is_closed():
    assert not policy.check_publish('/anything', OWNER, holds_lease=True).allowed
    assert not policy.check_json_op('advertise', OWNER, holds_lease=True).allowed


def test_unknown_json_ops_are_denied():
    assert not policy.check_json_op('callService', OWNER, holds_lease=True).allowed
    assert not policy.check_json_op('', OWNER, holds_lease=True).allowed


# ── Read-only actions are not announced, actuation is ───────────────────────

def test_only_actuation_produces_an_activity_label():
    assert policy.check_json_op('subscribe', VIEWER, False).activity is None
    assert policy.check_service_call('/weblab/jog', OPERATOR, True).activity == '/weblab/jog'
    assert policy.check_service_call('/weblab/estop', OPERATOR, False).activity == (
        '/weblab/estop'
    )
