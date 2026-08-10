"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "./ui";

// Application chrome: icon rail, top bar and an always-reachable stop.
//
// Mobile-first is a platform requirement, not polish: the rail collapses into
// an off-canvas drawer below 900px, and the emergency stop stays in the top bar
// at every width, because the one control that must never be more than one tap
// away is the one that halts the arm.

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const NAV: NavItem[] = [
  {
    href: "/",
    label: "Control",
    icon: (
      <svg viewBox="0 0 24 24" {...stroke} aria-hidden>
        <rect x="3" y="3" width="7" height="9" />
        <rect x="14" y="3" width="7" height="5" />
        <rect x="14" y="12" width="7" height="9" />
        <rect x="3" y="16" width="7" height="5" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Ajustes",
    adminOnly: true,
    icon: (
      <svg viewBox="0 0 24 24" {...stroke} aria-hidden>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  {
    href: "/admin/users",
    label: "Usuarios",
    adminOnly: true,
    icon: (
      <svg viewBox="0 0 24 24" {...stroke} aria-hidden>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
];

export function LabShell({
  labName,
  userName,
  roleLabel,
  canAdmin,
  isOperator,
  viewers,
  statusDot,
  statusLabel,
  onEstop,
  children,
}: {
  labName: string;
  userName: string | null;
  roleLabel: string | null;
  canAdmin: boolean;
  isOperator: boolean;
  viewers: number;
  statusDot: "ok" | "warn" | "err";
  statusLabel: string;
  onEstop: () => void;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const items = NAV.filter((item) => !item.adminOnly || canAdmin);

  const rail = (
    <nav aria-label="Secciones" className="flex flex-col gap-1 p-2">
      {items.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            // Navigating closes the drawer; watching the pathname in an effect
            // would re-render every consumer of this shell on each route change.
            onClick={() => setDrawerOpen(false)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition lg:justify-center lg:px-0 ${
              active
                ? "bg-ink-on/10 text-accent"
                : "text-ink-on/55 hover:bg-ink-on/5 hover:text-ink-on"
            }`}
            title={item.label}
          >
            <span className="h-5 w-5 shrink-0">{item.icon}</span>
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] lg:hidden">
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* Rail — an inverted ink band in both themes, per the design system. */}
      <aside className="hidden w-14 shrink-0 flex-col border-r border-ink-on/10 bg-ink-surface lg:flex">
        <div className="flex h-14 items-center justify-center font-head text-lg font-extrabold text-ink-on">
          P<span className="text-accent">.</span>
        </div>
        {rail}
      </aside>

      {/* Off-canvas drawer below the large breakpoint. */}
      {drawerOpen ? (
        <>
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-60 border-r border-ink-on/10 bg-ink-surface lg:hidden">
            <div className="flex h-14 items-center px-4 font-head text-lg font-extrabold text-ink-on">
              PRIM<span className="text-accent">BIO</span>
            </div>
            {rail}
          </aside>
        </>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-[var(--nav-bg)] px-3 backdrop-blur-md md:px-4">
          <button
            type="button"
            aria-label="Abrir menú"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
            className="-ml-1 rounded p-2 text-ink2 transition hover:text-accent lg:hidden"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" {...stroke} aria-hidden>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <p className="min-w-0 truncate font-head text-base font-extrabold leading-none tracking-tight text-ink">
            {labName}
          </p>

          <div className="flex-1" />

          <span
            className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-mono text-[10px] text-ink2 sm:flex"
            title="Personas conectadas al hardware"
          >
            <svg viewBox="0 0 24 24" className="h-3 w-3" {...stroke} aria-hidden>
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
            </svg>
            {viewers}
          </span>

          <span className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-mono text-[10px] text-ink2">
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full ${
                statusDot === "ok"
                  ? "bg-ok"
                  : statusDot === "warn"
                    ? "bg-warn"
                    : "bg-danger"
              }`}
            />
            <span className="hidden sm:inline">{statusLabel}</span>
          </span>

          <ThemeToggle />

          {isOperator ? (
            <Button
              variant="estop"
              size="sm"
              onClick={onEstop}
              title="Paro de emergencia — no requiere tener el control"
            >
              ■<span className="hidden sm:inline">Paro</span>
            </Button>
          ) : null}

          {userName ? (
            <span
              className="hidden max-w-40 items-center gap-1.5 truncate rounded-full border border-line px-2.5 py-1 md:flex"
              title={userName}
            >
              <span className="truncate text-[12px] text-ink2">{userName}</span>
              {roleLabel ? (
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] text-accent">
                  {roleLabel}
                </span>
              ) : null}
            </span>
          ) : null}

          {userName ? (
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                title="Cerrar sesión"
                className="rounded p-2 text-ink3 transition hover:text-accent"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" {...stroke} aria-hidden>
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            </form>
          ) : null}
        </header>

        <main className="min-w-0 flex-1 p-3 md:p-4">{children}</main>
      </div>
    </div>
  );
}
