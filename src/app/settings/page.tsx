import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getControlUrl, getLabContext, getLabSlug } from "@/lib/lab";
import { updateLabAction } from "./actions";

const MESSAGES: Record<string, { text: string; ok: boolean }> = {
  ok: { text: "Cambios guardados.", ok: true },
  denied: { text: "Operación rechazada: permisos insuficientes.", ok: false },
  err: { text: "Solicitud inválida.", ok: false },
};

const control =
  "w-full min-w-0 border border-line bg-bg px-3 py-2 font-mono text-[13px] text-ink focus:border-accent focus:outline-none";

// What is configurable from the web, and what deliberately is not.
//
// The lab's identity and service state live in the platform database and are
// editable here. Hardware configuration — robot IP, ports, gripper travel,
// camera sources — does not: it belongs to the lab computer, where the ROS 2
// stack reads it at launch and go2rtc reads it from its own config. Putting a
// robot's IP address behind a browser form would mean a web session could
// point the driver at an arbitrary host.
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const [{ m }, ctx] = await Promise.all([searchParams, getLabContext()]);
  if (!ctx.configured || !ctx.user) redirect("/");
  if (!ctx.canAdmin) redirect("/");

  const supabase = await createClient();
  const { data: lab } = ctx.lab
    ? await supabase!
        .from("remote_labs")
        .select("name, description, in_maintenance, in_development, last_seen_at")
        .eq("id", ctx.lab.id)
        .maybeSingle()
    : { data: null };

  const message = m ? MESSAGES[m] : null;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 md:py-10">
      <Link
        href="/"
        className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink3 transition hover:text-accent"
      >
        ← Volver al control
      </Link>

      <h1 className="mt-4 font-head text-2xl font-extrabold tracking-tight text-ink">
        Ajustes del laboratorio
      </h1>
      <p className="mt-1 font-mono text-[11px] text-ink3">
        {getLabSlug()} · {getControlUrl() ?? "sin backend configurado"}
      </p>

      {message ? (
        <p
          className={`mt-4 border px-4 py-2.5 font-mono text-xs ${
            message.ok
              ? "border-ok bg-ok/10 text-ok"
              : "border-danger bg-danger/10 text-danger"
          }`}
        >
          {message.text}
        </p>
      ) : null}

      <form action={updateLabAction} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink3">
            Nombre
          </span>
          <input
            name="name"
            required
            defaultValue={lab?.name ?? ""}
            className={control}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink3">
            Descripción
          </span>
          <textarea
            name="description"
            rows={3}
            defaultValue={lab?.description ?? ""}
            className={control}
          />
        </label>

        <label className="flex items-start gap-2.5 border border-line bg-bg2 px-3 py-2.5">
          <input
            type="checkbox"
            name="in_maintenance"
            defaultChecked={lab?.in_maintenance ?? false}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span className="text-[13px] leading-snug text-ink2">
            En mantenimiento
            <span className="block font-mono text-[10px] text-ink3">
              El laboratorio aparece fuera de servicio en la plataforma. Es
              distinto de «sin conexión», que significa que dejó de reportarse.
            </span>
          </span>
        </label>

        <button
          type="submit"
          className="self-start border-[1.5px] border-accent px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-accent transition hover:bg-accent hover:text-white"
        >
          Guardar
        </button>
      </form>

      <section className="mt-10 border-t border-line pt-6">
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
        <p className="mt-2 font-mono text-[11px] leading-relaxed text-ink3">
          Estado del reporte:{" "}
          {lab?.last_seen_at
            ? `último latido ${new Date(lab.last_seen_at).toLocaleString("es-CO")}`
            : "este laboratorio nunca ha reportado actividad"}
          .
        </p>
      </section>
    </div>
  );
}
