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
import type { Program } from "@/lib/lab-settings";
import type { ActionResult } from "@/lib/action-result";
import { Banner, TabStrip } from "./ui";

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
  labSlug,
  initialPrograms,
  savePrograms,
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
  labSlug: string;
  initialPrograms: Program[];
  savePrograms: (programs: Program[]) => Promise<boolean>;
  requestPromotion?: (previous: ActionResult | null) => Promise<ActionResult>;
}) {
  const [stage, setStage] = useState<Stage>("cameras");
  const [programs, setPrograms] = useState<Program[]>(initialPrograms);
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

  // Surface a refusal from the edge briefly, then let it go: it is feedback on
  // one action, not a state the user has to dismiss.
  useEffect(() => {
    if (!robot.lastDenial) return;
    const timer = setTimeout(robot.clearDenial, 6000);
    return () => clearTimeout(timer);
  }, [robot.lastDenial, robot.clearDenial]);

  // Derived every render from the live link state, never stored: a banner
  // held in state is exactly how a stale "Reintentando…" outlives the
  // reconnection it was describing. Returning null when the link is healthy is
  // what makes it disappear on its own.
  const connection = describeConnection(robot.link, robot.telemetry.connected);

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
          <Banner tone="danger" role="alert">
            ⚠ PARO DE EMERGENCIA activado por{" "}
            {control.state?.estopBy ?? "un operador"}.
          </Banner>
        ) : null}

        {connection ? (
          <Banner tone={connection.tone}>{connection.message}</Banner>
        ) : null}

        {robot.lastDenial ? (
          <Banner tone="warn" role="status">
            {robot.lastDenial}
          </Banner>
        ) : null}

        {/* One column on a phone with the stage first, so the video is never
            pushed below the fold; two from a tablet, with the stage spanning
            the top; three once there is room for the stage to sit between the
            controls and the session. */}
        <div className="grid min-w-0 gap-3 lg:grid-cols-2 xl:grid-cols-[290px_minmax(0,1fr)_310px]">
          {/* Stage */}
          <div className="flex min-h-0 min-w-0 flex-col gap-2 lg:col-span-2 xl:order-2 xl:col-span-1">
            <TabStrip
              label="Vista principal"
              items={STAGES}
              value={stage}
              onChange={openStage}
              className="w-full sm:w-auto sm:self-start"
            />

            <div className="flex min-h-64 flex-col xl:min-h-[28rem]">
              <Stage active={stage === "cameras"}>
                <CameraWall controlUrl={controlUrl} labSlug={labSlug} />
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
          <div className="min-w-0 lg:order-2 xl:order-1">
            <RobotControls
              telemetry={robot.telemetry}
              canDrive={canDrive}
              isOperator={canOperate}
              call={call}
            />
          </div>

          {/* Session · telemetry · activity */}
          <div className="flex min-h-0 min-w-0 flex-col gap-3 lg:order-3 xl:order-3">
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
              // Capped at every width, never merely flex-sized: this column is
              // a grid item in a content-sized row, so a feed left to grow sets
              // the row height, which sets the column height, which lets it
              // grow again — an unbounded box. The cap breaks that loop and the
              // list scrolls inside itself. flex-1 only fills leftover height
              // when the stage next to it happens to be taller.
              className="max-h-[min(50vh,20rem)] xl:max-h-[min(55vh,26rem)] xl:min-h-48 xl:flex-1"
            />
          </div>
        </div>
      </div>
    </LabShell>
  );
}

type BannerTone = "warn" | "neutral" | "ok";

// The banner and the status pill answer the same question at different
// lengths, so they are derived from the same input rather than kept in step by
// hand. Two distinct facts are folded in: whether this browser can reach the
// lab computer at all, and whether the robot behind it is reporting — a lab
// can be perfectly reachable with the arm switched off, and saying "sin
// conexión" then would be wrong.
function describeConnection(
  link: string,
  robotConnected: boolean,
): { tone: BannerTone; message: string } | null {
  switch (link) {
    case "connecting":
      return {
        tone: "neutral",
        message: "Conectando con el computador del laboratorio…",
      };
    case "offline":
      return {
        tone: "neutral",
        message:
          "Sin conexión con el computador del laboratorio — modo solo " +
          "observación. Reintentando automáticamente…",
      };
    case "unauthorized":
      return {
        tone: "warn",
        message:
          "El laboratorio rechazó tu sesión. Pide a un administrador del " +
          "proyecto que te asigne un rol en este laboratorio.",
      };
    case "demo":
      return {
        tone: "neutral",
        message:
          "Modo demostración: telemetría simulada y sin hardware conectado.",
      };
    case "online":
      // Connected to the lab computer, but the robot itself is not reporting.
      // Worth saying plainly, because every control will refuse and the reason
      // is not the web app.
      return robotConnected
        ? null
        : {
            tone: "warn",
            message:
              "Conectado al laboratorio, pero el robot no está reportando: " +
              "revisa que el driver esté en marcha. Solo observación.",
          };
    default:
      return null;
  }
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
