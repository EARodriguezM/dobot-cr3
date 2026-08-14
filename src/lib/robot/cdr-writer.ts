// Minimal CDR writer for the service requests this lab sends.
//
// foxglove_bridge advertises `cdr` as the request encoding for every ROS 2
// service, even though it lists `json` among the encodings it supports overall
// — that list is about what the *server* can handle in general, not what a
// given service will accept. Sending JSON gets an "Unsupported encoding"
// rejection and the command silently never reaches the robot.
//
// Only the shapes in `commands.ts` are needed, so this implements the parts of
// XCDR1 they use rather than a general serializer: primitives, strings and one
// sequence of float64. If a new service takes a nested message, this needs
// extending — or the request needs flattening, which is usually the better
// answer for something a browser is allowed to call.
//
// Layout rules that matter here:
//   * 4-byte encapsulation header first: 00 01 00 00 (little-endian CDR).
//   * Every field is aligned to its own size, measured from the *end* of that
//     header — getting this wrong produces plausible-looking garbage rather
//     than an error.
//   * A string is a uint32 byte count that includes its NUL terminator,
//     then the bytes, then the NUL.

const ENCAPSULATION_HEADER = [0x00, 0x01, 0x00, 0x00];

export class CdrWriter {
  private bytes: number[] = [...ENCAPSULATION_HEADER];

  /** Offset used for alignment: relative to the end of the header. */
  private get bodyLength(): number {
    return this.bytes.length - ENCAPSULATION_HEADER.length;
  }

  private align(size: number): void {
    const padding = (size - (this.bodyLength % size)) % size;
    for (let i = 0; i < padding; i++) this.bytes.push(0);
  }

  private push(view: DataView, size: number): void {
    for (let i = 0; i < size; i++) this.bytes.push(view.getUint8(i));
  }

  uint32(value: number): this {
    this.align(4);
    const view = new DataView(new ArrayBuffer(4));
    view.setUint32(0, value >>> 0, true);
    this.push(view, 4);
    return this;
  }

  int32(value: number): this {
    this.align(4);
    const view = new DataView(new ArrayBuffer(4));
    view.setInt32(0, value | 0, true);
    this.push(view, 4);
    return this;
  }

  float64(value: number): this {
    this.align(8);
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value, true);
    this.push(view, 8);
    return this;
  }

  string(value: string): this {
    const encoded = new TextEncoder().encode(value);
    // The declared length counts the terminator.
    this.uint32(encoded.length + 1);
    for (const byte of encoded) this.bytes.push(byte);
    this.bytes.push(0);
    return this;
  }

  /** An unbounded sequence of float64, as `float64[]` in a .srv file. */
  float64Sequence(values: number[]): this {
    this.uint32(values.length);
    for (const value of values) this.float64(value);
    return this;
  }

  finish(): ArrayBuffer {
    return new Uint8Array(this.bytes).buffer;
  }
}

/**
 * An empty request, e.g. std_srvs/srv/Trigger.
 *
 * The header alone is not enough: a body of exactly four bytes is rejected
 * with "Service failed to send a response", while the same call with one
 * trailing byte succeeds. An empty struct still serializes to a single
 * placeholder byte, and the middleware will not accept a request without it —
 * a distinction worth keeping written down, because the error names neither
 * the encoding nor the length.
 */
export function emptyRequest(): ArrayBuffer {
  return new Uint8Array([...ENCAPSULATION_HEADER, 0x00]).buffer;
}

/**
 * Read a `bool success, string message` response (std_srvs/srv/Trigger and the
 * weblab services, which all answer in that shape).
 */
export function readResultResponse(
  buffer: ArrayBuffer,
): { ok: boolean; message: string } | null {
  if (buffer.byteLength < 5) return null;
  const view = new DataView(buffer);
  const littleEndian = view.getUint8(1) === 1;
  const ok = view.getUint8(4) !== 0;
  // bool is one byte; the string length that follows is aligned to 4.
  const lengthOffset = 8;
  if (buffer.byteLength < lengthOffset + 4) return { ok, message: "" };
  const length = view.getUint32(lengthOffset, littleEndian);
  const start = lengthOffset + 4;
  if (length === 0 || start + length > buffer.byteLength) return { ok, message: "" };
  const message = new TextDecoder().decode(
    new Uint8Array(buffer, start, length - 1),
  );
  return { ok, message };
}
