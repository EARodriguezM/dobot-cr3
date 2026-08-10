import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLabContext } from "@/lib/lab";
import { SettingsForm } from "./settings-form";

// The settings surface itself, independent of how it is presented: the same
// component backs the intercepted modal over the console and the standalone
// page a deep link or a refresh lands on.
//
// What is configurable from the web, and what deliberately is not: the lab's
// identity and service state live in the platform database and are editable
// here. Hardware configuration — robot IP, ports, gripper travel, camera
// sources — does not: it belongs to the lab computer, where the ROS 2 stack
// reads it at launch and go2rtc reads it from its own config. Putting a
// robot's IP address behind a browser form would mean a web session could
// point the driver at an arbitrary host.
export async function SettingsPanel() {
  const ctx = await getLabContext();
  if (!ctx.configured || !ctx.user) redirect("/");
  if (!ctx.canAdmin) redirect("/");

  const supabase = await createClient();
  const { data: lab } = ctx.lab
    ? await supabase!
        .from("remote_labs")
        .select("name, description, in_maintenance, in_development, last_seen_at")
        .eq("id", ctx.lab.id)
        .maybeSingle()
    : { data: null };

  return (
    <SettingsForm
      name={lab?.name ?? ""}
      description={lab?.description ?? ""}
      published={!(lab?.in_development ?? true)}
      inMaintenance={lab?.in_maintenance ?? false}
      lastSeenAt={lab?.last_seen_at ?? null}
    />
  );
}
