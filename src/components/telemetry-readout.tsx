"use client";

import { memo } from "react";
import { JOINT_LABELS, POSE_AXES } from "@/lib/robot/commands";
import type { Telemetry } from "@/lib/robot/use-robot";
import { Banner, Panel } from "./ui";

// Live joint angles and TCP pose. Every viewer sees exactly this, whether or
// not they hold control: it is the ground truth about where the arm actually
// is, next to the activity feed's account of what people asked it to do.

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-bg2 px-2 py-1.5">
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink3">
        {label}
      </div>
      <div className="font-mono text-[13px] tabular-nums text-ink">{value}</div>
    </div>
  );
}

export const TelemetryReadout = memo(function TelemetryReadout({
  telemetry,
  units,
}: {
  telemetry: Telemetry;
  units: "deg" | "rad";
}) {
  const joints = units === "deg" ? telemetry.jointsDeg : telemetry.jointsRad;
  const suffix = units === "deg" ? "°" : "";

  return (
    <Panel
      title="Telemetría"
      aside={
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink3">
          {units === "deg" ? "grados" : "radianes"}
        </span>
      }
    >
      <div className="grid grid-cols-3 gap-1.5">
        {JOINT_LABELS.map((label, i) => (
          <Cell
            key={label}
            label={label}
            value={
              joints[i] != null ? `${joints[i].toFixed(units === "deg" ? 1 : 3)}${suffix}` : "–"
            }
          />
        ))}
      </div>

      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        {POSE_AXES.map(({ label, key }) => {
          const value = telemetry.pose[key];
          return (
            <Cell
              key={label}
              label={label}
              value={value != null ? value.toFixed(1) : "–"}
            />
          );
        })}
      </div>

      {telemetry.error ? (
        <Banner tone="danger" role="alert" className="mt-3">
          {telemetry.error}
        </Banner>
      ) : null}
    </Panel>
  );
});
