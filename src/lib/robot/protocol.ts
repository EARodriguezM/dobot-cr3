// Browser half of the Foxglove WebSocket protocol (v1), plus the few extra
// frames the edge gatekeeper adds.
//
// Only what this lab needs: subscribe to telemetry, call services, and receive
// the gatekeeper's activity/presence/denied frames. Deliberately hand-rolled
// rather than pulling in @foxglove/ws-protocol — the wire format is a dozen
// lines of DataView and the dependency would ship a decoder stack we do not
// use.

export const FOXGLOVE_SUBPROTOCOL = "foxglove.websocket.v1";

export const CLIENT_MESSAGE_DATA = 0x01;
export const CLIENT_SERVICE_CALL_REQUEST = 0x02;

export const SERVER_MESSAGE_DATA = 0x01;
export const SERVER_TIME = 0x02;
export const SERVER_SERVICE_CALL_RESPONSE = 0x03;

export interface Channel {
  id: number;
  topic: string;
  encoding: string;
  schemaName: string;
}

export interface Service {
  id: number;
  name: string;
  type: string;
}

/** A command the gatekeeper accepted and relayed, broadcast to every viewer. */
export interface ActivityEvent {
  op: "activity";
  id: string;
  ts: number;
  user: { id: string; name: string };
  action: string;
  detail: unknown;
  stop: boolean;
}

export interface PresenceEvent {
  op: "presence";
  event: "join" | "leave";
  ts: number;
  user: { id: string; name: string; role: string };
  viewers: number;
}

export interface HelloEvent {
  op: "hello";
  session: string;
  user: { id: string; name: string; email: string; role: string };
  holdsLease: boolean;
  viewers: number;
}

export interface DeniedEvent {
  op: "denied";
  reason: string;
  request: string | null;
  callId: number | null;
}

/** Encode a service-call request frame carrying an already-serialized body. */
export function encodeServiceCall(
  serviceId: number,
  callId: number,
  requestBody: ArrayBuffer,
): ArrayBuffer {
  const encoder = new TextEncoder();
  // Not "json": the bridge advertises cdr per service and rejects json with
  // "Unsupported encoding", which never reaches the robot and never appears
  // as a failure the user can see.
  const encoding = encoder.encode("cdr");
  const body = new Uint8Array(requestBody);
  const buffer = new ArrayBuffer(1 + 12 + encoding.length + body.length);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setUint8(0, CLIENT_SERVICE_CALL_REQUEST);
  view.setUint32(1, serviceId, true);
  view.setUint32(5, callId, true);
  view.setUint32(9, encoding.length, true);
  bytes.set(encoding, 13);
  bytes.set(body, 13 + encoding.length);
  return buffer;
}

export interface DecodedMessage {
  subscriptionId: number;
  /** The message body, still CDR-encoded. */
  payload: ArrayBuffer;
}

/** Decode a server message-data frame (opcode 1). */
export function decodeMessageData(buffer: ArrayBuffer): DecodedMessage | null {
  if (buffer.byteLength < 13) return null;
  const view = new DataView(buffer);
  if (view.getUint8(0) !== SERVER_MESSAGE_DATA) return null;
  return {
    subscriptionId: view.getUint32(1, true),
    // Bytes 5..13 are the receive timestamp, which we do not use: the message
    // itself carries a ROS header stamp when it matters.
    payload: buffer.slice(13),
  };
}

export interface DecodedServiceResponse {
  serviceId: number;
  callId: number;
  /** The response body, still CDR-encoded. */
  payload: ArrayBuffer;
}

/** Decode a server service-call response frame (opcode 3). */
export function decodeServiceResponse(
  buffer: ArrayBuffer,
): DecodedServiceResponse | null {
  if (buffer.byteLength < 13) return null;
  const view = new DataView(buffer);
  if (view.getUint8(0) !== SERVER_SERVICE_CALL_RESPONSE) return null;
  const serviceId = view.getUint32(1, true);
  const callId = view.getUint32(5, true);
  const encodingLength = view.getUint32(9, true);
  const start = 13 + encodingLength;
  if (start > buffer.byteLength) return null;
  // Bodies are CDR, not text: decoding them as UTF-8 mangles every float in
  // them. The caller gets the bytes and picks the right reader.
  return { serviceId, callId, payload: buffer.slice(start) };
}
