"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getLabContext } from "@/lib/lab";

// Lab settings live in `remote_labs`, which the hub owns. Only the columns in
// that table's update grant can move at all, and RLS narrows it further to the
// project's owner and admins — so this action does not check permissions, it
// performs the write and reports what the database allowed. A UI that decides
// first and writes second has two answers to the same question.

export async function updateLabAction(formData: FormData) {
  const ctx = await getLabContext();
  if (!ctx.configured || !ctx.lab) redirect("/settings?m=err");

  const supabase = await createClient();
  if (!supabase) redirect("/settings?m=err");

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const inMaintenance = formData.get("in_maintenance") === "on";

  if (name.length === 0) redirect("/settings?m=err");

  const { data, error } = await supabase
    .from("remote_labs")
    .update({
      name,
      description: description || null,
      in_maintenance: inMaintenance,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ctx.lab.id)
    .select("id");

  // Zero rows means RLS refused it, which is the only authorization answer
  // that counts.
  if (error || (data?.length ?? 0) === 0) redirect("/settings?m=denied");

  revalidatePath("/settings");
  revalidatePath("/");
  redirect("/settings?m=ok");
}
