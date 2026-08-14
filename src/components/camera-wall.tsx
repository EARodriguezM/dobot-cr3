"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_LAYOUT, type WallLayout } from "@/lib/camera-layout";
import { VideoTile } from "./video-tile";

// The camera wall: 1–4 tiles in a chosen arrangement, each showing one go2rtc
// stream.
//
// Cameras themselves are configured on the lab computer (edge/go2rtc.yaml), so
// credentials and camera IPs never reach a browser — the same guarantee the
// reference implementation's server-side proxy gave, without the per-viewer
// cost. What is configurable from here is the *arrangement*, which is a per-lab
// preference rather than a hardware fact, and it is shared: it lives in
// lab_settings so the lab looks the same to the next person who opens it.

interface Preset {
  id: string;
  tiles: number;
  cols: number;
  rows: number;
  /** Tiles that span extra rows, by index. */
  spans: { index: number; rows: number }[];
}

const PRESETS: Record<number, Preset[]> = {
  1: [{ id: "single", tiles: 1, cols: 1, rows: 1, spans: [] }],
  2: [
    { id: "cols-2", tiles: 2, cols: 2, rows: 1, spans: [] },
    { id: "stack-2", tiles: 2, cols: 1, rows: 2, spans: [] },
  ],
  3: [
    { id: "cols-3", tiles: 3, cols: 3, rows: 1, spans: [] },
    { id: "main-2", tiles: 3, cols: 2, rows: 2, spans: [{ index: 0, rows: 2 }] },
  ],
  4: [
    { id: "grid-4", tiles: 4, cols: 2, rows: 2, spans: [] },
    { id: "main-3", tiles: 4, cols: 2, rows: 3, spans: [{ index: 0, rows: 3 }] },
  ],
};

function presetById(id: string): Preset {
  return (
    Object.values(PRESETS)
      .flat()
      .find((preset) => preset.id === id) ?? PRESETS[1][0]
  );
}

// Memoised: none of this depends on telemetry, and re-rendering it at the rate
// the arm reports its joint angles would reconcile every video tile several
// times a second.
export const CameraWall = memo(function CameraWall({
  controlUrl,
  layout,
  canEdit,
  onLayoutChange,
}: {
  controlUrl: string | null;
  layout: WallLayout;
  canEdit: boolean;
  onLayoutChange?: (layout: WallLayout) => void;
}) {
  const [fetchedStreams, setFetchedStreams] = useState<string[]>([]);
  // With no backend there is nothing to offer, whatever a previous fetch found.
  const streams = controlUrl ? fetchedStreams : [];
  const preset = useMemo(() => presetById(layout.preset), [layout.preset]);

  // Which cameras exist is the lab computer's business, not this app's: ask
  // go2rtc rather than keeping a list here that would drift.
  useEffect(() => {
    if (!controlUrl) return;
    let cancelled = false;
    // The gatekeeper authenticates video the same way it authenticates the
    // socket, so the session token has to ride along.
    void (async () => {
      const supabase = createClient();
      const token =
        (await supabase?.auth.getSession())?.data.session?.access_token ?? "";
      await fetch(`${controlUrl}/api/video/api/streams`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        signal: AbortSignal.timeout(6000),
      })
      .then((response) => (response.ok ? response.json() : {}))
      .then((data: Record<string, unknown>) => {
        if (!cancelled) setFetchedStreams(Object.keys(data ?? {}));
      })
      .catch(() => {
        // go2rtc down or tunnel closed: the tiles say so themselves.
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [controlUrl]);

  const update = (next: WallLayout) => onLayoutChange?.(next);

  const setCount = (count: number) => {
    const options = PRESETS[count];
    const keep = options.some((p) => p.id === layout.preset);
    update({ ...layout, count, preset: keep ? layout.preset : options[0].id });
  };

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink3">
              Cámaras
            </span>
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCount(n)}
                aria-pressed={n === layout.count}
                className={`h-7 w-7 rounded border font-mono text-[11px] transition ${
                  n === layout.count
                    ? "border-accent bg-accent text-white"
                    : "border-line text-ink3 hover:border-accent hover:text-accent"
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink3">
              Disposición
            </span>
            {(PRESETS[layout.count] ?? []).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => update({ ...layout, preset: option.id })}
                aria-pressed={option.id === layout.preset}
                aria-label={`Disposición ${option.id}`}
                className={`grid h-7 w-9 gap-[2px] rounded border p-[3px] transition ${
                  option.id === layout.preset
                    ? "border-accent"
                    : "border-line hover:border-accent"
                }`}
                style={{
                  gridTemplateColumns: `repeat(${option.cols},1fr)`,
                  gridTemplateRows: `repeat(${option.rows},1fr)`,
                }}
              >
                {Array.from({ length: option.tiles }, (_, i) => {
                  const span = option.spans.find((s) => s.index === i);
                  return (
                    <span
                      key={i}
                      className="rounded-[1px] bg-ink3/50"
                      style={span ? { gridRow: `span ${span.rows}` } : undefined}
                    />
                  );
                })}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div
        className="grid min-h-0 flex-1 gap-2"
        style={{
          gridTemplateColumns: `repeat(${preset.cols}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: preset.tiles }, (_, index) => {
          const span = preset.spans.find((s) => s.index === index);
          const source = layout.slots?.[index] ?? null;
          return (
            <div
              key={index}
              className="flex min-w-0 flex-col gap-1"
              style={span ? { gridRow: `span ${span.rows}` } : undefined}
            >
              <VideoTile
                controlUrl={controlUrl}
                source={source}
                label={source ?? `Vista ${index + 1}`}
              />
              {canEdit ? (
                <select
                  value={source ?? ""}
                  aria-label={`Cámara para la vista ${index + 1}`}
                  onChange={(e) =>
                    update({
                      ...layout,
                      slots: (layout.slots ?? DEFAULT_LAYOUT.slots).map((slot, i) =>
                        i === index ? e.target.value || null : slot,
                      ),
                    })
                  }
                  className="w-full rounded border border-line bg-bg2 px-2 py-1 font-mono text-[10px] text-ink2 outline-none focus-visible:border-accent"
                >
                  <option value="">— sin asignar —</option>
                  {streams.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          );
        })}
      </div>

      {controlUrl && streams.length === 0 ? (
        <p className="font-mono text-[10px] leading-relaxed text-ink3">
          No se detectaron cámaras. Se configuran en el computador del
          laboratorio (<code>edge/go2rtc.yaml</code>).
        </p>
      ) : null}
    </div>
  );
});
