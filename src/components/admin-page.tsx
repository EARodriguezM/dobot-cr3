import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "./theme-toggle";

// Chrome for an admin surface reached directly — a deep link, a bookmark, or a
// refresh while the modal was open. Inside the app these same panels open over
// the console instead; this is the standalone presentation of them, and it
// exists so that landing on /settings never leaves someone on a bare form with
// no way back to the lab.

export function AdminPage({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-[var(--nav-bg)] px-3 backdrop-blur-md md:px-4">
        <Link
          href="/"
          className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-ink3 transition hover:text-accent"
        >
          <span aria-hidden>←</span> Volver al control
        </Link>
        <div className="flex-1" />
        <ThemeToggle />
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 md:py-10">
        <h1 className="font-head text-2xl font-extrabold tracking-tight text-ink">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 font-mono text-[11px] text-ink3">{subtitle}</p>
        ) : null}
        <div className="mt-6">{children}</div>
      </main>
    </div>
  );
}
