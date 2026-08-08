"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const ERRORS: Record<string, string> = {
  domain: "Solo se permiten cuentas institucionales @unal.edu.co.",
  auth: "No fue posible iniciar sesión. Inténtalo de nuevo.",
};

function LoginCard() {
  const params = useSearchParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("error") ? (ERRORS[params.get("error")!] ?? ERRORS.auth) : null,
  );
  const next = params.get("next") ?? "/";

  async function signInWithGoogle() {
    const supabase = createClient();
    if (!supabase) {
      setError("La autenticación no está configurada en este entorno.");
      return;
    }
    setPending(true);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        queryParams: {
          // Hint Google's account chooser to the institutional domain; the
          // real gate is the DB trigger + callback check.
          hd: "unal.edu.co",
          prompt: "select_account",
        },
      },
    });
    if (oauthError) {
      setError(ERRORS.auth);
      setPending(false);
    }
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-line bg-card p-9 shadow-xl">
      <p className="text-center font-head text-3xl font-extrabold tracking-tight">
        PRIM<span className="text-accent">BIO</span>
      </p>
      <p className="mb-7 mt-1 text-center font-mono text-[11px] uppercase tracking-[0.08em] text-ink3">
        Laboratorio remoto · PRIMBIO
      </p>

      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={pending}
        className="flex w-full items-center justify-center gap-3 rounded-xl border-[1.5px] border-line bg-card px-5 py-3 font-head text-sm font-bold text-ink transition hover:-translate-y-px hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5">
          <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l-.02.15 3.5 2.7.24.02c2.2-2 3.5-5 3.5-8.6" />
          <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.8-2.9c-1 .7-2.4 1.2-4.1 1.2a7.2 7.2 0 0 1-6.8-5l-.14.01-3.7 2.8-.05.13A12 12 0 0 0 12 24" />
          <path fill="#FBBC05" d="M5.2 14.4a7.4 7.4 0 0 1-.4-2.4c0-.8.2-1.6.4-2.4l-.01-.16-3.7-2.9-.12.06a12 12 0 0 0 0 10.8l3.9-3" />
          <path fill="#EB4335" d="M12 4.6c2.3 0 3.9 1 4.8 1.9l3.5-3.4A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.3 6.6l3.9 3a7.2 7.2 0 0 1 6.8-5" />
        </svg>
        {pending ? "Redirigiendo…" : "Continuar con Google"}
      </button>

      {error ? (
        <p className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-center font-mono text-[11px] text-danger">
          {error}
        </p>
      ) : null}

      <p className="mt-5 text-center font-mono text-[10px] leading-relaxed text-ink3">
        Solo cuentas <code className="text-accent">@unal.edu.co</code>. La sesión
        es válida en todos los laboratorios remotos.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4">
      <Suspense fallback={null}>
        <LoginCard />
      </Suspense>
    </main>
  );
}
