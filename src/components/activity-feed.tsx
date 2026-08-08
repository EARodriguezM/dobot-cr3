"use client";

import { describeAction } from "@/lib/robot/commands";
import type { ActivityEvent } from "@/lib/robot/protocol";

// What the other people in the lab are doing.
//
// Telemetry tells a spectator that joint 2 is moving. It does not tell them
// whether someone commanded that move or the arm is faulting, nor who is
// responsible. This feed answers both: every command the edge gatekeeper
// accepts is broadcast to every connected session with the name of whoever
// issued it, and it lands here in order.
//
// It is a log of commands *accepted and dispatched*, not of completed motions
// — a command ROS later rejects still appears. That is deliberate: for a
// shared instrument, knowing what someone asked for is as important as knowing
// what happened, and the telemetry readout next to it says whether the arm
// actually moved.

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString("es-CO", { hour12: false });
}

export function ActivityFeed({
  activity,
  currentUserId,
  className = "",
}: {
  activity: ActivityEvent[];
  currentUserId: string | null;
  className?: string;
}) {
  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-card ${className}`}
      aria-label="Actividad del laboratorio"
    >
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
          Actividad
        </h2>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink3">
          comandos enviados
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activity.length === 0 ? (
          <p className="px-4 py-6 text-center font-mono text-[11px] leading-relaxed text-ink3">
            Aún no hay comandos.
            <br />
            Aquí verás lo que hace quien tiene el control.
          </p>
        ) : (
          <ul className="list-none">
            {activity.map((event) => {
              const mine = event.user.id === currentUserId;
              return (
                <li
                  key={event.id}
                  className={`flex items-baseline gap-2 border-b border-line px-4 py-2 last:border-0 ${
                    event.stop ? "bg-danger/10" : ""
                  }`}
                >
                  <time
                    dateTime={new Date(event.ts).toISOString()}
                    className="shrink-0 font-mono text-[10px] tabular-nums text-ink3"
                  >
                    {timeOf(event.ts)}
                  </time>
                  <p className="min-w-0 text-[13px] leading-snug">
                    <span
                      className={`font-medium ${
                        event.stop ? "text-danger" : mine ? "text-accent" : "text-ink"
                      }`}
                    >
                      {mine ? "Tú" : event.user.name}
                    </span>{" "}
                    <span className={event.stop ? "text-danger" : "text-ink2"}>
                      {describeAction(event.action, event.detail)}
                    </span>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
