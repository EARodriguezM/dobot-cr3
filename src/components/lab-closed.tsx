import Link from "next/link";
import type { LabClosure } from "@/lib/lab";
import { buttonClass } from "./ui";

// What an ordinary user sees when the lab is not open to them.
//
// A closed lab is a normal state, not an error: a lab that has not been built
// yet and a lab whose hardware is being worked on are both things the seedbed
// does on purpose. So this reads as a status page rather than a refusal, and
// it says which of the two it is — "not built yet" and "temporarily down" call
// for very different reactions from someone waiting to use it.

const COPY: Record<Exclude<LabClosure, null>, { title: string; body: string }> = {
  development: {
    title: "En construcción",
    body:
      "Este laboratorio todavía se está construyendo. Cuando el equipo lo " +
      "publique, aparecerá aquí sin que tengas que hacer nada.",
  },
  maintenance: {
    title: "En mantenimiento",
    body:
      "El laboratorio existe y funciona, pero está fuera de servicio " +
      "mientras se trabaja en el hardware. Vuelve a intentarlo más tarde.",
  },
};

export function LabClosed({
  closure,
  labName,
}: {
  closure: Exclude<LabClosure, null>;
  labName: string;
}) {
  const { title, body } = COPY[closure];

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-16 text-center">
      <span
        aria-hidden
        className={`mb-5 h-2.5 w-2.5 rounded-full ${
          closure === "maintenance" ? "bg-warn" : "bg-ink3"
        }`}
      />
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink3">
        {labName}
      </p>
      <h1 className="mt-2 font-head text-3xl font-extrabold tracking-tight text-ink">
        {title}
      </h1>
      <p className="mt-3 max-w-md text-[15px] leading-relaxed text-ink2">
        {body}
      </p>
      <Link
        href="https://primbiolab.org/dashboard"
        className={buttonClass({ variant: "quiet", size: "lg", className: "mt-8" })}
      >
        Volver al panel
      </Link>
    </main>
  );
}
