import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLabContext } from "@/lib/lab";
import {
  addMemberAction,
  removeMemberAction,
  setMemberRoleAction,
} from "./actions";

const field =
  "border border-line bg-bg px-3 py-2 font-mono text-[13px] text-ink focus:border-accent focus:outline-none";

const ROLE_OPTIONS = [
  { value: "admin", label: "Administrador" },
  { value: "operator", label: "Operador" },
  { value: "viewer", label: "Observador" },
];

const MESSAGES: Record<string, { text: string; ok: boolean }> = {
  ok: { text: "Cambios guardados.", ok: true },
  denied: { text: "Operación rechazada: permisos insuficientes.", ok: false },
  err: { text: "Solicitud inválida.", ok: false },
  nouser: {
    text: "No existe un usuario con ese correo (debe iniciar sesión al menos una vez).",
    ok: false,
  },
  dup: { text: "Ese usuario ya es integrante del proyecto.", ok: false },
};

// Roster of THIS lab's project only — the hub manages every project, a lab
// manages just its own. Same RLS gates on the same tables.
export default async function LabUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const [{ m }, ctx] = await Promise.all([searchParams, getLabContext()]);
  if (!ctx.configured || !ctx.user) redirect("/");
  if (!ctx.canAdmin || !ctx.projectId) redirect("/");

  const supabase = await createClient();
  const { data: members } = await supabase!
    .from("project_members")
    .select(
      "user_id, role, profiles!project_members_user_id_fkey (email, full_name)",
    )
    .eq("project_id", ctx.projectId);

  const banner = m ? MESSAGES[m] : undefined;

  return (
    <div className="mx-auto w-full max-w-2xl p-4 md:p-8">
      <Link
        href="/"
        className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink3 hover:text-accent"
      >
        ← Volver al laboratorio
      </Link>
      <h1 className="mb-1 mt-4 font-head text-2xl font-extrabold tracking-tight text-ink">
        Usuarios del laboratorio
      </h1>
      <p className="mb-6 font-mono text-[12px] text-ink3">
        {ctx.lab?.name} — roles del proyecto asociado.
      </p>

      {banner ? (
        <p
          role="status"
          className={`mb-5 border px-3.5 py-2.5 font-mono text-xs ${
            banner.ok ? "border-ok text-ok" : "border-accent text-accent"
          }`}
        >
          {banner.text}
        </p>
      ) : null}

      <div className="rounded-xl border border-line bg-card p-5">
        {(members ?? [])
          .sort((a, b) =>
            (a.profiles?.email ?? "").localeCompare(b.profiles?.email ?? ""),
          )
          .map((member) => (
            <div
              key={member.user_id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-bold text-ink">
                  {member.profiles?.full_name ?? member.profiles?.email}
                </p>
                <p className="truncate font-mono text-[11px] text-ink3">
                  {member.profiles?.email}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <form action={setMemberRoleAction} className="flex items-center gap-2">
                  <input type="hidden" name="project_id" value={ctx.projectId!} />
                  <input type="hidden" name="user_id" value={member.user_id} />
                  <label className="sr-only" htmlFor={`role-${member.user_id}`}>
                    Rol de {member.profiles?.email}
                  </label>
                  <select
                    id={`role-${member.user_id}`}
                    name="role"
                    defaultValue={member.role}
                    className={field}
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="border border-line px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink2 transition hover:border-accent hover:text-accent"
                  >
                    Guardar
                  </button>
                </form>
                <form action={removeMemberAction}>
                  <input type="hidden" name="project_id" value={ctx.projectId!} />
                  <input type="hidden" name="user_id" value={member.user_id} />
                  <button
                    type="submit"
                    className="border border-line px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink2 transition hover:border-danger hover:text-danger"
                  >
                    Quitar
                  </button>
                </form>
              </div>
            </div>
          ))}

        <form action={addMemberAction} className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="project_id" value={ctx.projectId!} />
          <div className="flex min-w-0 flex-1 basis-52 flex-col gap-1.5">
            <label
              className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink3"
              htmlFor="new-email"
            >
              Correo institucional
            </label>
            <input
              id="new-email"
              name="email"
              type="email"
              required
              placeholder="usuario@unal.edu.co"
              className={`${field} w-full`}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink3"
              htmlFor="new-role"
            >
              Rol
            </label>
            <select id="new-role" name="role" defaultValue="viewer" className={field}>
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="border-[1.5px] border-accent px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-accent transition hover:bg-accent hover:text-white"
          >
            Añadir
          </button>
        </form>
      </div>
    </div>
  );
}
