import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Two constraints pull in opposite directions here, so the file name is not
// an accident:
//
// 1. It must live beside `app/` — which in this project is `src/`. A
//    `middleware.ts` at the repo root is silently never invoked: no error, no
//    warning, and `next build` still prints "ƒ Proxy (Middleware)" in the
//    route list. Session refresh, the e-mail domain re-check and the apex
//    cookie domain all stop happening without anything appearing to be wrong.
//
// 2. It must stay `middleware.ts`, **not** the `proxy.ts` that Next 16 renamed
//    this convention to. Proxy files run on the Node.js runtime and Next
//    refuses a `runtime` config option to change that, while the Cloudflare
//    adapter (@opennextjs/cloudflare) hard-fails the build on Node middleware:
//    "Node.js middleware is not currently supported." The deprecated
//    `middleware` convention still compiles to the edge runtime, which is what
//    this Worker can actually deploy.
//
// So: deprecated name, correct directory. If a future adapter release supports
// Node middleware, rename to `proxy.ts` and rename the export — and verify by
// probing a running server, because the build output will not tell you.
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
