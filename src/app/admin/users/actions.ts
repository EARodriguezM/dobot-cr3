"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getLabContext } from "@/lib/lab";
import type { ActionResult } from "@/lib/action-result";

// Same contract as the hub's admin actions: RLS is the gate, mutations
// inspect their result (0 rows = denied), `owner` is never grantable.
//
// One entry point rather than four. The roster is a list of forms — add,
// change a role, remove, decide a request — and a single dispatcher lets the
// whole panel share one `useActionState`, so whichever form was submitted is
// the one that reports back.

const GRANTABLE_ROLES = ["admin", "operator", "viewer"] as const;

function isGrantableRole(v: unknown): v is (typeof GRANTABLE_ROLES)[number] {
  return typeof v === "string" && (GRANTABLE_ROLES as readonly string[]).includes(v);
}

function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function fail(code: string): ActionResult {
  return { ok: false, code };
}

function done(code = "ok"): ActionResult {
  revalidatePath("/admin/users");
  return { ok: true, code };
}

export async function manageTeamAction(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  switch (str(form, "intent")) {
    case "add":
      return addMember(form);
    case "role":
      return setMemberRole(form);
    case "remove":
      return removeMember(form);
    case "approve":
      return decideRequest(form, true);
    case "reject":
      return decideRequest(form, false);
    default:
      return fail("err");
  }
}

async function addMember(form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  if (!supabase) return fail("err");

  const projectId = str(form, "project_id");
  const email = str(form, "email").toLowerCase();
  const role = str(form, "role");
  if (!projectId || !email || !isGrantableRole(role)) return fail("err");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (!profile) return fail("nouser");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("project_members").insert({
    project_id: projectId,
    user_id: profile.id,
    role,
    added_by: user?.id ?? null,
  });
  if (error) return fail(error.code === "23505" ? "dup" : "denied");
  return done("added");
}

async function setMemberRole(form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  if (!supabase) return fail("err");

  const projectId = str(form, "project_id");
  const userId = str(form, "user_id");
  const role = str(form, "role");
  if (!projectId || !userId || !isGrantableRole(role)) return fail("err");

  const { data, error } = await supabase
    .from("project_members")
    .update({ role })
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .select("user_id");
  if (error || !data || data.length === 0) return fail("denied");
  return done();
}

async function removeMember(form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  if (!supabase) return fail("err");

  const projectId = str(form, "project_id");
  const userId = str(form, "user_id");
  if (!projectId || !userId) return fail("err");

  const { data, error } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .select("user_id");
  if (error || !data || data.length === 0) return fail("denied");
  return done("removed");
}

// Promotion requests go through a SECURITY DEFINER function that does its own
// authorization and writes the membership row in the same breath as the status
// change, so a request cannot be marked approved without the role actually
// moving — `role_requests` has no update grant at all.
async function decideRequest(
  form: FormData,
  approve: boolean,
): Promise<ActionResult> {
  const ctx = await getLabContext();
  if (!ctx.configured || !ctx.user) return fail("err");

  const requestId = str(form, "request_id");
  if (!requestId) return fail("err");

  const supabase = await createClient();
  if (!supabase) return fail("err");

  const { error } = await supabase.rpc("decide_role_request", {
    p_request_id: requestId,
    p_approve: approve,
    p_note: null,
  });
  if (error) return fail("denied");

  revalidatePath("/");
  return done(approve ? "approved" : "rejected");
}
