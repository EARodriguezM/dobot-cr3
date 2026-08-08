import { NextResponse } from "next/server";
import { getControlStore } from "@/lib/control/store";
import { requireControlUser } from "@/lib/control/auth";
import { getLabSlug } from "@/lib/lab";

// Voluntarily release the lease (or leave the wait queue).
export async function POST() {
  const auth = await requireControlUser();
  if (auth instanceof NextResponse) return auth;

  const store = await getControlStore();
  await store.release(getLabSlug(), auth.user.id);
  return NextResponse.json({ ok: true });
}
