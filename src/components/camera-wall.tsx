"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { VideoTile } from "./video-tile";

// The camera wall: every camera the lab computer is publishing, arranged
// automatically.
//
// Cameras themselves are configured on the lab computer (edge/go2rtc.yaml), so
// credentials and camera IPs never reach a browser — the same guarantee the
// reference implementation's server-side proxy gave, without the per-viewer
// cost. This component asks go2rtc what exists and shows all of it.
//
// It used to work the other way round: an operator picked a tile count, a
// preset arrangement and then which stream went in which slot, and that choice
// was stored per lab. Two things were wrong with that. It made the default
// state *empty* — a lab with two perfectly good cameras showed "sin cámara
// asignada" until somebody configured it, and observers, who cannot edit the
// layout, had no way to fix it for themselves. And it asked every lab to
// re-enter, by hand, something the lab computer already knows exactly.
//
// So the arrangement is derived and the only choice left is a personal one:
// which cameras you want on screen right now. That choice is deliberately
// per-browser (localStorage) rather than shared — hiding the wrist camera to
// give the cell view more room is a preference about *your* screen, and an
// observer must be able to make it without write access to anything.

/** Where one browser remembers the cameras it has hidden. */
const HIDDEN_KEY = "primbio.cameras.hidden";

// Column counts per breakpoint, as literal class strings so Tailwind can see
// them. Mobile-first and never more than two columns before `xl`: a phone
// stacks, and the video must never be squeezed to make room for chrome.
function gridClass(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-1 sm:grid-cols-2";
  // Four is a square rather than a row of four — a 2×2 keeps each tile twice
  // the width of a quarter-row on the same stage.
  if (count === 4) return "grid-cols-1 sm:grid-cols-2";
  if (count === 3) return "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3";
  return "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3";
}

// Memoised: none of this depends on telemetry, and re-rendering it at the rate
// the arm reports its joint angles would reconcile every video tile several
// times a second.
export const CameraWall = memo(function CameraWall({
  controlUrl,
  labSlug,
}: {
  controlUrl: string | null;
  /** Namespaces the hidden-camera preference, so two labs never share one. */
  labSlug: string;
}) {
  // null until go2rtc has answered: "no cameras" and "not asked yet" are
  // different states, and saying the first while the second is true sends
  // somebody to edit go2rtc.yaml over a request still in flight.
  const [streams, setStreams] = useState<string[] | null>(null);
  // Distinguishes "the lab has no cameras configured" from "we could not ask",
  // which point at different people: the first is a go2rtc.yaml edit, the
  // second is the tunnel or the gatekeeper being down.
  const [reachable, setReachable] = useState(true);
  const [hidden, setHidden] = useState<string[]>([]);
  // Until the stored preference has been read, showing everything would flash
  // cameras the user hid — and each flashed tile opens a WebRTC session.
  const [restored, setRestored] = useState(false);

  const storageKey = `${HIDDEN_KEY}.${labSlug}`;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        setHidden(parsed.filter((name): name is string => typeof name === "string"));
      }
    } catch {
      // Private mode, disabled storage, corrupt value: show everything.
    }
    setRestored(true);
  }, [storageKey]);

  // Which cameras exist is the lab computer's business, not this app's: ask
  // go2rtc rather than keeping a list here that would drift.
  //
  // This probe is now the only thing that puts video on the screen, so it
  // retries until it succeeds. A tunnel that comes up a few seconds after the
  // page did used to cost nothing (the tiles came from a stored layout); it
  // would now cost the whole wall until someone thought to reload.
  useEffect(() => {
    if (!controlUrl) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // The gatekeeper authenticates video the same way it authenticates the
    // socket, so the session token has to ride along. Any signed-in role may
    // watch — a spectator seeing the cameras is the point of the lab.
    const probe = async () => {
      const supabase = createClient();
      const token =
        (await supabase?.auth.getSession())?.data.session?.access_token ?? "";
      try {
        const response = await fetch(`${controlUrl}/api/video/api/streams`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          signal: AbortSignal.timeout(6000),
        });
        if (!response.ok) throw new Error(`streams ${response.status}`);
        const data = (await response.json()) as Record<string, unknown>;
        if (cancelled) return;
        // Sorted so the wall does not reshuffle itself between page loads:
        // go2rtc answers with a JSON object and key order is not a promise.
        setStreams(Object.keys(data ?? {}).sort());
        setReachable(true);
      } catch {
        if (cancelled) return;
        setReachable(false);
        timer = setTimeout(probe, 15000);
      }
    };
    void probe();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [controlUrl]);

  const toggle = useCallback(
    (name: string) => {
      setHidden((current) => {
        const next = current.includes(name)
          ? current.filter((n) => n !== name)
          : [...current, name];
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // Not being able to remember it is no reason not to do it.
        }
        return next;
      });
    },
    [storageKey],
  );

  const found = streams ?? [];
  const visible = useMemo(
    () =>
      restored ? (streams ?? []).filter((name) => !hidden.includes(name)) : [],
    [restored, streams, hidden],
  );

  // With no backend there is nothing to discover, so the demo keeps one
  // placeholder tile: an empty stage would read as a broken page.
  if (!controlUrl) {
    return (
      <div className="flex min-h-0 flex-col gap-3">
        <VideoTile controlUrl={null} source={null} label="Vista 1" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {found.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-ink3">
            Cámaras
          </span>
          {found.map((name) => {
            const shown = !hidden.includes(name);
            return (
              <button
                key={name}
                type="button"
                onClick={() => toggle(name)}
                aria-pressed={shown}
                title={shown ? `Ocultar ${name}` : `Mostrar ${name}`}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] transition ${
                  shown
                    ? "border-accent text-accent"
                    : "border-line text-ink3 hover:border-accent hover:text-accent"
                }`}
              >
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rounded-full ${
                    shown ? "bg-accent" : "bg-ink3/50"
                  }`}
                />
                {name}
              </button>
            );
          })}
        </div>
      ) : null}

      {visible.length > 0 ? (
        <div className={`grid min-h-0 flex-1 gap-2 ${gridClass(visible.length)}`}>
          {visible.map((name) => (
            // Keyed by camera name, so hiding one does not tear down and
            // reconnect the others' WebRTC sessions.
            <VideoTile
              key={name}
              controlUrl={controlUrl}
              source={name}
              label={name}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center font-mono text-[10px] leading-relaxed text-ink3">
          {!reachable
            ? "No se pudo consultar las cámaras: el computador del laboratorio no responde. Reintentando…"
            : streams === null
              ? "Buscando cámaras…"
              : found.length === 0
                ? "No se detectaron cámaras. Se configuran en el computador del laboratorio (edge/go2rtc.yaml)."
                : "Todas las cámaras están ocultas. Vuelve a mostrarlas arriba."}
        </p>
      )}
    </div>
  );
});
