"""What an authenticated client is allowed to ask the robot to do.

This is the whole authorization surface of the edge, in one file, deliberately
written as data rather than as code scattered through the proxy. Two rules
carry the safety of the lab and are called out because they are the ones a
future change is most likely to get wrong:

1. **Stopping is never gated by the control lease.** Every service that reduces
   motion — emergency stop, disable, jog stop, program stop — requires the
   operator role and nothing more. Any operator can stop the arm while somebody
   else is driving it. Do not "tidy" these into the leased set.

2. **Everything that increases motion needs both.** The operator role *and* a
   live lease token. Losing either (role revoked, browser died, network
   dropped, lease taken over) stops actuation within one lease TTL without this
   process needing to know why.

Anything not named here is denied. A new capability is added by adding it to a
set below, which is a reviewable one-line diff.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .auth import Identity
from . import protocol

# ── The service surface ─────────────────────────────────────────────────────
# Names are the weblab node's, not the raw driver's: the bridge only ever sees
# this small vetted surface, never /dobot_cr3_bringup/srv/* directly.

SERVICE_PREFIX = '/weblab/'

# Reduce or halt motion. Operator role only — deliberately lease-free.
STOP_SERVICES = frozenset(
    {
        '/weblab/estop',
        '/weblab/disable',
        '/weblab/jog_stop',
        '/weblab/program_stop',
    }
)

# Command motion or change robot state. Operator role AND the control lease.
LEASED_SERVICES = frozenset(
    {
        '/weblab/enable',
        '/weblab/clear_error',
        '/weblab/set_speed',
        '/weblab/jog',
        '/weblab/joint_move',
        '/weblab/cart_move',
        '/weblab/home',
        '/weblab/gripper',
        '/weblab/program_run',
    }
)

# Read-only queries. Any member, including viewers: this is how a spectator's
# screen stays in sync with the operator's.
READ_SERVICES = frozenset({'/weblab/state', '/weblab/describe'})

# Topics a client may publish to. Empty on purpose — in this lab every
# actuation is a service call, so a client publish is always a mistake or an
# attack. Extend deliberately if a future feature needs a command stream.
PUBLISHABLE_TOPICS: frozenset[str] = frozenset()


@dataclass(frozen=True)
class Decision:
    allowed: bool
    reason: str = ''
    # Machine-readable label broadcast to every viewer when the action is
    # allowed. Left untranslated: the UI owns Spanish copy.
    activity: Optional[str] = None
    # True when the action is a stop, which the UI highlights differently.
    is_stop: bool = False


ALLOW_SILENT = Decision(allowed=True)


def _deny(reason: str) -> Decision:
    return Decision(allowed=False, reason=reason)


def check_service_call(
    service_name: Optional[str], identity: Identity, holds_lease: bool
) -> Decision:
    """Authorize one service call."""
    if service_name is None:
        return _deny('unknown service')

    if service_name in READ_SERVICES:
        return ALLOW_SILENT

    if service_name in STOP_SERVICES:
        if not identity.at_least('operator'):
            return _deny('se requiere rol de operador')
        # Announced to everyone: a stop is exactly the sort of thing the other
        # viewers need to see immediately, whoever triggered it.
        return Decision(allowed=True, activity=service_name, is_stop=True)

    if service_name in LEASED_SERVICES:
        if not identity.at_least('operator'):
            return _deny('se requiere rol de operador')
        if not holds_lease:
            return _deny('no tienes el control del hardware')
        return Decision(allowed=True, activity=service_name)

    return _deny(f'service {service_name} is not exposed to the web client')


def check_json_op(
    op: str, identity: Identity, holds_lease: bool
) -> Decision:
    """Authorize one client → server JSON frame."""
    if op in protocol.READ_ONLY_OPS:
        return ALLOW_SILENT

    if op in protocol.ADVERTISE_OPS:
        # Declaring a publisher is only useful if publishing is allowed, and it
        # is not (PUBLISHABLE_TOPICS is empty), so refuse it up front rather
        # than letting the client believe it worked.
        if not PUBLISHABLE_TOPICS:
            return _deny('publishing is not available on this lab')
        if not identity.at_least('operator') or not holds_lease:
            return _deny('no tienes el control del hardware')
        return ALLOW_SILENT

    if op in protocol.PARAMETER_WRITE_OPS:
        # Robot configuration (speed limits, payload, gripper travel) is an
        # admin act, and it changes how subsequent motion behaves, so it also
        # requires the lease.
        if not identity.at_least('admin'):
            return _deny('se requiere rol de administrador')
        if not holds_lease:
            return _deny('no tienes el control del hardware')
        return Decision(allowed=True, activity='setParameters')

    return _deny(f'operation {op} is not allowed')


def check_publish(topic: Optional[str], identity: Identity, holds_lease: bool) -> Decision:
    """Authorize one binary client publish."""
    if topic is None or topic not in PUBLISHABLE_TOPICS:
        return _deny('publishing is not available on this lab')
    if not identity.at_least('operator') or not holds_lease:
        return _deny('no tienes el control del hardware')
    return Decision(allowed=True, activity=f'publish {topic}')
