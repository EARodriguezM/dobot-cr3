import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  getCookieDomain,
  getSupabaseAnonKey,
  getSupabaseUrl,
  isAllowedEmail,
  isSupabaseConfigured,
} from "./env";
import type { Database } from "./types";

// A lab app is gated whole: everything except sign-in, the auth callback and
// the control API (which authenticates per request and must answer JSON, not
// redirects) requires a session.
const PUBLIC_PREFIXES = ["/login", "/auth", "/api"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (!isSupabaseConfigured()) {
    // Demo mode: without Supabase the lab runs unauthenticated (mock driver,
    // view-only shell) instead of locking the team out of local dev.
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const domain = getCookieDomain();

  const supabase = createServerClient<Database>(
    getSupabaseUrl()!,
    getSupabaseAnonKey()!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, {
              ...options,
              ...(domain ? { domain } : {}),
            }),
          );
        },
      },
    },
  );

  // Token refresh must be the first call after client creation.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && !isAllowedEmail(user.email)) {
    await supabase.auth.signOut();
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "?error=domain";
    return NextResponse.redirect(url);
  }

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
