"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getLabContext } from "@/lib/lab";

// Promotion requests, both halves: asking and deciding.
//
// Neither action checks permissions here. Both go through SECURITY DEFINER
// functions that do their own authorization and write the membership row in
// the same breath as the status change, so a request cannot be marked approved
// without the role actually moving — and a compromised session cannot forge
// either step, because `role_requests` has no insert or update grant at all.

export async function requestPromotionAction() {
  const ctx = await getLabContext();
  if (!ctx.configured || !ctx.user || !ctx.projectId) redirect("/");

  const supabase = await createClient();
  if (!supabase) redirect("/");

  const { error } = await supabase.rpc("request_role_promotion", {
    p_project_id: ctx.projectId,
    p_note: null,
  });

  revalidatePath("/admin/users");
  revalidatePath("/");
  redirect(error ? "/admin/users?m=reqerr" : "/admin/users?m=requested");
}

export async function decideRequestAction(formData: FormData) {
  const ctx = await getLabContext();
  if (!ctx.configured || !ctx.user) redirect("/");

  const requestId = String(formData.get("request_id") ?? "");
  const approve = String(formData.get("decision") ?? "") === "approve";
  if (!requestId) redirect("/admin/users?m=err");

  const supabase = await createClient();
  if (!supabase) redirect("/");

  const { error } = await supabase.rpc("decide_role_request", {
    p_request_id: requestId,
    p_approve: approve,
    p_note: null,
  });

  revalidatePath("/admin/users");
  redirect(error ? "/admin/users?m=denied" : "/admin/users?m=ok");
}
