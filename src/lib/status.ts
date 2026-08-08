// Effective lab status. Labs report themselves via heartbeat (last_seen_at);
// status is always computed from freshness, never stored or hand-typed.
// Deliberately NOT server-only: later phases re-evaluate freshness in the
// browser, because a lab that dies emits no row change to subscribe to.

export const HEARTBEAT_WINDOW_MS = 90_000;

export type LabStatus = "online" | "offline";

export function labStatus(
  lastSeenAt: string | null | undefined,
  now: number = Date.now(),
): LabStatus {
  if (!lastSeenAt) return "offline";
  const seen = Date.parse(lastSeenAt);
  if (Number.isNaN(seen)) return "offline";
  return now - seen <= HEARTBEAT_WINDOW_MS ? "online" : "offline";
}
