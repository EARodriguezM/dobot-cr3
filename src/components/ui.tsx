// Shared surface primitives.
//
// Every panel, button and field in this app was hand-rolled at the point of
// use, which produced ten variants of the same button differing only in a
// border width or half a step of padding. The design system in PLATFORM-GUIDE
// §5 describes one visual language; these are it, expressed once.
//
// Deliberately free of hooks and of "use client", so server-rendered admin
// surfaces and the client console share the same primitives rather than
// drifting apart the way the settings pages already had.

import type { ButtonHTMLAttributes, ReactNode } from "react";

/* ── Panels ──────────────────────────────────────────────────────────────── */

export function Panel({
  title,
  aside,
  className = "",
  bodyClassName = "",
  children,
}: {
  /** Small uppercase eyebrow at the top of the panel. */
  title?: ReactNode;
  /** Secondary content on the title row — a count, a unit toggle. */
  aside?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`flex min-h-0 flex-col rounded-xl border border-line bg-card ${className}`}
    >
      {title ? (
        <header className="flex items-center justify-between gap-2 px-4 pt-3.5">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
            {title}
          </h2>
          {aside}
        </header>
      ) : null}
      <div className={`min-h-0 p-4 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/* ── Buttons ─────────────────────────────────────────────────────────────── */

export type ButtonVariant =
  | "accent"
  | "neutral"
  | "quiet"
  | "ok"
  | "warn"
  | "danger"
  | "estop";

export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  accent:
    "border-[1.5px] border-accent text-accent hover:bg-accent hover:text-white",
  neutral:
    "border-[1.5px] border-line text-ink2 hover:border-ink hover:bg-ink hover:text-bg",
  quiet: "border border-line text-ink2 hover:border-accent hover:text-accent",
  ok: "border-[1.5px] border-ok text-ok hover:bg-ok hover:text-bg",
  warn: "border border-warn text-warn hover:bg-warn hover:text-bg",
  danger: "border border-line text-ink2 hover:border-danger hover:text-danger",
  estop:
    "border-2 border-danger bg-danger/10 font-head font-bold text-danger hover:bg-danger hover:text-white",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-[10px] tracking-[0.1em]",
  md: "px-4 py-2 text-[11px] tracking-[0.1em]",
  lg: "px-5 py-2.5 text-[11px] tracking-[0.1em]",
};

export function Button({
  variant = "neutral",
  size = "md",
  block = false,
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Full width — the default on a phone for anything in a form. */
  block?: boolean;
}) {
  return (
    <button
      {...props}
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 font-mono uppercase transition disabled:cursor-not-allowed disabled:opacity-50 ${
        VARIANTS[variant]
      } ${SIZES[size]} ${block ? "w-full" : ""} ${className}`}
    />
  );
}

/* ── Form fields ─────────────────────────────────────────────────────────── */

/** Shared input/select/textarea skin. */
export const inputClass =
  "w-full min-w-0 rounded-md border border-line bg-bg px-3 py-2 font-mono text-[13px] text-ink transition focus:border-accent focus:outline-none";

export function Field({
  label,
  hint,
  htmlFor,
  className = "",
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label
        htmlFor={htmlFor}
        className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink3"
      >
        {label}
      </label>
      {children}
      {hint ? (
        <p className="font-mono text-[10px] leading-relaxed text-ink3">{hint}</p>
      ) : null}
    </div>
  );
}

/** A checkbox with its explanation, as used across the settings surfaces. */
export function CheckField({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: ReactNode;
  hint?: ReactNode;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-start gap-2.5 rounded-md border border-line bg-bg2 px-3 py-2.5">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-1 accent-[var(--accent)]"
      />
      <span className="text-[13px] leading-snug text-ink2">
        {label}
        {hint ? (
          <span className="mt-0.5 block font-mono text-[10px] leading-relaxed text-ink3">
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/* ── Banners ─────────────────────────────────────────────────────────────── */

export type Tone = "ok" | "warn" | "danger" | "neutral" | "accent";

const TONES: Record<Tone, string> = {
  ok: "border-ok bg-ok/10 text-ok",
  warn: "border-warn bg-warn/10 text-warn",
  danger: "border-danger bg-danger/10 text-danger",
  accent: "border-accent bg-accent/10 text-accent",
  neutral: "border-line bg-bg2 text-ink3",
};

export function Banner({
  tone = "neutral",
  role,
  className = "",
  children,
}: {
  tone?: Tone;
  role?: "alert" | "status";
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      role={role}
      className={`rounded-md border px-4 py-2.5 font-mono text-xs leading-relaxed ${TONES[tone]} ${className}`}
    >
      {children}
    </p>
  );
}

/** Role pill, shared by the roster and the presence list. */
export function RoleTag({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  const styles: Record<Tone, string> = {
    ok: "bg-ok/15 text-ok",
    warn: "bg-warn/15 text-warn",
    danger: "bg-danger/15 text-danger",
    accent: "bg-accent/15 text-accent",
    neutral: "bg-bg2 text-ink3",
  };
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] ${styles[tone]}`}
    >
      {children}
    </span>
  );
}
