"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VideoPanel } from "./video-panel";
import { TelemetryConsole, type LinkState } from "./telemetry-console";
import type { ControlState } from "@/lib/control/store";

// Client orchestration of the teleop screen: SSE control-state stream,
// lease take/release with a 5 s heartbeat (waiting clients are promoted by
// the same heartbeat), presence list, and the lease-free emergency stop.
export function LabConsole({
  controlUrl,
  canOperate,
  userId,
}: {
  controlUrl: string | null;
  canOperate: boolean;
  userId: string | null;
}) {
  const [state, setState] = useState<ControlState | null>(null);
  const [wanted, setWanted] = useState(false);
  const [link, setLink] = useState<LinkState>(controlUrl ? "connecting" : "demo");
  const wantedRef = useRef(wanted);
  wantedRef.current = wanted;

  const iAmHolder = state?.holder != null && state.holder.id === userId;
  const myPosition = state?.queue.findIndex((u) => u.id === userId) ?? -1;

  // Control state stream (also registers presence server-side).
  useEffect(() => {
    const es = new EventSource("/api/control/state");
    es.onmessage = (ev) => {
      try {
        setState(JSON.parse(ev.data) as ControlState);
      } catch {
        // skip malformed frame
      }
    };
    return () => es.close();
  }, []);

  // Lease heartbeat while we hold or wait for control.
  useEffect(() => {
    if (!wanted) return;
    const beat = () => fetch("/api/control/heartbeat", { method: "POST" }).catch(() => {});
    const t = setInterval(beat, 5000);
    return () => clearInterval(t);
  }, [wanted]);

  const take = useCallback(async () => {
    setWanted(true);
    await fetch("/api/control/take", { method: "POST" }).catch(() => {});
  }, []);

  const release = useCallback(async () => {
    setWanted(false);
    await fetch("/api/control/release", { method: "POST" }).catch(() => {});
  }, []);

  const estop = useCallback(async () => {
    await fetch("/api/control/estop", { method: "POST" }).catch(() => {});
  }, []);

  const recentEstop =
    state?.estopAt != null && Date.now() - state.estopAt < 30_000;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      {/* main panels */}
      <div className="flex min-w-0 flex-col gap-4">
        {recentEstop ? (
          <p
            role="alert"
            className="border border-danger bg-danger/10 px-4 py-2.5 font-mono text-xs text-danger"
          >
            ⚠ PARO DE EMERGENCIA activado por {state?.estopBy ?? "un operador"}.
          </p>
        ) : null}
        <VideoPanel controlUrl={controlUrl} />
        <div className="min-h-64 flex-1">
          <TelemetryConsole controlUrl={controlUrl} onLinkChange={setLink} />
        </div>
      </div>

      {/* side panel */}
      <aside className="flex flex-col gap-4">
        {/* connection pill */}
        <div className="flex items-center gap-2.5 rounded-lg border border-line bg-bg2 px-3.5 py-2.5">
          <span
            aria-hidden
            className={`h-2.5 w-2.5 rounded-full ${
              link === "online"
                ? "bg-ok shadow-[0_0_8px_var(--ok)]"
                : link === "demo"
                  ? "bg-warn shadow-[0_0_8px_var(--warn)]"
                  : "bg-ink3/50"
            }`}
          />
          <span className="font-mono text-[11px] tracking-[0.04em] text-ink2">
            {link === "online"
              ? "Conectado al hardware"
              : link === "demo"
                ? "Modo demostración"
                : link === "connecting"
                  ? "Conectando…"
                  : "Hardware sin conexión — solo observación"}
          </span>
        </div>

        {/* control */}
        <div className="rounded-xl border border-line bg-card p-4">
          <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
            Control
          </h2>
          <p className="mb-3 font-mono text-[11px] leading-relaxed text-ink3">
            {state?.holder
              ? iAmHolder
                ? "Tienes el control del hardware."
                : `Controla: ${state.holder.name}`
              : "Nadie tiene el control."}
            {myPosition >= 0 ? ` · Tu turno: #${myPosition + 1}` : ""}
          </p>
          {canOperate ? (
            <div className="flex flex-col gap-2">
              {iAmHolder ? (
                <button
                  type="button"
                  onClick={release}
                  className="border-[1.5px] border-line px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-ink2 transition hover:border-ink hover:bg-ink hover:text-bg"
                >
                  Liberar control
                </button>
              ) : (
                <button
                  type="button"
                  onClick={take}
                  disabled={wanted && myPosition >= 0}
                  className="border-[1.5px] border-accent px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-accent transition hover:bg-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {wanted && myPosition >= 0 ? "En cola…" : "Tomar control"}
                </button>
              )}
              <button
                type="button"
                onClick={estop}
                className="border-2 border-danger bg-danger/10 px-4 py-3 font-head text-sm font-bold uppercase tracking-[0.06em] text-danger transition hover:bg-danger hover:text-white"
              >
                ■ Paro de emergencia
              </button>
              <p className="font-mono text-[9px] leading-relaxed text-ink3/80">
                El paro no requiere tener el control: cualquier operador puede
                detener el hardware.
              </p>
            </div>
          ) : (
            <p className="font-mono text-[11px] text-ink3">
              Rol de observador: puedes ver video y telemetría, no operar.
            </p>
          )}
        </div>

        {/* presence */}
        <div className="rounded-xl border border-line bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
            <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-ok" />
            Conectados ({state?.presence.length ?? 0})
          </h2>
          <ul className="list-none">
            {(state?.presence ?? []).map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-2 border-b border-line py-1.5 text-[13px] last:border-0"
              >
                <span className="truncate">{p.name}</span>
                {state?.holder?.id === p.id ? (
                  <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-accent">
                    al mando
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
