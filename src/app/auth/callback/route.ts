import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/supabase/env";

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

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  await supabase.from("profiles").upsert({
    id: user.id,
    email: user.email,
    full_name: typeof meta.full_name === "string" ? meta.full_name : null,
    avatar_url: typeof meta.avatar_url === "string" ? meta.avatar_url : null,
    updated_at: new Date().toISOString(),
  });

  return NextResponse.redirect(new URL(safeNext, url.origin));
}
