import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

// Keeping the app-side mirror of an account current.
//
// This is a *refresh*, not provisioning: since hub migration 0013 the row is
// created by a trigger on auth.users, because doing it from here did not work.
// The callback's write is issued right after the session cookie is set and
// before it can be read back, so it reaches PostgREST as `anon` — which holds
// no grant on `profiles` — and three of the platform's first four accounts
// ended up with no row at all. That is not a cosmetic gap:
// `project_members.user_id`, `role_requests.user_id` and `projects.owner_id`
// all reference this table, so those people could sign in and watch a lab but
// could not be given a role or ask for one.
//
// What is still worth doing from here is picking up a display name or avatar
// that changed at the identity provider since signup. It is best effort by
// design, and the failure is reported rather than discarded so that a return
// of the old behaviour is visible in the log instead of silent.

/**
 * Refresh the caller's own profile row, creating it if the trigger somehow
 * did not.
 *
 * @returns null on success, or the reason it failed — never throws, because
 *   no caller should abandon a sign-in or an action over this.
 */
export async function ensureProfile(
  supabase: SupabaseClient<Database>,
  user: User,
): Promise<string | null> {
  if (!user.email) return "account has no e-mail address";

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const { error } = await supabase.from("profiles").upsert({
    id: user.id,
    email: user.email,
    full_name: typeof meta.full_name === "string" ? meta.full_name : null,
    avatar_url: typeof meta.avatar_url === "string" ? meta.avatar_url : null,
    updated_at: new Date().toISOString(),
  });

  return error ? `${error.code ?? "?"} ${error.message}` : null;
}
