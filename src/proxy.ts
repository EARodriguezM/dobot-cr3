import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next 16 renamed the `middleware` file convention to `proxy`, and it must sit
// beside `app` — which in this project is `src/`. A `middleware.ts` at the repo
// root is silently never invoked: session refresh, the e-mail domain re-check
// and the apex cookie domain all stop happening without any error.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
