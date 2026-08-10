"use client";

import { useActionState } from "react";
import { updateLabAction } from "./actions";
import { Banner, Button, CheckField, Field, inputClass } from "@/components/ui";
import { IDLE } from "@/lib/action-result";

// The outcome of a save is rendered here rather than carried in the URL. This
// form opens over a live session, so a redirect to `?m=ok` would take the
// console down to say "saved".

const MESSAGES: Record<string, string> = {
  ok: "Cambios guardados.",
  denied: "Operación rechazada: permisos insuficientes.",
  noname: "El laboratorio necesita un nombre.",
  err: "Solicitud inválida.",
};

export function SettingsForm({
  name,
  description,
  published,
  inMaintenance,
  lastSeenAt,
}: {
  name: string;
  description: string;
  published: boolean;
  inMaintenance: boolean;
  lastSeenAt: string | null;
}) {
  const [result, formAction, pending] = useActionState(updateLabAction, IDLE);

  return (
    <>
      <form action={formAction} className="flex flex-col gap-4">
        <Field label="Nombre" htmlFor="lab-name">
          <input
            id="lab-name"
            name="name"
            required
            defaultValue={name}
            className={inputClass}
          />
        </Field>

        <Field label="Descripción" htmlFor="lab-description">
          <textarea
            id="lab-description"
            name="description"
            rows={3}
            defaultValue={description}
            className={inputClass}
          />
        </Field>

        <CheckField
          name="published"
          defaultChecked={published}
          label="Publicado"
          hint="Visible para cualquier integrante del semillero. Sin publicar, solo el equipo del laboratorio puede entrar — útil mientras se construye. No requiere que el hardware esté conectado."
        />

        <CheckField
          name="in_maintenance"
          defaultChecked={inMaintenance}
          label="En mantenimiento"
          hint="El laboratorio aparece fuera de servicio en la plataforma. Es distinto de «sin conexión», que significa que dejó de reportarse."
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="accent" size="lg" disabled={pending}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
          {result ? (
            <span
              role="status"
              className={`font-mono text-[11px] ${
                result.ok ? "text-ok" : "text-danger"
              }`}
            >
              {MESSAGES[result.code] ?? MESSAGES.err}
            </span>
          ) : null}
        </div>
      </form>

      <section className="mt-8 border-t border-line pt-5">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
          Configuración del hardware
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink2">
          La IP y los puertos del robot, los límites de velocidad, el recorrido
          de la pinza y las cámaras se configuran en el computador del
          laboratorio, no desde aquí. Consulta{" "}
          <code className="font-mono text-[12px] text-ink3">
            docs/deploy-pi.md
          </code>
          .
        </p>
        <Banner tone="neutral" className="mt-3">
          {lastSeenAt
            ? `Último latido: ${new Date(lastSeenAt).toLocaleString("es-CO")}.`
            : "Este laboratorio nunca ha reportado actividad."}
        </Banner>
      </section>
    </>
  );
}
