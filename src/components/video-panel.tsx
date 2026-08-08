"use client";

import { useEffect, useRef, useState } from "react";

// Low-latency video via go2rtc's WHEP endpoint
// (`<control>/api/video/api/webrtc?src=<name>` through the tunnel ingress).
// Without a backend (demo mode) or when negotiation fails, an animated
// placeholder keeps the layout honest instead of a black hole.
export function VideoPanel({
  controlUrl,
  source = "cam",
}: {
  controlUrl: string | null;
  source?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"demo" | "connecting" | "live" | "failed">(
    controlUrl ? "connecting" : "demo",
  );

  useEffect(() => {
    if (!controlUrl) return;
    let pc: RTCPeerConnection | null = null;
    let cancelled = false;

    async function connect() {
      try {
        pc = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });
        pc.addTransceiver("video", { direction: "recvonly" });
        pc.ontrack = (ev) => {
          if (videoRef.current && !cancelled) {
            videoRef.current.srcObject = ev.streams[0];
            setState("live");
          }
        };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const res = await fetch(
          `${controlUrl}/api/video/api/webrtc?src=${encodeURIComponent(source)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/sdp" },
            body: offer.sdp,
            signal: AbortSignal.timeout(8000),
          },
        );
        if (!res.ok) throw new Error(`whep ${res.status}`);
        await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
      } catch {
        if (!cancelled) setState("failed");
      }
    }
    void connect();
    return () => {
      cancelled = true;
      pc?.close();
    };
  }, [controlUrl, source]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-line bg-ink-surface">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`h-full w-full object-contain ${state === "live" ? "" : "hidden"}`}
      />
      {state !== "live" ? (
        <div className="ink-grid absolute inset-0 flex flex-col items-center justify-center gap-3 text-ink-on">
          <svg viewBox="0 0 120 80" className="w-24 opacity-70" aria-hidden>
            <g fill="none" stroke="var(--accent)" strokeWidth="2">
              <rect x="10" y="14" width="72" height="52" rx="4" />
              <path d="M82 32 108 20 v40 L82 48" />
              <circle cx="46" cy="40" r="12" />
              <circle cx="46" cy="40" r="5" fill="var(--accent)" />
            </g>
          </svg>
          <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-ink-on/60">
            {state === "demo"
              ? "Video en modo demostración"
              : state === "connecting"
                ? "Conectando video…"
                : "Video no disponible"}
          </p>
        </div>
      ) : null}
      <span className="absolute left-3 top-3 rounded-sm border border-ink-on/20 bg-black/40 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-ink-on/80 backdrop-blur-sm">
        {source} · {state === "live" ? "WebRTC" : state}
      </span>
    </div>
  );
}
