import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hubUrl } from "@/lib/lab";

// Global sign-out: clears the apex-domain session cookie, so every lab
// subdomain loses the session too.
//
// It lands on the hub rather than on this lab's login page. Signing out of a
// lab is leaving it, and the lab has nothing to show a signed-out visitor —
// "/" here only bounces off the proxy back to /login, which reads as a failed
// logout, or worse as an invitation to sign in again. The hub is the platform's
// public face and is the one page that is genuinely useful to someone who has
// just left: the seedbed, its lines of research, its labs.
export async function POST() {
  const supabase = await createClient();
  if (supabase) {
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(hubUrl("/"), { status: 303 });
}
