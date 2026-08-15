"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getLabContext } from "@/lib/lab";
import type { ActionResult } from "@/lib/action-result";

// A viewer asking to be promoted to operator, from the console itself.
//
// No permission check here: the request goes through a SECURITY DEFINER
// function that does its own authorization, and `role_requests` has no insert
// grant at all, so a compromised session cannot forge one.
//
// The answer comes back to the console rather than navigating anywhere. It
// used to redirect to /admin/users, which the asker — a viewer — is not
// allowed to open, so the one person who needed the confirmation was bounced
// straight back to the console without it.

export async function requestPromotionAction(): Promise<ActionResult> {
  const ctx = await getLabContext();
  if (!ctx.configured || !ctx.user || !ctx.projectId) {
    return { ok: false, code: "err" };
  }

  const supabase = await createClient();
  if (!supabase) return { ok: false, code: "err" };

  const { error } = await supabase.rpc("request_role_promotion", {
    p_project_id: ctx.projectId,
    p_note: null,
  });

  if (error) {
    // Logged, not shown: the UI says "no se pudo enviar" in Spanish, and this
    // is the only place the Postgres reason survives.
    console.error(
      "[roles] request_role_promotion failed for %s on %s: %s %s",
      ctx.user.id,
      ctx.projectId,
      error.code ?? "?",
      error.message,
    );
    return { ok: false, code: "reqerr" };
  }

  revalidatePath("/admin/users");
  return { ok: true, code: "requested" };
}
