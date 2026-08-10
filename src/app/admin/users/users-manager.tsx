"use client";

import { useActionState } from "react";
import { manageTeamAction } from "./actions";
import {
  Banner,
  Button,
  Field,
  RoleTag,
  inputClass,
  type Tone,
} from "@/components/ui";
import { IDLE } from "@/lib/action-result";

// One card per person, stacking cleanly on a phone: identity on top, the role
// control below. No table — a table with selects inside is what made this
// unusable on small screens.
//
// Every form here dispatches the same action with a different intent, so the
// panel shares a single `useActionState`: whichever form was submitted last is
// the one whose outcome is showing, and none of them navigate.

const ROLE_OPTIONS = [
  {
    value: "admin",
    label: "Administrador",
    hint: "Configura el laboratorio y gestiona el equipo",
  },
  {
    value: "operator",
    label: "Operador",
    hint: "Puede tomar el control del hardware",
  },
  { value: "viewer", label: "Observador", hint: "Solo ve video y telemetría" },
];

const ROLE_LABELS: Record<string, string> = {
  admin: "administrador",
  operator: "operador",
  viewer: "observador",
};

const ROLE_TONE: Record<string, Tone> = {
  owner: "accent",
  admin: "accent",
  operator: "ok",
  viewer: "neutral",
};

const MESSAGES: Record<string, string> = {
  ok: "Cambios guardados.",
  added: "Integrante añadido.",
  removed: "Integrante retirado.",
  approved: "Solicitud aprobada.",
  rejected: "Solicitud rechazada.",
  denied: "Operación rechazada: permisos insuficientes.",
  err: "Solicitud inválida.",
  nouser:
    "No existe un usuario con ese correo (debe iniciar sesión al menos una vez).",
  dup: "Ese usuario ya es integrante del laboratorio.",
};

interface Person {
  email: string;
  name: string | null;
}

export function UsersManager({
  projectId,
  owner,
  members,
  requests,
}: {
  projectId: string;
  owner: { email: string | null; name: string | null };
  members: (Person & { userId: string; role: string })[];
  requests: (Person & { id: string; requestedRole: string; note: string | null })[];
}) {
  const [result, formAction, pending] = useActionState(manageTeamAction, IDLE);

  return (
    <div className="flex flex-col gap-5">
      {result ? (
        <Banner role="status" tone={result.ok ? "ok" : "danger"}>
          {MESSAGES[result.code] ?? MESSAGES.err}
        </Banner>
      ) : null}

      {/* Pending requests first — somebody is waiting on them. */}
      {requests.length > 0 ? (
        <section className="rounded-xl border border-accent bg-accent/5 p-4">
          <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
            Solicitudes pendientes ({requests.length})
          </h2>
          <ul className="list-none space-y-2">
            {requests.map((request) => (
              <li
                key={request.id}
                className="flex flex-col gap-2 border-b border-line pb-2 last:border-0 last:pb-0 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-ink">
                    {request.name || request.email}
                  </p>
                  <p className="truncate font-mono text-[10px] text-ink3">
                    pide ser{" "}
                    {ROLE_LABELS[request.requestedRole] ?? request.requestedRole}
                    {request.note ? ` · ${request.note}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <form action={formAction}>
                    <input type="hidden" name="intent" value="approve" />
                    <input type="hidden" name="request_id" value={request.id} />
                    <Button type="submit" variant="ok" size="sm" disabled={pending}>
                      Aprobar
                    </Button>
                  </form>
                  <form action={formAction}>
                    <input type="hidden" name="intent" value="reject" />
                    <input type="hidden" name="request_id" value={request.id} />
                    <Button
                      type="submit"
                      variant="danger"
                      size="sm"
                      disabled={pending}
                    >
                      Rechazar
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Add someone — the most frequent action, so it comes first. */}
      <form
        action={formAction}
        className="rounded-xl border border-line bg-card p-4"
      >
        <input type="hidden" name="intent" value="add" />
        <input type="hidden" name="project_id" value={projectId} />
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
          Añadir integrante
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field
            label="Correo institucional"
            htmlFor="new-email"
            className="flex-1"
          >
            <input
              id="new-email"
              name="email"
              type="email"
              required
              placeholder="usuario@unal.edu.co"
              className={inputClass}
            />
          </Field>
          <Field label="Rol" htmlFor="new-role" className="sm:w-44">
            <select
              id="new-role"
              name="role"
              defaultValue="viewer"
              className={inputClass}
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </Field>
          <Button
            type="submit"
            variant="accent"
            disabled={pending}
            className="sm:shrink-0"
          >
            Añadir
          </Button>
        </div>
      </form>

      {/* Owner, read-only: assigned from the hub. */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-bg2 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-bold text-ink">
            {owner.name ?? owner.email ?? "Sin asignar"}
          </p>
          <p className="truncate font-mono text-[11px] text-ink3">
            {owner.email ?? "Se asigna desde el hub"}
          </p>
        </div>
        <RoleTag tone="accent">Propietario</RoleTag>
      </div>

      {members.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center font-mono text-[12px] text-ink3">
          Todavía no hay integrantes además del propietario.
        </p>
      ) : (
        <ul className="list-none space-y-2">
          {members.map((member) => (
            <li
              key={member.userId}
              className="rounded-xl border border-line bg-card p-4"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-bold text-ink">
                    {member.name ?? member.email}
                  </p>
                  <p className="truncate font-mono text-[11px] text-ink3">
                    {member.email}
                  </p>
                </div>
                <RoleTag tone={ROLE_TONE[member.role] ?? "neutral"}>
                  {ROLE_OPTIONS.find((r) => r.value === member.role)?.label ??
                    member.role}
                </RoleTag>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <form
                  action={formAction}
                  className="flex min-w-0 flex-1 basis-56 items-center gap-2"
                >
                  <input type="hidden" name="intent" value="role" />
                  <input type="hidden" name="project_id" value={projectId} />
                  <input type="hidden" name="user_id" value={member.userId} />
                  <label className="sr-only" htmlFor={`role-${member.userId}`}>
                    Rol de {member.email}
                  </label>
                  <select
                    id={`role-${member.userId}`}
                    name="role"
                    defaultValue={member.role}
                    className={inputClass}
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="submit"
                    variant="quiet"
                    disabled={pending}
                    className="shrink-0"
                  >
                    Guardar
                  </Button>
                </form>
                <form action={formAction} className="shrink-0">
                  <input type="hidden" name="intent" value="remove" />
                  <input type="hidden" name="project_id" value={projectId} />
                  <input type="hidden" name="user_id" value={member.userId} />
                  <Button type="submit" variant="danger" disabled={pending}>
                    Quitar
                  </Button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <dl className="space-y-1.5 border-t border-line pt-4 font-mono text-[11px] text-ink3">
        {ROLE_OPTIONS.map((role) => (
          <div key={role.value} className="flex flex-wrap gap-x-2">
            <dt className="font-semibold text-ink2">{role.label}:</dt>
            <dd>{role.hint}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
