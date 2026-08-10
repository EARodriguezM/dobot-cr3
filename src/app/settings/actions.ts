"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getLabContext } from "@/lib/lab";
import type { ActionResult } from "@/lib/action-result";

// Lab settings live in `remote_labs`, which the hub owns. Only the columns in
// that table's update grant can move at all, and RLS narrows it further to the
// project's owner and admins — so this action does not check permissions, it
// performs the write and reports what the database allowed. A UI that decides
// first and writes second has two answers to the same question.

export async function updateLabAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await getLabContext();
  if (!ctx.configured || !ctx.lab) return { ok: false, code: "err" };

  const supabase = await createClient();
  if (!supabase) return { ok: false, code: "err" };

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const inMaintenance = formData.get("in_maintenance") === "on";
  // The checkbox asks the positive question ("publicado"); the column stores
  // the negative one.
  const inDevelopment = formData.get("published") !== "on";

  if (name.length === 0) return { ok: false, code: "noname" };

  const { data, error } = await supabase
    .from("remote_labs")
    .update({
      name,
      description: description || null,
      in_maintenance: inMaintenance,
      in_development: inDevelopment,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ctx.lab.id)
    .select("id");

  // Zero rows means RLS refused it, which is the only authorization answer
  // that counts.
  if (error || (data?.length ?? 0) === 0) return { ok: false, code: "denied" };

  // The console shows the lab's name and its closure banner, so it has to be
  // told. It stays mounted while this form is open, and refreshing its server
  // data does not disturb its session.
  revalidatePath("/settings");
  revalidatePath("/");
  return { ok: true, code: "ok" };
}
