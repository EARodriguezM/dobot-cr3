"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  JOG_CARTESIAN_AXES,
  JOG_JOINT_AXES,
  JOINT_LABELS,
  SERVICES,
} from "@/lib/robot/commands";
import type { Telemetry } from "@/lib/robot/use-robot";
import { Button, Panel, TabStrip } from "./ui";

// The driving surface: power, speed, jogging, gripper and go-to.
//
// Everything here is disabled unless the caller holds the control lease *and*
// the edge has accepted its lease token — but those checks are cosmetic. The
// gatekeeper refuses the same commands independently, and it is the one that
// matters. The disabled states exist so a spectator understands why they
// cannot drive, not to enforce anything.
//
// The exceptions are the stops. Disable, jog-stop and the emergency stop stay
// live for every operator regardless of the lease, because someone has to be
// able to halt an arm they can see misbehaving.

const JOG_MODES = [
  { id: "joint", label: "Articular" },
  { id: "cartesian", label: "Cartesiano" },
] as const;

interface Props {
  telemetry: Telemetry;
  canDrive: boolean;
  isOperator: boolean;
  call: (service: string, payload?: unknown) => Promise<boolean>;
}

export const RobotControls = memo(function RobotControls({
  telemetry,
  canDrive,
  isOperator,
  call,
}: Props) {
  const [jogMode, setJogMode] = useState<"joint" | "cartesian">("joint");
  const [speed, setSpeed] = useState(50);
  const [target, setTarget] = useState<string[]>(() => Array(6).fill("0"));
  const jogging = useRef(false);
  const speedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow the robot's own speed until the user touches the slider, so two
  // operators taking turns do not each see a stale number.
  const touchedSpeed = useRef(false);
  useEffect(() => {
    if (!touchedSpeed.current && telemetry.speed) setSpeed(telemetry.speed);
  }, [telemetry.speed]);

  const stopJog = useCallback(() => {
    if (!jogging.current) return;
    jogging.current = false;
    void call(SERVICES.jogStop);
  }, [call]);

  const startJog = useCallback(
    (axisId: string) => {
      if (!canDrive) return;
      jogging.current = true;
      void call(SERVICES.jog, { axis_id: axisId });
    },
    [call, canDrive],
  );

  // A jog is a press-and-hold, so the release can happen anywhere: off the
  // button, outside the window, or in another tab. Every one of those has to
  // stop the arm.
  useEffect(() => {
    const stop = () => stopJog();
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", stop);
    };
  }, [stopJog]);

  // Releasing control mid-jog must not leave the arm moving.
  useEffect(() => {
    if (!canDrive) stopJog();
  }, [canDrive, stopJog]);

  const onSpeedChange = (value: number) => {
    touchedSpeed.current = true;
    setSpeed(value);
    if (speedTimer.current) clearTimeout(speedTimer.current);
    speedTimer.current = setTimeout(() => {
      if (canDrive) void call(SERVICES.setSpeed, { ratio: value });
    }, 250);
  };

  const axes = jogMode === "joint" ? JOG_JOINT_AXES : JOG_CARTESIAN_AXES;

  return (
    <div className="flex flex-col gap-3">
      <Panel title="Potencia">
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="ok"
            block
            disabled={!canDrive}
            onClick={() => void call(SERVICES.enable)}
          >
            Habilitar
          </Button>
          <Button
            variant="neutral"
            block
            disabled={!isOperator}
            onClick={() => void call(SERVICES.disable)}
          >
            Deshabilitar
          </Button>
        </div>
        <p className="mt-2.5 font-mono text-[10px] text-ink3">
          Estado:{" "}
          <span className={telemetry.enabled ? "text-ok" : "text-ink2"}>
            {telemetry.enabled == null
              ? "desconocido"
              : telemetry.enabled
                ? "habilitado"
                : "deshabilitado"}
          </span>
        </p>
        <Button
          variant="quiet"
          size="sm"
          block
          className="mt-2"
          disabled={!canDrive}
          onClick={() => void call(SERVICES.clearError)}
        >
          Limpiar errores
        </Button>
      </Panel>

      <Panel
        title="Velocidad"
        aside={
          <span className="font-mono text-[13px] tabular-nums text-ink">
            {speed}%
          </span>
        }
      >
        <input
          type="range"
          min={1}
          max={100}
          value={speed}
          disabled={!canDrive}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Factor de velocidad"
        />
      </Panel>

      <Panel title="Movimiento manual">
        <TabStrip
          label="Modo de movimiento"
          className="mb-3"
          value={jogMode}
          onChange={setJogMode}
          items={JOG_MODES}
        />

        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {axes.map((axis) => (
            <div
              key={axis.id}
              className="flex items-center gap-1.5 rounded-md border border-line bg-bg2 p-1.5"
            >
              <span className="w-8 shrink-0 pl-1 font-mono text-[11px] text-ink2">
                {axis.label}
              </span>
              <JogButton
                axisId={`${axis.id}-`}
                disabled={!canDrive}
                onDown={startJog}
                onUp={stopJog}
              >
                −
              </JogButton>
              <JogButton
                axisId={`${axis.id}+`}
                disabled={!canDrive}
                onDown={startJog}
                onUp={stopJog}
              >
                +
              </JogButton>
            </div>
          ))}
        </div>
        <p className="mt-2 font-mono text-[9px] leading-relaxed text-ink3">
          Mantén pulsado para mover · suelta para detener.
        </p>
      </Panel>

      <Panel title="Pinza">
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="quiet"
            block
            disabled={!canDrive}
            onClick={() => void call(SERVICES.gripper, { position: 0.0 })}
          >
            Abrir
          </Button>
          <Button
            variant="quiet"
            block
            disabled={!canDrive}
            onClick={() => void call(SERVICES.gripper, { position: 0.0142 })}
          >
            Cerrar
          </Button>
        </div>
      </Panel>

      <Panel title="Ir a">
        <Button
          variant="accent"
          block
          disabled={!canDrive}
          onClick={() => void call(SERVICES.home)}
        >
          Inicio (todas las juntas a 0°)
        </Button>

        <p className="mb-1.5 mt-3 font-mono text-[9px] uppercase tracking-[0.12em] text-ink3">
          Objetivo articular (grados)
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {JOINT_LABELS.map((label, i) => (
            <input
              key={label}
              type="number"
              value={target[i]}
              title={label}
              aria-label={label}
              disabled={!canDrive}
              onChange={(e) =>
                setTarget((prev) =>
                  prev.map((v, index) => (index === i ? e.target.value : v)),
                )
              }
              className="w-full rounded-md border border-line bg-bg2 px-2 py-1.5 font-mono text-[12px] tabular-nums text-ink outline-none focus-visible:border-accent disabled:opacity-40"
            />
          ))}
        </div>
        <Button
          variant="neutral"
          block
          className="mt-2"
          disabled={!canDrive}
          onClick={() =>
            void call(SERVICES.jointMove, {
              joints_deg: target.map((v) => Number(v) || 0),
            })
          }
        >
          Mover a la posición
        </Button>
      </Panel>
    </div>
  );
});

function JogButton({
  axisId,
  disabled,
  onDown,
  onUp,
  children,
}: {
  axisId: string;
  disabled: boolean;
  onDown: (axisId: string) => void;
  onUp: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`Mover ${axisId}`}
      // Pointer events rather than mouse events so press-and-hold works on the
      // tablets the lab is actually used from.
      onPointerDown={(e) => {
        e.preventDefault();
        onDown(axisId);
      }}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      onPointerCancel={onUp}
      className="flex-1 touch-none select-none rounded border border-line bg-card py-2 font-mono text-[15px] leading-none text-ink transition hover:border-accent hover:text-accent active:bg-accent active:text-white disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
