import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { ProjectRole } from "@/lib/supabase/types";

// Which remote_labs row this deployment is. Registered in the platform
// catalogue as "dobot-cr3" (project "Dobot CR3").
export function getLabSlug(): string {
  return process.env.NEXT_PUBLIC_LAB_SLUG || "dobot-cr3";
}

// Backend origin (Cloudflare Tunnel to the lab computer). Empty = demo mode:
// mock telemetry, placeholder video, no hardware.
export function getControlUrl(): string | null {
  return process.env.NEXT_PUBLIC_CONTROL_URL || null;
}

// The caller's raw Supabase access token, for the one case where this app
// speaks to the edge on the user's behalf (the server-side e-stop). The
// gatekeeper verifies it and re-checks the role itself, so this app is never
// trusted as an authority — it only passes the user's own credential along.
export async function getAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  if (!supabase) return null;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/** Why a lab is not open to ordinary users, or null when it is. */
export type LabClosure = "development" | "maintenance" | null;

export interface LabContext {
  configured: boolean;
  user: { id: string; email: string; name: string } | null;
  lab: {
    id: string;
    name: string;
    description: string | null;
    inDevelopment: boolean;
    inMaintenance: boolean;
  } | null;
  projectId: string | null;
  /** Set when the lab is closed; admins may still enter, everyone else may not. */
  closure: LabClosure;
  /** False when `closure` is set and the caller is not an admin of the lab. */
  canEnter: boolean;
  /** Role in the lab's project; null = authenticated but not a member. */
  role: ProjectRole | null;
  canOperate: boolean;
  canAdmin: boolean;
}

const ANON: LabContext = {
  configured: false,
  user: null,
  lab: null,
  projectId: null,
  closure: null,
  canEnter: true,
  role: null,
  canOperate: false,
  canAdmin: false,
};

// Session + lab row + the user's role in the lab's project, deduplicated per
// request. Role comes from the DB (RLS-scoped), not the JWT claim, so role
// changes apply immediately.
export const getLabContext = cache(async (): Promise<LabContext> => {
  if (!isSupabaseConfigured()) return ANON;
  const supabase = await createClient();
  if (!supabase) return ANON;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: lab } = await supabase
    .from("remote_labs")
    .select(
      "id, name, description, in_development, in_maintenance, project_id, projects (owner_id)",
    )
    .eq("slug", getLabSlug())
    .maybeSingle();

  let role: ProjectRole | null = null;
  if (user && lab) {
    if (lab.projects?.owner_id === user.id) {
      role = "owner";
    } else {
      const { data: membership } = await supabase
        .from("project_members")
        .select("role")
        .eq("project_id", lab.project_id)
        .eq("user_id", user.id)
        .maybeSingle();
      // Since migration 0012 every authenticated account is a viewer of every
      // project, so an absent membership row means viewer, not "no access".
      role = membership?.role ?? "viewer";
    }
  }

  const isAdmin = role === "owner" || role === "admin";
  // Maintenance wins over development: it is the more urgent statement about
  // what is happening to the hardware right now.
  const closure: LabClosure = lab?.in_maintenance
    ? "maintenance"
    : lab?.in_development
      ? "development"
      : null;

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  return {
    configured: true,
    user: user?.email
      ? {
          id: user.id,
          email: user.email,
          name:
            typeof meta.full_name === "string" ? meta.full_name : user.email,
        }
      : null,
    lab: lab
      ? {
          id: lab.id,
          name: lab.name,
          description: lab.description,
          inDevelopment: lab.in_development,
          inMaintenance: lab.in_maintenance,
        }
      : null,
    projectId: lab?.project_id ?? null,
    closure,
    // Maintenance and development close the lab to ordinary users but never to
    // the people who have to work on it — otherwise publishing a lab would
    // require editing the database from outside the app that manages it.
    canEnter: closure === null || isAdmin,
    role,
    canOperate: role === "owner" || role === "admin" || role === "operator",
    canAdmin: role === "owner" || role === "admin",
  };
});
