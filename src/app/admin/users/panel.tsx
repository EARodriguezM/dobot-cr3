import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLabContext } from "@/lib/lab";
import { UsersManager } from "./users-manager";

// Roles for THIS lab only. The hub decides who owns the lab; everything else
// is decided here, by the owner and the admins.
//
// Presented either as a modal over the running console or as a standalone page
// — the data fetching and the authorization guard are the same in both cases,
// and RLS returns only the rows this admin may act on, so nothing here filters
// by permission a second time.
export async function UsersPanel() {
  const ctx = await getLabContext();
  if (!ctx.configured || !ctx.user) redirect("/");
  if (!ctx.canAdmin || !ctx.projectId) redirect("/");
  // Bind after the guard: property narrowing is lost inside the callbacks below.
  const projectId = ctx.projectId;

  const supabase = await createClient();
  const [{ data: members }, { data: owner }, { data: requests }] =
    await Promise.all([
      supabase!
        .from("project_members")
        .select(
          "user_id, role, profiles!project_members_user_id_fkey (email, full_name)",
        )
        .eq("project_id", projectId),
      supabase!
        .from("projects")
        .select("profiles!projects_owner_id_fkey (email, full_name)")
        .eq("id", projectId)
        .maybeSingle(),
      supabase!
        .from("role_requests")
        .select(
          "id, requested_role, note, created_at, profiles!role_requests_user_id_fkey (email, full_name)",
        )
        .eq("project_id", projectId)
        .eq("status", "pending")
        .order("created_at", { ascending: true }),
    ]);

  const roster = (members ?? [])
    .map((member) => ({
      userId: member.user_id,
      role: member.role as string,
      email: member.profiles?.email ?? "",
      name: member.profiles?.full_name ?? null,
    }))
    .sort((a, b) => a.email.localeCompare(b.email));

  return (
    <UsersManager
      projectId={projectId}
      owner={{
        email: owner?.profiles?.email ?? null,
        name: owner?.profiles?.full_name ?? null,
      }}
      members={roster}
      requests={(requests ?? []).map((request) => ({
        id: request.id,
        requestedRole: request.requested_role as string,
        note: request.note,
        email: request.profiles?.email ?? "",
        name: request.profiles?.full_name ?? null,
      }))}
    />
  );
}
