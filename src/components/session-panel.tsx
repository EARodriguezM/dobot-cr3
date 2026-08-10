"use client";

import { memo, useActionState } from "react";
import type { ControlState, ControlUser } from "@/lib/control/store";
import { IDLE, type ActionResult } from "@/lib/action-result";
import { Button, Panel, RoleTag } from "./ui";

// Who is here and who is driving.
//
// The control lease is invisible by nature — it lives in Redis — so this panel
// is the only thing that tells a room of people why their buttons are disabled
// and whose turn it is. It answers three questions at a glance: who holds the
// hardware, who is waiting, and who else is watching.

const ROLE_LABEL: Record<string, string> = {
  owner: "Propietario",
  admin: "Administrador",
  operator: "Operador",
  viewer: "Observador",
};

export const SessionPanel = memo(function SessionPanel({
  state,
  userId,
  canOperate,
  canAdmin,
  iAmHolder,
  queuePosition,
  waiting,
  onTake,
  onForce,
  onRelease,
  onRequestPromotion,
  onRequestHandover,
  onRespondToHandover,
  handoverRequests,
  awaitingHandover,
}: {
  state: ControlState | null;
  userId: string | null;
  canOperate: boolean;
  canAdmin: boolean;
  iAmHolder: boolean;
  queuePosition: number;
  waiting: boolean;
  onTake: () => void;
  onForce: () => void;
  onRelease: () => void;
  /** Server action; absent when there is nothing to ask for. */
  onRequestPromotion?: (previous: ActionResult | null) => Promise<ActionResult>;
  onRequestHandover: () => void;
  onRespondToHandover: (userId: string, accept: boolean) => void;
  handoverRequests: ControlUser[];
  awaitingHandover: boolean;
}) {
  const holder = state?.holder ?? null;
  const someoneElseDriving = holder != null && holder.id !== userId;
  const presence = state?.presence ?? [];

  return (
    <Panel title="Control">
      <p
        className={`mb-3 border-l-2 py-1 pl-2.5 font-mono text-[11px] leading-relaxed ${
          iAmHolder
            ? "border-ok text-ink2"
            : someoneElseDriving
              ? "border-warn text-ink2"
              : "border-line text-ink3"
        }`}
      >
        {iAmHolder ? (
          <>Tienes el control del hardware.</>
        ) : someoneElseDriving ? (
          <>
            <span className="font-semibold text-ink">{holder.name}</span> está
            operando el robot.
          </>
        ) : (
          <>Nadie tiene el control.</>
        )}
        {queuePosition >= 0 ? (
          <>
            <br />
            Estás en la cola: turno #{queuePosition + 1}.
          </>
        ) : null}
      </p>

      {canOperate ? (
        <div className="flex flex-col gap-2">
          {iAmHolder && handoverRequests.length > 0 ? (
            <div className="mb-1 rounded-md border border-accent bg-accent/10 p-2.5">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-accent">
                Piden el control
              </p>
              <ul className="list-none space-y-1.5">
                {handoverRequests.map((person) => (
                  <li key={person.id} className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                      {person.name}
                    </span>
                    <Button
                      variant="ok"
                      size="sm"
                      onClick={() => onRespondToHandover(person.id, true)}
                    >
                      Ceder
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => onRespondToHandover(person.id, false)}
                    >
                      No
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {iAmHolder ? (
            <Button variant="neutral" block onClick={onRelease}>
              Liberar control
            </Button>
          ) : (
            <Button
              variant="accent"
              block
              onClick={onTake}
              disabled={waiting && queuePosition >= 0}
            >
              {waiting && queuePosition >= 0 ? "En cola…" : "Tomar control"}
            </Button>
          )}

          {someoneElseDriving ? (
            <Button
              variant="quiet"
              size="sm"
              block
              onClick={onRequestHandover}
              disabled={awaitingHandover}
            >
              {awaitingHandover ? "Esperando respuesta…" : "Pedir el control"}
            </Button>
          ) : null}

          {someoneElseDriving && canAdmin ? (
            <Button variant="warn" size="sm" block onClick={onForce}>
              Forzar control
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[11px] leading-relaxed text-ink3">
            Rol de observador: ves el video, la telemetría y lo que hace el
            operador, pero no puedes mover el robot.
          </p>
          {onRequestPromotion ? (
            <PromotionRequest action={onRequestPromotion} />
          ) : null}
        </div>
      )}

      <h3 className="mb-2 mt-5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
        <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-ok" />
        Conectados ({presence.length})
      </h3>
      <ul className="list-none">
        {presence.map((person) => (
          <li
            key={person.id}
            className="flex items-center justify-between gap-2 border-b border-line py-1.5 text-[13px] last:border-0"
          >
            <span className="truncate">
              {person.name}
              {person.id === userId ? (
                <span className="text-ink3"> (tú)</span>
              ) : null}
            </span>
            {holder?.id === person.id ? (
              <RoleTag tone="accent">al mando</RoleTag>
            ) : null}
          </li>
        ))}
        {presence.length === 0 ? (
          <li className="py-1.5 font-mono text-[11px] text-ink3">
            Nadie más conectado.
          </li>
        ) : null}
      </ul>
    </Panel>
  );
});

// A viewer asking to be promoted. The answer arrives here, in the panel they
// asked from: this used to redirect to the admin roster, which a viewer is not
// allowed to open, so the request appeared to do nothing at all.
function PromotionRequest({
  action,
}: {
  action: (previous: ActionResult | null) => Promise<ActionResult>;
}) {
  const [result, formAction, pending] = useActionState(action, IDLE);

  if (result?.ok) {
    return (
      <p
        role="status"
        className="rounded-md border border-ok bg-ok/10 px-3 py-2 font-mono text-[10px] leading-relaxed text-ok"
      >
        Solicitud enviada. Un administrador del laboratorio la revisará.
      </p>
    );
  }

  return (
    <form action={formAction}>
      <Button type="submit" variant="quiet" size="sm" block disabled={pending}>
        {pending ? "Enviando…" : "Solicitar ser operador"}
      </Button>
      <p
        className={`mt-1.5 font-mono text-[9px] leading-relaxed ${
          result ? "text-danger" : "text-ink3/80"
        }`}
      >
        {result
          ? "No se pudo enviar la solicitud. Inténtalo de nuevo."
          : "Un administrador del laboratorio la aprueba o la rechaza."}
      </p>
    </form>
  );
}

export { ROLE_LABEL };
