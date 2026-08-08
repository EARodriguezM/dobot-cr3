"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "primbio-theme";

// The root layout runs an inline script that applies the stored theme before
// paint; this button only flips and persists it.
export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    setTheme(
      document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    );
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable (private mode): the toggle still works for the tab.
    }
    setTheme(next);
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
