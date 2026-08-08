"use client";

import { useEffect, useRef, useState } from "react";

export type LinkState = "demo" | "connecting" | "online" | "offline";

interface Line {
  ts: string;
  channel: string;
  text: string;
}

const MAX_LINES = 200;

// Telemetry console. With a backend it speaks the foxglove_bridge WebSocket
// protocol (`foxglove.websocket.v1` at `<control>/ws`): reads serverInfo /
// advertise, subscribes to JSON-encoded channels and prints their messages.
// Without one (demo mode) a mock driver emits synthetic joint states so the
// template demos with zero hardware.
export function TelemetryConsole({
  controlUrl,
  onLinkChange,
}: {
  controlUrl: string | null;
  onLinkChange?: (s: LinkState) => void;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [link, setLink] = useState<LinkState>(controlUrl ? "connecting" : "demo");
  const scrollRef = useRef<HTMLDivElement>(null);

  const push = (channel: string, text: string) => {
    setLines((prev) => [
      ...prev.slice(-(MAX_LINES - 1)),
      { ts: new Date().toLocaleTimeString("es-CO", { hour12: false }), channel, text },
    ]);
  };

  useEffect(() => {
    onLinkChange?.(link);
  }, [link, onLinkChange]);

  // Mock driver
  useEffect(() => {
    if (controlUrl) return;
    let t = 0;
    const timer = setInterval(() => {
      t += 0.2;
      const joints = [0, 1, 2].map(
        (i) => +(Math.sin(t + i * 1.1) * (30 + i * 15)).toFixed(2),
      );
      push(
        "/joint_states",
        `{"position":[${joints.join(", ")}],"velocity":[0.00, 0.00, 0.00]}`,
      );
    }, 500);
    push("driver", "modo demostración: telemetría sintética (sin hardware)");
    return () => clearInterval(timer);
  }, [controlUrl]);

  // foxglove_bridge client
  useEffect(() => {
    if (!controlUrl) return;
    const base = controlUrl;
    let ws: WebSocket | null = null;
    let closed = false;
    const channels = new Map<number, string>(); // channel id -> topic
    const subs = new Map<number, number>(); // subscription id -> channel id
    let nextSub = 0;

    function connect() {
      const wsUrl = `${base.replace(/^http/, "ws")}/ws`;
      try {
        ws = new WebSocket(wsUrl, ["foxglove.websocket.v1"]);
      } catch {
        setLink("offline");
        return;
      }
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        setLink("online");
        push("bridge", `conectado a ${wsUrl}`);
      };
      ws.onclose = () => {
        if (!closed) {
          setLink("offline");
          setTimeout(connect, 5000);
        }
      };
      ws.onerror = () => setLink("offline");
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.op === "serverInfo") {
              push("bridge", `servidor: ${msg.name ?? "foxglove_bridge"}`);
            } else if (msg.op === "advertise") {
              const toSubscribe: Array<{ id: number; channelId: number }> = [];
              for (const ch of msg.channels ?? []) {
                channels.set(ch.id, ch.topic);
                if (ch.encoding === "json") {
                  const id = nextSub++;
                  subs.set(id, ch.id);
                  toSubscribe.push({ id, channelId: ch.id });
                }
                push("bridge", `canal: ${ch.topic} (${ch.encoding})`);
              }
              if (toSubscribe.length > 0) {
                ws?.send(
                  JSON.stringify({ op: "subscribe", subscriptions: toSubscribe }),
                );
              }
            } else if (msg.op === "status") {
              push("bridge", `estado: ${msg.message}`);
            }
          } catch {
            // Non-JSON text frame: ignore.
          }
          return;
        }
        // Binary frame: opcode 0x01 = message data
        const view = new DataView(ev.data as ArrayBuffer);
        if (view.byteLength > 13 && view.getUint8(0) === 0x01) {
          const subId = view.getUint32(1, true);
          const channelId = subs.get(subId);
          const topic = channelId !== undefined ? (channels.get(channelId) ?? "?") : "?";
          const payload = new TextDecoder().decode(
            new Uint8Array(ev.data as ArrayBuffer, 13),
          );
          push(topic, payload.slice(0, 400));
        }
      };
    }

    connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }, [controlUrl]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  return (
    <div className="flex h-full min-h-56 flex-col overflow-hidden rounded-xl border border-line bg-ink-surface">
      <div className="flex items-center justify-between border-b border-ink-on/10 px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-on/50">
          Telemetría
        </span>
        <span
          className={`font-mono text-[9px] uppercase tracking-[0.15em] ${
            link === "online"
              ? "text-ok"
              : link === "demo"
                ? "text-warn"
                : "text-ink-on/40"
          }`}
        >
          {link === "online"
            ? "foxglove_bridge"
            : link === "demo"
              ? "mock driver"
              : link === "connecting"
                ? "conectando…"
                : "sin conexión"}
        </span>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 font-mono text-[11px] leading-relaxed"
      >
        {lines.map((l, i) => (
          <p key={i} className="whitespace-pre-wrap break-all">
            <span className="text-ink-on/35">{l.ts}</span>{" "}
            <span className="text-accent">{l.channel}</span>{" "}
            <span className="text-ink-on/80">{l.text}</span>
          </p>
        ))}
      </div>
    </div>
  );
}
