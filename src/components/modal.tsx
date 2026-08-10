"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";

// The overlay the admin surfaces open in.
//
// Settings and the team roster used to be ordinary routes, so opening either
// one unmounted the console: the socket to the gatekeeper closed, the control
// stream closed — dropping the person out of everyone else's presence list —
// and every camera tile renegotiated its peer connection on the way back. For
// an instrument several people are watching at once, walking out of the room
// to change a setting is the wrong model.
//
// Intercepted routes render here instead, over a console that stays live. The
// URL is real either way: a deep link or a refresh lands on the full page.
//
// Built on <dialog>, which the platform already implements correctly — focus
// trap, Escape, inert background, focus restored to whatever opened it. Doing
// that by hand is a well-known way to produce a dialog keyboard users cannot
// leave.

export function Modal({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // Closing means going back: the modal only ever exists as the result of a
  // navigation, so the history entry is the state to undo.
  const close = useCallback(() => router.back(), [router]);

  // <dialog> makes the page behind it inert but does not stop it scrolling.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={close}
      aria-labelledby="modal-title"
      className="m-0 h-dvh max-h-dvh w-dvw max-w-none bg-transparent p-0 text-ink backdrop:bg-black/55 backdrop:backdrop-blur-[2px]"
    >
      <div
        // Clicks that land on the padding around the card, and not inside it,
        // dismiss — the same affordance as the backdrop itself.
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        className="flex min-h-full items-stretch justify-center sm:items-center sm:p-6"
      >
        <div className="flex max-h-dvh w-full flex-col overflow-hidden border-line bg-bg shadow-2xl sm:max-h-[86vh] sm:max-w-2xl sm:rounded-xl sm:border">
          <header className="flex shrink-0 items-start gap-3 border-b border-line px-4 py-3.5 sm:px-6">
            <div className="min-w-0 flex-1">
              <h1
                id="modal-title"
                className="truncate font-head text-lg font-extrabold tracking-tight text-ink"
              >
                {title}
              </h1>
              {subtitle ? (
                <p className="mt-0.5 truncate font-mono text-[11px] text-ink3">
                  {subtitle}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Cerrar"
              className="-mr-1 shrink-0 rounded p-2 text-ink3 transition hover:text-accent"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                aria-hidden
              >
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            {children}
          </div>
        </div>
      </div>
    </dialog>
  );
}

/** Placeholder while an intercepted panel streams in. */
export function ModalSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-md bg-bg2" />
      ))}
    </div>
  );
}
