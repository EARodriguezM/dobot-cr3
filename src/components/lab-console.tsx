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
import type { ActionResult } from "@/lib/action-result";

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

/** How long the emergency-stop banner stays up after the stop. */
const ESTOP_BANNER_MS = 30_000;

/** Grace period before an idle 3D view gives its GPU memory back. */
const MODEL_IDLE_MS = 120_000;

// Every stage stays mounted once it has been opened, and inactive ones are
// hidden with CSS rather than unmounted. Switching tabs must not renegotiate
// the WebRTC tiles or re-download the arm's meshes — a teleoperation session is
// a live thing, and tearing it down to look at a different view of it is the
// one thing the interface must never do.
function Stage({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div className={active ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
      {children}
    </div>
  );
}

/**
 * True while `at` is younger than `ttl`, false once it has aged out.
 *
 * One timer, armed for exactly the remaining life of the flag, and one render
 * when it fires. The emergency-stop banner used to be driven by a 500 ms
 * interval at the root of the console, which re-rendered every panel, camera
 * tile and 3D frame below it twice a second for the entire session — for a
 * banner that is almost never on screen.
 */
function useExpiringFlag(at: number | null, ttl: number): boolean {
  const [expired, setExpired] = useState<number | null>(null);

  useEffect(() => {
    if (at == null) return;
    const timer = setTimeout(
      () => setExpired(at),
      Math.max(0, ttl - (Date.now() - at)),
    );
    return () => clearTimeout(timer);
  }, [at, ttl]);

  return at != null && expired !== at;
}

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
  requestPromotion?: (previous: ActionResult | null) => Promise<ActionResult>;
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

  const estopVisible = useExpiringFlag(
    control.state?.estopAt ?? null,
    ESTOP_BANNER_MS,
  );

  // The meshes are expensive to fetch but also expensive to keep resident on a
  // phone, so the model is dropped only after the tab has been left alone for
  // a while — long enough that flipping between views costs nothing. Mounting
  // is caused by the user opening the tab, so it belongs in the handler.
  const [modelMounted, setModelMounted] = useState(false);
  const openStage = useCallback((next: Stage) => {
    setStage(next);
    if (next === "model") setModelMounted(true);
  }, []);

  useEffect(() => {
    if (stage === "model" || !modelMounted) return;
    const timer = setTimeout(() => setModelMounted(false), MODEL_IDLE_MS);
    return () => clearTimeout(timer);
  }, [stage, modelMounted]);

  // Stable identities so the memoised panels below only re-render when their
  // own data moves — telemetry arriving at hardware rate must not re-render the
  // camera wall or the activity feed. Each action is destructured out of its
  // hook rather than reached through it: the hooks hand back a fresh object on
  // every render, so depending on the object would defeat every memo here.
  const { estop, take, force, release, requestHandover, respondToHandover } =
    control;
  const { call } = robot;

  const onEstop = useCallback(() => {
    void estop();
    void call("/weblab/estop");
  }, [estop, call]);

  const onTake = useCallback(() => void take(), [take]);
  const onForce = useCallback(() => void force(), [force]);
  const onRelease = useCallback(() => void release(), [release]);
  const onRequestHandover = useCallback(
    () => void requestHandover(),
    [requestHandover],
  );
  const onRespondToHandover = useCallback(
    (id: string, accept: boolean) => void respondToHandover(id, accept),
    [respondToHandover],
  );
  const toggleUnits = useCallback(
    () => setUnits((current) => (current === "deg" ? "rad" : "deg")),
    [],
  );

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
      onEstop={onEstop}
    >
      <div className="flex flex-col gap-3">
        {/* Banners */}
        {estopVisible ? (
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
                  onClick={() => openStage(item.id)}
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
              <Stage active={stage === "cameras"}>
                <CameraWall
                  controlUrl={controlUrl}
                  layout={layout}
                  canEdit={canOperate}
                  onLayoutChange={persistLayout}
                />
              </Stage>

              {modelMounted ? (
                <Stage active={stage === "model"}>
                  <Robot3D
                    jointsRad={robot.telemetry.jointsRad}
                    active={stage === "model"}
                  />
                </Stage>
              ) : null}

              <Stage active={stage === "programs"}>
                <ProgramsPanel
                  programs={programs}
                  telemetry={robot.telemetry}
                  canDrive={canDrive}
                  canEdit={canOperate}
                  onSave={persistPrograms}
                  call={call}
                />
              </Stage>
            </div>
          </div>

          {/* Controls */}
          <div className="min-w-0 xl:order-1">
            <RobotControls
              telemetry={robot.telemetry}
              canDrive={canDrive}
              isOperator={canOperate}
              call={call}
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
              onTake={onTake}
              onForce={onForce}
              onRelease={onRelease}
              onRequestPromotion={requestPromotion}
              onRequestHandover={onRequestHandover}
              onRespondToHandover={onRespondToHandover}
              handoverRequests={control.handoverRequests}
              awaitingHandover={control.awaitingHandover}
            />

            <button
              type="button"
              onClick={toggleUnits}
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
