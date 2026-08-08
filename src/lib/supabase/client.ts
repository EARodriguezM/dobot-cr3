"use client";

import { createBrowserClient } from "@supabase/ssr";
import {
  getCookieDomain,
  getSupabaseAnonKey,
  getSupabaseUrl,
  isSupabaseConfigured,
} from "./env";
import type { Database } from "./types";

// Browser client. Cookie storage (never localStorage) so the session crosses
// subdomains; returns null when Supabase is not configured.
export function createClient() {
  if (!isSupabaseConfigured()) return null;

  const domain = getCookieDomain();

  return createBrowserClient<Database>(getSupabaseUrl()!, getSupabaseAnonKey()!, {
    ...(domain ? { cookieOptions: { domain } } : {}),
  });
}
