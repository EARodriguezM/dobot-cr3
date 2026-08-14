"""Just enough CDR to read what a browser asked the robot to do.

``foxglove_bridge`` advertises ``cdr`` as the request encoding for every ROS 2
service, so that is what the web client sends and what the gatekeeper sees. Two
things here need to understand those bytes:

* the **activity feed**, which broadcasts *what* was commanded, not merely that
  something was — "movió un eje" without the axis is not much of a log;
* the **HTTP emergency stop**, which builds a request of its own and has to
  build it in the encoding the bridge accepts.

Deliberately a reader for the handful of shapes ``src/lib/robot/commands.ts``
can produce, not a general deserializer. Field order below must stay in step
with the ``.srv`` files in ``edge/ros2/dobot_cr3_weblab_msgs/srv`` — CDR is
positional, so a reordered field is silently a different number.

Layout rules: a 4-byte encapsulation header (byte 1 selects endianness), then
every field aligned to its own width, measured from the end of that header. A
string is a uint32 byte count including its NUL terminator, then the bytes.
"""

from __future__ import annotations

import struct
from typing import Any, Dict, List, Optional

HEADER_LEN = 4

# std_srvs/srv/Trigger takes no arguments, but an empty ROS struct still
# serializes to one placeholder byte. Four bytes of header alone come back as
# "Service failed to send a response" — the request never reaches the handler.
EMPTY_REQUEST = bytes([0x00, 0x01, 0x00, 0x00, 0x00])


class CdrReader:
    """Positional reader over one CDR-encoded message body."""

    def __init__(self, data: bytes):
        self.data = data
        self.little = len(data) > 1 and data[1] in (1, 3)
        self.offset = HEADER_LEN

    @property
    def _body_offset(self) -> int:
        return self.offset - HEADER_LEN

    def _align(self, size: int) -> None:
        padding = (size - (self._body_offset % size)) % size
        self.offset += padding

    def _take(self, fmt: str, size: int):
        self._align(size)
        if self.offset + size > len(self.data):
            raise ValueError('truncated CDR message')
        value = struct.unpack_from(('<' if self.little else '>') + fmt,
                                   self.data, self.offset)[0]
        self.offset += size
        return value

    def uint32(self) -> int:
        return int(self._take('I', 4))

    def int32(self) -> int:
        return int(self._take('i', 4))

    def float64(self) -> float:
        return float(self._take('d', 8))

    def string(self) -> str:
        length = self.uint32()
        if length == 0:
            return ''
        end = self.offset + length
        if end > len(self.data):
            raise ValueError('truncated CDR string')
        # The declared length counts the NUL terminator.
        text = self.data[self.offset:end - 1].decode('utf-8', errors='replace')
        self.offset = end
        return text

    def float64_sequence(self) -> List[float]:
        return [self.float64() for _ in range(self.uint32())]

    def boolean(self) -> bool:
        self._align(1)
        if self.offset >= len(self.data):
            raise ValueError('truncated CDR message')
        value = self.data[self.offset] != 0
        self.offset += 1
        return value


# ── Requests, by service ────────────────────────────────────────────────────

def _jog(reader: CdrReader) -> Dict[str, Any]:
    return {'axis_id': reader.string()}


def _set_speed(reader: CdrReader) -> Dict[str, Any]:
    return {'ratio': reader.int32()}


def _joint_move(reader: CdrReader) -> Dict[str, Any]:
    return {'joints_deg': reader.float64_sequence()}


def _cart_move(reader: CdrReader) -> Dict[str, Any]:
    return {axis: reader.float64() for axis in ('x', 'y', 'z', 'rx', 'ry', 'rz')}


def _gripper(reader: CdrReader) -> Dict[str, Any]:
    return {'position': reader.float64(), 'max_effort': reader.float64()}


def _program_run(reader: CdrReader) -> Dict[str, Any]:
    # steps_json is skipped on purpose: a whole program does not belong in a
    # one-line activity entry, and the name is what identifies it.
    return {'name': reader.string()}


REQUEST_READERS = {
    '/weblab/jog': _jog,
    '/weblab/set_speed': _set_speed,
    '/weblab/joint_move': _joint_move,
    '/weblab/cart_move': _cart_move,
    '/weblab/gripper': _gripper,
    '/weblab/program_run': _program_run,
}


def read_request(service: str, payload: bytes) -> Optional[Dict[str, Any]]:
    """Decode a service request into the shape the activity feed describes.

    Returns None for services that take no arguments, and for anything that
    does not decode — a malformed payload must not stop the command being
    announced, only leave it without a detail line.
    """
    reader_fn = REQUEST_READERS.get(service)
    if reader_fn is None:
        return None
    try:
        return reader_fn(CdrReader(payload))
    except Exception:
        return None


def read_result(payload: bytes) -> Optional[Dict[str, Any]]:
    """Read a ``bool success, string message`` response.

    The shape of std_srvs/srv/Trigger and of every weblab service.
    """
    try:
        reader = CdrReader(payload)
        return {'ok': reader.boolean(), 'message': reader.string()}
    except Exception:
        return None
