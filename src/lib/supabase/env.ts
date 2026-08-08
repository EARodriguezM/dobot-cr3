// Lazy environment access. Never read process.env at module scope: the app
// must build and boot with Supabase unconfigured (public site static,
// protected routes bounce to /login).

export function getSupabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL;
}

export function getSupabaseAnonKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

// Production: ".primbiolab.org" so the session cookie is shared with every
// lab subdomain. Unset in local dev (host-only cookies). NEXT_PUBLIC_ because
// the browser client also writes auth cookies and needs the same scope.
export function getCookieDomain(): string | undefined {
  return process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN || undefined;
}

// Defense-in-depth copy of the allowed domains for the middleware/callback.
// The authoritative gate is the DB trigger on auth.users; keep this env in
// sync when public.allowed_email_domains changes.
export function getAllowedEmailDomains(): string[] {
  const raw = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS ?? "unal.edu.co";
  return raw.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
}

export function isAllowedEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const domain = email.toLowerCase().split("@")[1];
  return Boolean(domain) && getAllowedEmailDomains().includes(domain);
}
