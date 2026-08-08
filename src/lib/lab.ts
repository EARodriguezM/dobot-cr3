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

export interface LabContext {
  configured: boolean;
  user: { id: string; email: string; name: string } | null;
  lab: { id: string; name: string; description: string | null } | null;
  projectId: string | null;
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
    .select("id, name, description, project_id, projects (owner_id)")
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
      role = membership?.role ?? null;
    }
  }

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
      ? { id: lab.id, name: lab.name, description: lab.description }
      : null,
    projectId: lab?.project_id ?? null,
    role,
    canOperate: role === "owner" || role === "admin" || role === "operator",
    canAdmin: role === "owner" || role === "admin",
  };
});
