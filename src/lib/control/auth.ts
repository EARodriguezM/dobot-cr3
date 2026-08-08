import { NextResponse } from "next/server";
import { getLabContext } from "@/lib/lab";
import type { ControlUser } from "./store";

export interface ControlAuth {
  user: ControlUser;
  canOperate: boolean;
}

// Session check for the control API. Returns a NextResponse (401/403) when
// the request may not proceed. In demo mode (Supabase unconfigured) a local
// pseudo-user with operator rights keeps the template usable with zero env.
export async function requireControlUser(): Promise<ControlAuth | NextResponse> {
  const ctx = await getLabContext();

  if (!ctx.configured) {
    return {
      user: { id: "demo", name: "Demo" },
      canOperate: true,
    };
  }
  if (!ctx.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  return {
    user: { id: ctx.user.id, name: ctx.user.name },
    canOperate: ctx.canOperate,
  };
}

export function requireOperate(auth: ControlAuth): NextResponse | null {
  if (!auth.canOperate) {
    return NextResponse.json({ error: "operator role required" }, { status: 403 });
  }
  return null;
}
