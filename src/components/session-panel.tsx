"use client";

import { memo } from "react";
import type { ControlState, ControlUser } from "@/lib/control/store";

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
  onRequestPromotion?: () => Promise<void>;
  onRequestHandover: () => void;
  onRespondToHandover: (userId: string, accept: boolean) => void;
  handoverRequests: ControlUser[];
  awaitingHandover: boolean;
}) {
  const holder = state?.holder ?? null;
  const someoneElseDriving = holder != null && holder.id !== userId;
  const presence = state?.presence ?? [];

  return (
    <section className="rounded-xl border border-line bg-card p-4">
      <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
        Control
      </h2>

      <p
        className={`mb-3 border-l-2 py-1 pl-2.5 font-mono text-[11px] leading-relaxed ${
          iAmHolder
            ? "border-accent2 text-ink2"
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
                    <button
                      type="button"
                      onClick={() => onRespondToHandover(person.id, true)}
                      className="border border-ok px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-ok transition hover:bg-ok hover:text-bg"
                    >
                      Ceder
                    </button>
                    <button
                      type="button"
                      onClick={() => onRespondToHandover(person.id, false)}
                      className="border border-line px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-ink3 transition hover:border-danger hover:text-danger"
                    >
                      No
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {iAmHolder ? (
            <button
              type="button"
              onClick={onRelease}
              className="border-[1.5px] border-line px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-ink2 transition hover:border-ink hover:bg-ink hover:text-bg"
            >
              Liberar control
            </button>
          ) : (
            <button
              type="button"
              onClick={onTake}
              disabled={waiting && queuePosition >= 0}
              className="border-[1.5px] border-accent px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-accent transition hover:bg-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {waiting && queuePosition >= 0 ? "En cola…" : "Tomar control"}
            </button>
          )}

          {someoneElseDriving ? (
            <button
              type="button"
              onClick={onRequestHandover}
              disabled={awaitingHandover}
              className="border-[1.5px] border-line px-4 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink2 transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {awaitingHandover ? "Esperando respuesta…" : "Pedir el control"}
            </button>
          ) : null}

          {someoneElseDriving && canAdmin ? (
            <button
              type="button"
              onClick={onForce}
              className="border border-warn px-4 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-warn transition hover:bg-warn hover:text-bg"
            >
              Forzar control
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[11px] leading-relaxed text-ink3">
            Rol de observador: ves el video, la telemetría y lo que hace el
            operador, pero no puedes mover el robot.
          </p>
          {onRequestPromotion ? (
            <form action={onRequestPromotion}>
              <button
                type="submit"
                className="w-full border-[1.5px] border-line px-4 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink2 transition hover:border-accent hover:text-accent"
              >
                Solicitar ser operador
              </button>
              <p className="mt-1.5 font-mono text-[9px] leading-relaxed text-ink3/80">
                Un administrador del laboratorio la aprueba o la rechaza.
              </p>
            </form>
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
              <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-accent">
                al mando
              </span>
            ) : null}
          </li>
        ))}
        {presence.length === 0 ? (
          <li className="py-1.5 font-mono text-[11px] text-ink3">
            Nadie más conectado.
          </li>
        ) : null}
      </ul>
    </section>
  );
});

export { ROLE_LABEL };
