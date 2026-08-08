"use server";

import { createClient } from "@/lib/supabase/server";
import { getLabContext } from "@/lib/lab";
import { DEFAULT_LAYOUT, type WallLayout } from "@/lib/camera-layout";

// Durable, shared lab state: teach-pendant programs and the camera-wall
// arrangement, stored in the platform's `lab_settings` table (hub migration
// 0011) keyed by this lab's id.
//
// Shared is the point. The obvious alternative was localStorage, and it is
// wrong here for the same reason the lab itself is shared: a routine a student
// records is worth something to the next student, and a browser profile is not
// a place to keep a semester of work. RLS does the authorization — members
// read, operators and above write — so nothing here needs to re-check roles.

export interface ProgramStep {
  kind: "waypoint" | "gripper" | "wait";
  /** waypoint: six joint angles in degrees. */
  joints?: number[];
  /** gripper: finger travel in metres (0 = open). */
  position?: number;
  /** wait: seconds. */
  seconds?: number;
}

export interface Program {
  id: string;
  name: string;
  steps: ProgramStep[];
  updatedAt?: string;
}

const PROGRAMS_KEY = "programs";
const CAMERA_LAYOUT_KEY = "camera_layout";

async function readSetting<T>(key: string, fallback: T): Promise<T> {
  const ctx = await getLabContext();
  if (!ctx.configured || !ctx.lab) return fallback;

  const supabase = await createClient();
  if (!supabase) return fallback;

  const { data } = await supabase
    .from("lab_settings")
    .select("value")
    .eq("lab_id", ctx.lab.id)
    .eq("key", key)
    .maybeSingle();

  return (data?.value as T | undefined) ?? fallback;
}

async function writeSetting(key: string, value: unknown): Promise<boolean> {
  const ctx = await getLabContext();
  if (!ctx.configured || !ctx.lab || !ctx.user) return false;

  const supabase = await createClient();
  if (!supabase) return false;

  // No pre-check of the role: upsert and let RLS decide, then read the result.
  // A UI that asks "may I?" first and acts second is two sources of truth.
  const { data, error } = await supabase
    .from("lab_settings")
    .upsert(
      {
        lab_id: ctx.lab.id,
        key,
        value: value as never,
        updated_by: ctx.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "lab_id,key" },
    )
    .select("key");

  return !error && (data?.length ?? 0) > 0;
}

export async function loadPrograms(): Promise<Program[]> {
  const stored = await readSetting<{ items?: Program[] }>(PROGRAMS_KEY, {});
  return Array.isArray(stored.items) ? stored.items : [];
}

export async function savePrograms(programs: Program[]): Promise<boolean> {
  return writeSetting(PROGRAMS_KEY, { items: programs });
}

export async function loadCameraLayout(
  fallback: WallLayout,
): Promise<WallLayout> {
  const stored = await readSetting<Partial<WallLayout>>(CAMERA_LAYOUT_KEY, {});
  const base = fallback ?? DEFAULT_LAYOUT;
  return {
    count: typeof stored.count === "number" ? stored.count : base.count,
    preset: typeof stored.preset === "string" ? stored.preset : base.preset,
    slots: Array.isArray(stored.slots) ? stored.slots : base.slots,
  };
}

export async function saveCameraLayout(layout: WallLayout): Promise<boolean> {
  return writeSetting(CAMERA_LAYOUT_KEY, layout);
}
