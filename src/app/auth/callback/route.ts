import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/supabase/env";
import { ensureProfile } from "@/lib/profile";

// Same contract as the hub's callback: PKCE exchange, institutional-domain
// re-check (the DB trigger is the authoritative gate) and profile upsert, so
// a lab origin can complete sign-in on its own when the user lands here
// directly instead of through the hub.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  const loginWithError = (kind: string) =>
    NextResponse.redirect(new URL(`/login?error=${kind}`, url.origin));

  if (!code) return loginWithError("auth");

  const supabase = await createClient();
  if (!supabase) return loginWithError("auth");

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) return loginWithError("auth");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return loginWithError("auth");

  if (!isAllowedEmail(user.email)) {
    await supabase.auth.signOut();
    return loginWithError("domain");
  }

  // Best effort, and not the thing that creates the row — a trigger on
  // auth.users does that since hub migration 0013 (see lib/profile.ts). Sign-in
  // continues either way; a warning is enough, because the account is complete
  // without this write succeeding.
  const failure = await ensureProfile(supabase, user);
  if (failure) {
    console.warn("[auth] profile refresh skipped for %s: %s", user.id, failure);
  }

  return NextResponse.redirect(new URL(safeNext, url.origin));
}
