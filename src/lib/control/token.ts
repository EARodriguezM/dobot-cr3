import { SignJWT } from "jose";
import { getLabSlug } from "@/lib/lab";
import type { ControlUser } from "./store";

// The credential that ties this app's Redis lease to the hardware.
//
// The edge gatekeeper cannot see Redis — it sits on the lab computer behind an
// outbound-only tunnel — so "does this person currently hold control?" has to
// travel to it as something unforgeable. That is this token: signed with a
// secret shared only between this app and the gatekeeper, bound to one user
// and one lab, and deliberately short-lived.
//
// Short-lived is the safety property. The browser refreshes it on every lease
// heartbeat (5 s); if the operator's tab dies, the lease expires here and the
// token simply stops being reissued, so the gatekeeper starts refusing motion
// within one token lifetime without ever learning why. Nothing has to be
// revoked, and no message has to arrive for the hardware to become safe.

// Longer than the 5 s heartbeat so a token is always replaced well before it
// lapses, and short enough that an operator who has just been handed over,
// forced out or disconnected stops being able to command the hardware quickly.
// The browser also revokes its own token at the edge the moment the state
// stream says it is no longer the holder; this bound is the backstop for a
// client that does not cooperate.
const TOKEN_TTL_SECONDS = 10;

export function isLeaseSigningConfigured(): boolean {
  return Boolean(process.env.LAB_CONTROL_SIGNING_SECRET);
}

function getSecret(): Uint8Array | null {
  const secret = process.env.LAB_CONTROL_SIGNING_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

/**
 * Mint a lease token for the current holder. Returns null when signing is not
 * configured, which leaves the lab view-only rather than failing open.
 */
export async function mintLeaseToken(user: ControlUser): Promise<string | null> {
  const secret = getSecret();
  if (!secret) return null;

  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    // The gatekeeper checks the audience, so a token minted for one lab is
    // useless at another even though they share the platform.
    .setAudience(getLabSlug())
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}
