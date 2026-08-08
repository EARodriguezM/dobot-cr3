import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import {
  getCookieDomain,
  getSupabaseAnonKey,
  getSupabaseUrl,
  isSupabaseConfigured,
} from "./env";
import type { Database } from "./types";

// Server Component / Route Handler client. Returns null when Supabase is not
// configured — callers must handle the degraded case.
export async function createClient() {
  if (!isSupabaseConfigured()) return null;

  const cookieStore = await cookies();
  const domain = getCookieDomain();

  return createServerClient<Database>(getSupabaseUrl()!, getSupabaseAnonKey()!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          // Every auth cookie carries the apex domain in production so the
          // session is shared with *.primbiolab.org labs.
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, { ...options, ...(domain ? { domain } : {}) }),
          );
        } catch {
          // Called from a Server Component: cookie writes are not allowed
          // there; the middleware refreshes the session instead.
        }
      },
    },
  });
}
