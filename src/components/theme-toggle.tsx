"use client";

import { useState, useSyncExternalStore } from "react";

const STORAGE_KEY = "primbio-theme";

// The root layout runs an inline script that applies the stored theme before
// paint; this button only flips and persists it.
// The inline script in the root layout has already stamped data-theme before
// hydration, so the DOM is the source of truth. Reading it through
// useSyncExternalStore keeps the server render ("light", matching the default)
// and the client render consistent without an effect that re-renders on mount.
function subscribe() {
  return () => {};
}

function readTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function ThemeToggle() {
  const domTheme = useSyncExternalStore(subscribe, readTheme, () => "light" as const);
  const [override, setOverride] = useState<"light" | "dark" | null>(null);
  const theme = override ?? domTheme;

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable (private mode): the toggle still works for the tab.
    }
    setOverride(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      className="flex items-center gap-1.5 whitespace-nowrap rounded-sm border-[1.5px] border-line px-3 py-1.5 font-mono text-[11px] tracking-[0.08em] text-ink3 transition hover:border-accent hover:text-accent"
    >
      <span aria-hidden className="text-sm">{theme === "dark" ? "☀" : "☾"}</span>
      {theme === "dark" ? "CLARO" : "OSCURO"}
    </button>
  );
}
