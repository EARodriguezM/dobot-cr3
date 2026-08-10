"use client";

import { memo, useState } from "react";
import { SERVICES } from "@/lib/robot/commands";
import type { Program, ProgramStep } from "@/lib/lab-settings";
import type { Telemetry } from "@/lib/robot/use-robot";
import { Button } from "./ui";

// Teach-pendant programs: capture the live pose as a waypoint, build an ordered
// sequence, save it for the whole project, and run it.
//
// Two decisions worth knowing:
//
// * Programs are stored in the platform database, not the browser, so a routine
//   one student records is there for the next one (see lib/lab-settings.ts).
// * Execution happens on the lab computer, not here. The whole program is sent
//   in one call and the weblab node sequences it. A browser-side loop would
//   stop issuing steps the moment a laptop lid closed — mid-sequence, with the
//   arm wherever the last step left it — and it would need the control lease to
//   survive every network hiccup for the full duration. Running it on the Pi
//   also means the step counter arrives in telemetry, so *every* spectator sees
//   which step is executing, not just the operator.

function stepLabel(step: ProgramStep, index: number): string {
  switch (step.kind) {
    case "waypoint":
      return `${index + 1}. Punto — ${(step.joints ?? [])
        .map((v) => v.toFixed(0))
        .join(", ")}`;
    case "gripper":
      return `${index + 1}. Pinza — ${(step.position ?? 0) > 0.005 ? "cerrar" : "abrir"}`;
    case "wait":
      return `${index + 1}. Esperar ${step.seconds ?? 1}s`;
  }
}

export const ProgramsPanel = memo(function ProgramsPanel({
  programs,
  telemetry,
  canDrive,
  canEdit,
  onSave,
  call,
}: {
  programs: Program[];
  telemetry: Telemetry;
  canDrive: boolean;
  canEdit: boolean;
  onSave: (programs: Program[]) => void;
  call: (service: string, payload?: unknown) => Promise<boolean>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    programs[0]?.id ?? null,
  );
  const selected = programs.find((p) => p.id === selectedId) ?? null;
  const running = telemetry.program.running;

  const mutate = (next: Program) =>
    onSave(programs.map((p) => (p.id === next.id ? next : p)));

  const addProgram = () => {
    const program: Program = {
      id: crypto.randomUUID(),
      name: `Programa ${programs.length + 1}`,
      steps: [],
    };
    onSave([...programs, program]);
    setSelectedId(program.id);
  };

  const addStep = (step: ProgramStep) => {
    if (!selected) return;
    mutate({ ...selected, steps: [...selected.steps, step] });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
      {/* Program list */}
      <div className="flex w-full shrink-0 flex-col gap-2 md:w-56">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
            Programas
          </h2>
          {canEdit ? (
            <Button variant="quiet" size="sm" onClick={addProgram}>
              + Nuevo
            </Button>
          ) : null}
        </div>
        <ul className="list-none space-y-1">
          {programs.map((program) => (
            <li key={program.id}>
              <button
                type="button"
                onClick={() => setSelectedId(program.id)}
                className={`w-full truncate rounded-md border px-2.5 py-2 text-left text-[13px] transition ${
                  program.id === selectedId
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-line text-ink2 hover:border-accent"
                }`}
              >
                {program.name}
                <span className="ml-1 font-mono text-[10px] text-ink3">
                  ({program.steps.length})
                </span>
              </button>
            </li>
          ))}
          {programs.length === 0 ? (
            <li className="font-mono text-[11px] leading-relaxed text-ink3">
              Todavía no hay programas guardados.
            </li>
          ) : null}
        </ul>
      </div>

      {/* Steps */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-line bg-card p-3">
        {selected ? (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <input
                value={selected.name}
                disabled={!canEdit}
                onChange={(e) => mutate({ ...selected, name: e.target.value })}
                aria-label="Nombre del programa"
                className="min-w-0 flex-1 rounded-md border border-line bg-bg2 px-2 py-1.5 text-[13px] text-ink outline-none focus-visible:border-accent disabled:opacity-60"
              />
              <Button
                variant="accent"
                size="sm"
                disabled={!canDrive || running || selected.steps.length === 0}
                onClick={() =>
                  void call(SERVICES.programRun, {
                    name: selected.name,
                    steps: selected.steps,
                  })
                }
              >
                ▶ Ejecutar
              </Button>
              {/* Stopping a running program is a stop: available to any
                  operator, lease or no lease. */}
              <Button
                variant="estop"
                size="sm"
                disabled={!running}
                onClick={() => void call(SERVICES.programStop)}
              >
                ■ Detener
              </Button>
            </div>

            {running ? (
              <p className="mb-2 rounded-md border border-ok bg-ok/10 px-2.5 py-1.5 font-mono text-[10px] text-ink2">
                Ejecutando «{telemetry.program.programName || selected.name}» —
                paso {telemetry.program.stepIndex + 1} de{" "}
                {telemetry.program.stepCount}
                {telemetry.program.operatorName
                  ? ` · ${telemetry.program.operatorName}`
                  : ""}
              </p>
            ) : null}

            <ol className="min-h-0 flex-1 list-none space-y-1 overflow-y-auto">
              {selected.steps.map((step, index) => (
                <li
                  key={index}
                  className={`flex items-center gap-2 rounded border px-2.5 py-1.5 font-mono text-[11px] ${
                    running && telemetry.program.stepIndex === index
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-line text-ink2"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {stepLabel(step, index)}
                  </span>
                  {canEdit ? (
                    <button
                      type="button"
                      aria-label={`Eliminar paso ${index + 1}`}
                      onClick={() =>
                        mutate({
                          ...selected,
                          steps: selected.steps.filter((_, i) => i !== index),
                        })
                      }
                      className="shrink-0 text-ink3 transition hover:text-danger"
                    >
                      ✕
                    </button>
                  ) : null}
                </li>
              ))}
              {selected.steps.length === 0 ? (
                <li className="font-mono text-[11px] leading-relaxed text-ink3">
                  Mueve el robot a una pose y captura un punto para empezar.
                </li>
              ) : null}
            </ol>

            {canEdit ? (
              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-line pt-2">
                <Button
                  variant="quiet"
                  size="sm"
                  disabled={telemetry.jointsDeg.length === 0}
                  onClick={() =>
                    addStep({
                      kind: "waypoint",
                      joints: telemetry.jointsDeg.slice(0, 6),
                    })
                  }
                >
                  + Capturar punto
                </Button>
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => addStep({ kind: "gripper", position: 0 })}
                >
                  + Abrir pinza
                </Button>
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => addStep({ kind: "gripper", position: 0.0142 })}
                >
                  + Cerrar pinza
                </Button>
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => addStep({ kind: "wait", seconds: 1 })}
                >
                  + Esperar 1s
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  className="ml-auto"
                  onClick={() =>
                    onSave(programs.filter((p) => p.id !== selected.id))
                  }
                >
                  Eliminar programa
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="m-auto max-w-64 text-center font-mono text-[11px] leading-relaxed text-ink3">
            Selecciona un programa, o crea uno nuevo para grabar una secuencia
            de puntos.
          </p>
        )}
      </div>
    </div>
  );
});
