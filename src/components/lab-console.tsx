"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { ActivityFeed } from "./activity-feed";
import { CameraWall } from "./camera-wall";
import { LabShell } from "./lab-shell";
import { ProgramsPanel } from "./programs-panel";
import { RobotControls } from "./robot-controls";
import { SessionPanel } from "./session-panel";
import { TelemetryReadout } from "./telemetry-readout";
import { useControl } from "@/lib/control/use-control";
import { useRobot } from "@/lib/robot/use-robot";
import type { WallLayout } from "@/lib/camera-layout";
import type { Program } from "@/lib/lab-settings";

// The operating surface. One socket to the hardware, one lease, three views.
//
// The layout answers the shared-instrument requirement directly: whatever tab
// is open, the right-hand column always carries who is driving, where the arm
// is, and what has just been commanded — so a spectator never has to guess
// what the operator is doing, and the operator can see who is watching.

// ~37 MB of meshes and the whole three.js runtime: loaded only when someone
// opens the 3D tab, never behind the control screen's first paint.
const Robot3D = dynamic(() => import("./robot-3d"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-64 items-center justify-center rounded-xl border border-line bg-ink-surface">
      <p className="font-mono text-[11px] text-ink-on/60">Cargando modelo 3D…</p>
    </div>
  ),
});

type Stage = "cameras" | "model" | "programs";

const STAGES: { id: Stage; label: string }[] = [
  { id: "cameras", label: "Cámaras" },
  { id: "model", label: "Modelo 3D" },
  { id: "programs", label: "Programas" },
];

