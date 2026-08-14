"use client";

import { memo, useMemo } from "react";
import { describeAction } from "@/lib/robot/commands";
import { Panel } from "./ui";
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

// Second resolution, 24 h, fixed width: two commands a second apart are common
// during a jog and the feed has to show the difference. hourCycle h23 rather
// than hour12:false so midnight reads 00:xx and never 24:xx.
//
// The formatters are built once — a live feed re-renders on every command, and
// constructing an Intl formatter per row is the expensive part of that render.
const TIME_FORMAT = new Intl.DateTimeFormat("es-CO", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

// Hover/long-press detail: the day matters once a session has run past midnight
// or the tab has been left open.
const STAMP_FORMAT = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "medium",
  timeStyle: "medium",
  hourCycle: "h23",
});

export const ActivityFeed = memo(function ActivityFeed({
  activity,
  currentUserId,
  className = "",
}: {
  activity: ActivityEvent[];
  currentUserId: string | null;
  className?: string;
}) {
  // Newest first, by the timestamp the gatekeeper stamped rather than by the
  // order frames happened to arrive in: a reconnect replays recent commands and
  // a slow socket can deliver two out of sequence, and a log that lies about
  // the order of events is worse than no log on shared hardware.
  const ordered = useMemo(
    () => [...activity].sort((a, b) => b.ts - a.ts),
    [activity],
  );

  return (
    <Panel
      title="Actividad"
      label="Actividad del laboratorio"
      divided
      aside={
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink3">
          {ordered.length === 0
            ? "comandos enviados"
            : `${ordered.length} comando${ordered.length === 1 ? "" : "s"}`}
        </span>
      }
      className={`overflow-hidden ${className}`}
      // The list is the scroller, not the page: on a phone the feed sits under
      // the video and the controls, and overscroll-contain keeps a flick inside
      // it from scrolling the whole console away. scrollbar-gutter reserves the
      // track so rows do not shift sideways when the first command arrives.
      bodyClassName="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
    >
      <div>
        {ordered.length === 0 ? (
          <p className="px-4 py-6 text-center font-mono text-[11px] leading-relaxed text-ink3">
            Aún no hay comandos.
            <br />
            Aquí verás lo que hace quien tiene el control.
          </p>
        ) : (
          <ul className="list-none">
            {ordered.map((event) => {
              const mine = event.user.id === currentUserId;
              const at = new Date(event.ts);
              return (
                <li
                  key={event.id}
                  // Two columns rather than a wrapping flex row: the clock keeps
                  // its own column at every width, so the messages stay aligned
                  // and a long one wraps under itself instead of under the time.
                  className={`grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2 border-b border-line px-3 py-2 last:border-0 sm:px-4 ${
                    event.stop ? "bg-danger/10" : ""
                  }`}
                >
                  <time
                    dateTime={at.toISOString()}
                    title={STAMP_FORMAT.format(at)}
                    className="font-mono text-[10px] tabular-nums text-ink3"
                  >
                    {TIME_FORMAT.format(at)}
                  </time>
                  <p className="min-w-0 text-[12px] leading-snug break-words hyphens-auto sm:text-[13px]">
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
    </Panel>
  );
});
