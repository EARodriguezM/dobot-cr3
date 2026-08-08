"use client";

import { useEffect, useRef, useState } from "react";

// One camera, played over WebRTC from go2rtc on the lab computer.
//
// go2rtc is what makes a *shared* lab affordable: it pulls each camera once
// and fans it out to every viewer as a peer connection. The reference
// implementation proxied MJPEG per viewer through the Pi, which meant a class
// of twenty watching cost twenty decoded streams on a Raspberry Pi and twenty
// times the tunnel bandwidth.
//
// WebRTC negotiates UDP through STUN; when the university NAT defeats hole
// punching the connection fails rather than hanging, and the tile says so.

type State = "idle" | "connecting" | "live" | "failed";

export function VideoTile({
  controlUrl,
  source,
  label,
  className = "",
}: {
  controlUrl: string | null;
  source: string | null;
  label?: string;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Only the *outcome* is state. Whether there is anything to play, and
  // whether we are still trying, both follow from the props and that outcome —
  // so switching camera resets to "connecting" without an effect doing it.
  const [outcome, setOutcome] = useState<{ key: string; state: State } | null>(
    null,
  );
  const key = `${controlUrl ?? ""}|${source ?? ""}`;
  const state: State =
    !controlUrl || !source
      ? "idle"
      : outcome?.key === key
        ? outcome.state
        : "connecting";

  useEffect(() => {
    if (!controlUrl || !source) return;
    let cancelled = false;
    let connection: RTCPeerConnection | null = null;

    async function connect() {
      try {
        connection = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });
        connection.addTransceiver("video", { direction: "recvonly" });
        connection.ontrack = (event) => {
          if (videoRef.current && !cancelled) {
            videoRef.current.srcObject = event.streams[0];
            setOutcome({ key, state: "live" });
          }
        };
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);

        const response = await fetch(
          `${controlUrl}/api/video/api/webrtc?src=${encodeURIComponent(source!)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/sdp" },
            body: offer.sdp,
            signal: AbortSignal.timeout(8000),
          },
        );
        if (!response.ok) throw new Error(`whep ${response.status}`);
        await connection.setRemoteDescription({
          type: "answer",
          sdp: await response.text(),
        });
      } catch {
        if (!cancelled) setOutcome({ key, state: "failed" });
      }
    }

    void connect();
    return () => {
      cancelled = true;
      connection?.close();
    };
  }, [controlUrl, source, key]);

  return (
    <div
      className={`relative aspect-video w-full overflow-hidden rounded-lg border border-line bg-ink-surface ${className}`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`h-full w-full object-contain ${state === "live" ? "" : "hidden"}`}
      />

      {state !== "live" ? (
        <div className="ink-grid absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center text-ink-on">
          <svg viewBox="0 0 120 80" className="w-16 opacity-60" aria-hidden>
            <g fill="none" stroke="var(--accent)" strokeWidth="2">
              <rect x="10" y="14" width="72" height="52" rx="4" />
              <path d="M82 32 108 20 v40 L82 48" />
              <circle cx="46" cy="40" r="12" />
              <circle cx="46" cy="40" r="5" fill="var(--accent)" />
            </g>
          </svg>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-on/60">
            {!controlUrl
              ? "Video en modo demostración"
              : !source
                ? "Sin cámara asignada"
                : state === "connecting"
                  ? "Conectando…"
                  : "Cámara no disponible"}
          </p>
        </div>
      ) : null}

      {label ? (
        <span className="absolute left-2 top-2 rounded-sm border border-ink-on/20 bg-black/45 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-on/85 backdrop-blur-sm">
          {label}
          {state === "live" ? " · en vivo" : ""}
        </span>
      ) : null}
    </div>
  );
}