export function LabConsole({
  controlUrl,
  labName,
  userId,
  userName,
  roleLabel,
  canOperate,
  canAdmin,
  configured,
  initialPrograms,
  initialLayout,
  savePrograms,
  saveLayout,
  requestPromotion,
}: {
  controlUrl: string | null;
  labName: string;
  userId: string | null;
  userName: string | null;
  roleLabel: string | null;
  canOperate: boolean;
  canAdmin: boolean;
  configured: boolean;
  initialPrograms: Program[];
  initialLayout: WallLayout;
  savePrograms: (programs: Program[]) => Promise<boolean>;
  saveLayout: (layout: WallLayout) => Promise<boolean>;
  requestPromotion?: () => Promise<void>;
}) {
  const [stage, setStage] = useState<Stage>("cameras");
  const [programs, setPrograms] = useState<Program[]>(initialPrograms);
  const [layout, setLayout] = useState<WallLayout>(initialLayout);
  const [units, setUnits] = useState<"deg" | "rad">("deg");

  const control = useControl(userId);
  const robot = useRobot(controlUrl, control.leaseToken);

  // Driving requires the lease *and* the edge's acceptance of it. In demo mode
  // there is no edge to accept anything, so the operator role is enough for the
  // UI to be explorable.
  const canDrive = configured
    ? canOperate && control.iAmHolder && robot.authorizedToDrive
    : canOperate;

  const persistPrograms = useCallback(
    (next: Program[]) => {
      setPrograms(next);
      void savePrograms(next);
    },
    [savePrograms],
  );

  const persistLayout = useCallback(
    (next: WallLayout) => {
      setLayout(next);
      void saveLayout(next);
    },
    [saveLayout],
  );

  // Surface a refusal from the edge briefly, then let it go: it is feedback on
  // one action, not a state the user has to dismiss.
  useEffect(() => {
    if (!robot.lastDenial) return;
    const timer = setTimeout(robot.clearDenial, 6000);
    return () => clearTimeout(timer);
  }, [robot.lastDenial, robot.clearDenial]);

  const { statusDot, statusLabel } = describeLink(
    robot.link,
    robot.telemetry.connected,
  );

  // The e-stop banner ages out on its own, so the component needs a clock of
  // its own: reading Date.now() during render would make the output depend on
  // when React happened to re-render.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, []);

  const recentEstop =
    control.state?.estopAt != null && now - control.state.estopAt < 30_000;

  return (
    <LabShell
      labName={labName}
      userName={userName}
      roleLabel={roleLabel}
      canAdmin={canAdmin}
      isOperator={canOperate}
      viewers={Math.max(robot.viewers, control.state?.presence.length ?? 0)}
      statusDot={statusDot}
      statusLabel={statusLabel}
      onEstop={() => {
        void control.estop();
        void robot.call("/weblab/estop");
      }}
    >
      <div className="flex flex-col gap-3">
        {/* Banners */}
        {recentEstop ? (
          <p
            role="alert"
            className="border border-danger bg-danger/10 px-4 py-2.5 font-mono text-xs text-danger"
          >
            ⚠ PARO DE EMERGENCIA activado por{" "}
            {control.state?.estopBy ?? "un operador"}.
          </p>
        ) : null}

        {robot.link === "unauthorized" ? (
          <p className="border border-warn bg-warn/10 px-4 py-2.5 font-mono text-xs text-warn">
            El laboratorio rechazó tu sesión. Pide a un administrador del
            proyecto que te asigne un rol en este laboratorio.
          </p>
        ) : null}

        {robot.link === "offline" ? (
          <p className="border border-line bg-bg2 px-4 py-2.5 font-mono text-xs text-ink3">
            Sin conexión con el computador del laboratorio — modo solo
            observación. Reintentando…
          </p>
        ) : null}

        {robot.lastDenial ? (
          <p
            role="status"
            className="border border-warn bg-warn/10 px-4 py-2.5 font-mono text-xs text-warn"
          >
            {robot.lastDenial}
          </p>
        ) : null}

        {/* Three columns on desktop; on a phone the stage comes first so the
            video is never pushed below the fold. */}
        <div className="grid min-w-0 gap-3 xl:grid-cols-[280px_minmax(0,1fr)_300px]">
          {/* Stage */}
          <div className="flex min-h-0 min-w-0 flex-col gap-2 xl:order-2">
            <div
              role="tablist"
              aria-label="Vista principal"
              className="flex w-full overflow-hidden rounded-md border border-line sm:w-auto sm:self-start"
            >
              {STAGES.map((item) => (
                <button
                  key={item.id}
                  role="tab"
                  aria-selected={stage === item.id}
                  type="button"
                  onClick={() => setStage(item.id)}
                  className={`flex-1 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.1em] transition sm:flex-none ${
                    stage === item.id
                      ? "bg-accent text-white"
                      : "text-ink3 hover:text-ink"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex min-h-64 flex-col xl:min-h-[28rem]">
              {stage === "cameras" ? (
                <CameraWall
                  controlUrl={controlUrl}
                  layout={layout}
                  canEdit={canOperate}
                  onLayoutChange={persistLayout}
                />
              ) : stage === "model" ? (
                <Robot3D jointsRad={robot.telemetry.jointsRad} />
              ) : (
                <ProgramsPanel
                  programs={programs}
                  telemetry={robot.telemetry}
                  canDrive={canDrive}
                  canEdit={canOperate}
                  onSave={persistPrograms}
                  call={robot.call}
                />
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="min-w-0 xl:order-1">
            <RobotControls
              telemetry={robot.telemetry}
              canDrive={canDrive}
              isOperator={canOperate}
              call={robot.call}
            />
          </div>

          {/* Session · telemetry · activity */}
          <div className="flex min-w-0 flex-col gap-3 xl:order-3">
            <SessionPanel
              state={control.state}
              userId={userId}
              canOperate={canOperate}
              canAdmin={canAdmin}
              iAmHolder={control.iAmHolder}
              queuePosition={control.queuePosition}
              waiting={control.waiting}
              onTake={() => void control.take()}
              onForce={() => void control.force()}
              onRelease={() => void control.release()}
              onRequestPromotion={requestPromotion}
            />

            <button
              type="button"
              onClick={() => setUnits(units === "deg" ? "rad" : "deg")}
              className="self-end font-mono text-[9px] uppercase tracking-[0.12em] text-ink3 transition hover:text-accent"
            >
              Ver en {units === "deg" ? "radianes" : "grados"}
            </button>
            <TelemetryReadout telemetry={robot.telemetry} units={units} />

            <ActivityFeed
              activity={robot.activity}
              currentUserId={userId}
              className="max-h-80 xl:max-h-none xl:flex-1"
            />
          </div>
        </div>
      </div>
    </LabShell>
  );
}

function describeLink(
  link: string,
  robotConnected: boolean,
): { statusDot: "ok" | "warn" | "err"; statusLabel: string } {
  if (link === "demo") return { statusDot: "warn", statusLabel: "Demostración" };
  if (link === "connecting") return { statusDot: "warn", statusLabel: "Conectando…" };
  if (link === "unauthorized") return { statusDot: "err", statusLabel: "Sin acceso" };
  if (link === "offline") return { statusDot: "err", statusLabel: "Sin conexión" };
  return robotConnected
    ? { statusDot: "ok", statusLabel: "Robot conectado" }
    : { statusDot: "warn", statusLabel: "Esperando al robot" };
}
