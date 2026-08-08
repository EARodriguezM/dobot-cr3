import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Global sign-out: clears the apex-domain session cookie, so every lab
// subdomain loses the session too.
export async function POST(request: Request) {
  const supabase = await createClient();
  if (supabase) {
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL("/", new URL(request.url).origin), {
    status: 303,
  });
}
