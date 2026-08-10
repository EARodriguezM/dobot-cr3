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
  divided = false,
  label,
  className = "",
  bodyClassName = "p-4",
  children,
}: {
  /** Small uppercase eyebrow at the top of the panel. */
  title?: ReactNode;
  /** Secondary content on the title row — a count, a unit toggle. */
  aside?: ReactNode;
  /** Rule under the header, for panels whose body scrolls beneath it. */
  divided?: boolean;
  /** Accessible name when the visible title is not descriptive enough. */
  label?: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={`flex min-h-0 flex-col rounded-xl border border-line bg-card ${className}`}
    >
      {title ? (
        <header
          className={`flex shrink-0 items-center justify-between gap-2 px-4 ${
            divided ? "border-b border-line py-2.5" : "pb-1 pt-3.5"
          }`}
        >
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
            {title}
          </h2>
          {aside}
        </header>
      ) : null}
      <div className={`min-h-0 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/** Segmented control. Used for the main stage and for the jog mode. */
export function TabStrip<T extends string>({
  label,
  items,
  value,
  onChange,
  className = "",
}: {
  label: string;
  items: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={`flex overflow-hidden rounded-md border border-line ${className}`}
    >
      {items.map((item) => (
        <button
          key={item.id}
          role="tab"
          type="button"
          aria-selected={value === item.id}
          onClick={() => onChange(item.id)}
          className={`flex-1 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.1em] transition ${
            value === item.id
              ? "bg-accent text-white"
              : "text-ink3 hover:bg-bg2 hover:text-ink"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
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

// Vertical padding is set for touch first: the lab is driven from tablets, and
// a 32 px control is not something to reach for while an arm is moving.
const SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-[10px] tracking-[0.1em]",
  md: "px-4 py-2.5 text-[11px] tracking-[0.1em]",
  lg: "px-5 py-3 text-[11px] tracking-[0.1em]",
};

/** The button skin on its own, for links that have to look like buttons. */
export function buttonClass({
  variant = "neutral",
  size = "md",
  block = false,
  className = "",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
} = {}): string {
  return `inline-flex items-center justify-center gap-1.5 rounded-md font-mono uppercase transition disabled:cursor-not-allowed disabled:opacity-50 ${
    VARIANTS[variant]
  } ${SIZES[size]} ${block ? "w-full" : ""} ${className}`;
}

export function Button({
  variant,
  size,
  block,
  className,
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
      className={buttonClass({ variant, size, block, className })}
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
