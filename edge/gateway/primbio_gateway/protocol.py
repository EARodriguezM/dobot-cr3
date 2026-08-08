"""Just enough of the Foxglove WebSocket protocol (v1) to police it.

The gatekeeper is a transparent proxy in front of ``foxglove_bridge``: it does
not reimplement the protocol, it only needs to understand which frames *ask the
robot to do something* so it can decide whether this client may. Everything
else is relayed untouched, which is what keeps the gatekeeper independent of
bridge version differences.

Frames that matter:

* client → server, JSON — ``subscribe``/``unsubscribe`` (read-only, always
  allowed), ``advertise``/``unadvertise`` (declares intent to publish),
  ``setParameters`` (mutates the robot's configuration), ``getParameters``,
  ``fetchAsset``.
* client → server, binary — opcode 1 publishes a message on a channel the
  client advertised; opcode 2 calls a service. Both actuate.
* server → client, JSON — ``advertiseServices`` and ``advertise`` carry the
  id → name tables the policy needs to name what is being called.

Reference: https://github.com/foxglove/ws-protocol (schema v1).
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Optional

# ── Binary opcodes ──────────────────────────────────────────────────────────

CLIENT_MESSAGE_DATA = 0x01
CLIENT_SERVICE_CALL_REQUEST = 0x02

SERVER_MESSAGE_DATA = 0x01
SERVER_TIME = 0x02
SERVER_SERVICE_CALL_RESPONSE = 0x03
SERVER_FETCH_ASSET_RESPONSE = 0x04

# ── Client JSON operations ──────────────────────────────────────────────────

# Read-only: any authenticated member of the lab may send these. Subscribing is
# how a spectator sees what the operator is doing, so it must never be gated
# behind the control lease.
READ_ONLY_OPS = frozenset(
    {
        'subscribe',
        'unsubscribe',
        'getParameters',
        'subscribeParameterUpdates',
        'unsubscribeParameterUpdates',
        'subscribeConnectionGraph',
        'unsubscribeConnectionGraph',
        'fetchAsset',
    }
)

# Declares that the client intends to publish on a topic. Harmless on its own —
# the publish itself (binary opcode 1) is what gets gated — but restricting it
# keeps unauthorized clients from cluttering the graph.
ADVERTISE_OPS = frozenset({'advertise', 'unadvertise'})

# Mutates robot configuration (speed limits, payload, gripper travel…).
PARAMETER_WRITE_OPS = frozenset({'setParameters'})


@dataclass(frozen=True)
class ServiceCall:
    """A parsed client → server service call request."""

    service_id: int
    call_id: int
    encoding: str
    payload: bytes


def parse_service_call(data: bytes) -> Optional[ServiceCall]:
    """Parse a binary service-call request, or None if it is malformed.

    Layout after the opcode byte: serviceId uint32, callId uint32,
    encodingLength uint32, encoding utf-8, payload. A frame we cannot parse is
    never forwarded — an unparseable actuation request is a rejected one.
    """
    if len(data) < 13 or data[0] != CLIENT_SERVICE_CALL_REQUEST:
        return None
    try:
        service_id, call_id, encoding_len = struct.unpack_from('<III', data, 1)
        start = 13
        end = start + encoding_len
        if end > len(data):
            return None
        encoding = data[start:end].decode('utf-8', errors='replace')
        return ServiceCall(service_id, call_id, encoding, data[end:])
    except Exception:
        return None


def parse_client_publish(data: bytes) -> Optional[int]:
    """Channel id of a binary client publish, or None if malformed."""
    if len(data) < 5 or data[0] != CLIENT_MESSAGE_DATA:
        return None
    try:
        return int(struct.unpack_from('<I', data, 1)[0])
    except Exception:
        return None


def service_names(message: dict) -> dict[int, str]:
    """id → name from a server ``advertiseServices`` frame."""
    out: dict[int, str] = {}
    for service in message.get('services') or []:
        try:
            out[int(service['id'])] = str(service['name'])
        except (KeyError, TypeError, ValueError):
            continue
    return out


def channel_topics(message: dict) -> dict[int, str]:
    """id → topic from a client ``advertise`` frame."""
    out: dict[int, str] = {}
    for channel in message.get('channels') or []:
        try:
            out[int(channel['id'])] = str(channel['topic'])
        except (KeyError, TypeError, ValueError):
            continue
    return out
