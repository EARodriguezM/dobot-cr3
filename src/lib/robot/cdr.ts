// Minimal CDR reader for exactly one shape: a `std_msgs/msg/String`.
//
// foxglove_bridge advertises ROS 2 channels with CDR-encoded payloads, so a
// browser normally needs a full ROS message deserializer to read anything. The
// weblab node sidesteps that by publishing its web-facing telemetry as a single
// JSON document inside a std_msgs/String — one topic, one decode path, and no
// message-definition parser shipped to the browser.
//
// The node still publishes properly typed topics alongside it (joint states,
// tool pose) for rviz, rosbag and Foxglove Studio; this one exists for the web
// client, and the duplication is deliberate.

const ENCAPSULATION_HEADER_BYTES = 4;

/**
 * Read a CDR-encoded std_msgs/String, or null if the buffer is not one.
 *
 * Layout: 2-byte encapsulation scheme (0x0000 big-endian, 0x0001 little),
 * 2 bytes options, uint32 length including the trailing NUL, then the bytes.
 */
export function decodeCdrString(buffer: ArrayBuffer): string | null {
  if (buffer.byteLength < ENCAPSULATION_HEADER_BYTES + 4) return null;
  const view = new DataView(buffer);

  // Byte 1 of the encapsulation scheme: 1 = little-endian (CDR_LE), which is
  // what every ROS 2 middleware emits on the platforms this lab runs on. Big
  // endian is handled anyway because it costs one boolean.
  const littleEndian = view.getUint8(1) === 1;
  const length = view.getUint32(ENCAPSULATION_HEADER_BYTES, littleEndian);
  const start = ENCAPSULATION_HEADER_BYTES + 4;
  if (length === 0 || start + length > buffer.byteLength) return null;

  // The length includes the NUL terminator; drop it.
  const bytes = new Uint8Array(buffer, start, length - 1);
  return new TextDecoder().decode(bytes);
}

/** Parse a CDR std_msgs/String whose contents are JSON. */
export function decodeCdrJson<T>(buffer: ArrayBuffer): T | null {
  const text = decodeCdrString(buffer);
  if (text == null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
