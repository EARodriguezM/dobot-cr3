"""Unit tests for the CDR reader.

The bytes under test are built here the same way the browser builds them
(`src/lib/robot/cdr-writer.ts`), because that is the only contract that
matters: these two implementations sit at opposite ends of a WebSocket and
never see each other's source. If the writer changes, one of these fails.
"""

import pathlib
import struct
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from primbio_gateway import cdr  # noqa: E402

HEADER = bytes([0x00, 0x01, 0x00, 0x00])


# ── The writer, as the browser implements it ────────────────────────────────

class Writer:
    """Mirror of the TypeScript CdrWriter, so the tests exercise real bytes."""

    def __init__(self):
        self.body = bytearray()

    def _align(self, size):
        padding = (size - (len(self.body) % size)) % size
        self.body.extend(b'\x00' * padding)

    def int32(self, value):
        self._align(4)
        self.body.extend(struct.pack('<i', value))
        return self

    def uint32(self, value):
        self._align(4)
        self.body.extend(struct.pack('<I', value))
        return self

    def float64(self, value):
        self._align(8)
        self.body.extend(struct.pack('<d', value))
        return self

    def string(self, value):
        encoded = value.encode('utf-8')
        self.uint32(len(encoded) + 1)  # the count includes the terminator
        self.body.extend(encoded)
        self.body.append(0)
        return self

    def boolean(self, value):
        self.body.append(1 if value else 0)
        return self

    def finish(self):
        return HEADER + bytes(self.body)


# ── Requests ────────────────────────────────────────────────────────────────

def test_jog_carries_the_axis():
    payload = Writer().string('J3+').finish()
    assert cdr.read_request('/weblab/jog', payload) == {'axis_id': 'J3+'}


def test_jog_stop_is_an_empty_axis():
    payload = Writer().string('').finish()
    assert cdr.read_request('/weblab/jog', payload) == {'axis_id': ''}


def test_set_speed_carries_the_ratio():
    payload = Writer().int32(35).finish()
    assert cdr.read_request('/weblab/set_speed', payload) == {'ratio': 35}


def test_joint_move_carries_every_angle():
    angles = [10.0, -20.5, 87.25, 0.0, -1.5, 180.0]
    payload = Writer().uint32(len(angles))
    for angle in angles:
        payload.float64(angle)
    detail = cdr.read_request('/weblab/joint_move', payload.finish())
    assert detail == {'joints_deg': angles}


def test_cart_move_keeps_the_axes_in_order():
    pose = [220.0, -15.0, 180.0, 180.0, 0.0, -30.0]
    writer = Writer()
    for value in pose:
        writer.float64(value)
    detail = cdr.read_request('/weblab/cart_move', writer.finish())
    assert detail == {'x': 220.0, 'y': -15.0, 'z': 180.0,
                      'rx': 180.0, 'ry': 0.0, 'rz': -30.0}


def test_gripper_reads_position_and_effort():
    payload = Writer().float64(0.0142).float64(50.0).finish()
    detail = cdr.read_request('/weblab/gripper', payload)
    assert detail == {'position': 0.0142, 'max_effort': 50.0}


def test_program_run_reports_the_name_only():
    payload = Writer().string('pick and place').string('[{"a":1}]').finish()
    detail = cdr.read_request('/weblab/program_run', payload)
    assert detail == {'name': 'pick and place'}


def test_a_service_without_arguments_has_no_detail():
    assert cdr.read_request('/weblab/enable', cdr.EMPTY_REQUEST) is None


def test_a_truncated_payload_is_not_an_error():
    """A malformed detail must cost the detail, never the activity entry."""
    assert cdr.read_request('/weblab/jog', b'\x00\x01') is None
    assert cdr.read_request('/weblab/cart_move', HEADER + b'\x01\x02') is None


# ── Responses ───────────────────────────────────────────────────────────────

def test_reads_a_failed_trigger_response():
    message = 'el servicio enable no responde'
    payload = Writer().boolean(False).string(message).finish()
    assert cdr.read_result(payload) == {'ok': False, 'message': message}


def test_reads_a_successful_trigger_response():
    payload = Writer().boolean(True).string('').finish()
    assert cdr.read_result(payload) == {'ok': True, 'message': ''}


def test_the_empty_request_carries_the_placeholder_byte():
    """Four bytes of header alone never reach the service handler."""
    assert cdr.EMPTY_REQUEST == HEADER + b'\x00'
