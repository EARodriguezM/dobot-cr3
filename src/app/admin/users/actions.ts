"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Same contract as the hub's admin actions: RLS is the gate, mutations
// inspect their result (0 rows = denied), `owner` is never grantable.

const GRANTABLE_ROLES = ["admin", "operator", "viewer"] as const;

function isGrantableRole(v: unknown): v is (typeof GRANTABLE_ROLES)[number] {
  return typeof v === "string" && (GRANTABLE_ROLES as readonly string[]).includes(v);
}

function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function done(result: string): never {
  revalidatePath("/admin/users");
  redirect(`/admin/users?m=${result}`);
}

export async function addMemberAction(form: FormData): Promise<void> {
  const supabase = await createClient();
  if (!supabase) done("err");

  const projectId = str(form, "project_id");
  const email = str(form, "email").toLowerCase();
  const role = str(form, "role");
  if (!projectId || !email || !isGrantableRole(role)) done("err");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (!profile) done("nouser");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("project_members").insert({
    project_id: projectId,
    user_id: profile.id,
    role,
    added_by: user?.id ?? null,
  });
  if (error) done(error.code === "23505" ? "dup" : "denied");
  done("ok");
}

export async function setMemberRoleAction(form: FormData): Promise<void> {
  const supabase = await createClient();
  if (!supabase) done("err");

  const projectId = str(form, "project_id");
  const userId = str(form, "user_id");
  const role = str(form, "role");
  if (!projectId || !userId || !isGrantableRole(role)) done("err");

  const { data, error } = await supabase
    .from("project_members")
    .update({ role })
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .select("user_id");
  if (error || !data || data.length === 0) done("denied");
  done("ok");
}

export async function removeMemberAction(form: FormData): Promise<void> {
  const supabase = await createClient();
  if (!supabase) done("err");

  const projectId = str(form, "project_id");
  const userId = str(form, "user_id");
  if (!projectId || !userId) done("err");

  const { data, error } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .select("user_id");
  if (error || !data || data.length === 0) done("denied");
  done("ok");
}
