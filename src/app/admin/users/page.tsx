import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLabContext } from "@/lib/lab";
import {
  addMemberAction,
  removeMemberAction,
  setMemberRoleAction,
} from "./actions";

const ROLE_OPTIONS = [
  { value: "admin", label: "Administrador", hint: "Configura el laboratorio y gestiona el equipo" },
  { value: "operator", label: "Operador", hint: "Puede tomar el control del hardware" },
  { value: "viewer", label: "Observador", hint: "Solo ve video y telemetría" },
];

const ROLE_STYLE: Record<string, string> = {
  owner: "bg-accent/15 text-accent",
  admin: "bg-blue/15 text-blue",
  operator: "bg-ok/15 text-ok",
  viewer: "bg-bg2 text-ink3",
};

const MESSAGES: Record<string, { text: string; ok: boolean }> = {
  ok: { text: "Cambios guardados.", ok: true },
  denied: { text: "Operación rechazada: permisos insuficientes.", ok: false },
  err: { text: "Solicitud inválida.", ok: false },
  nouser: {
    text: "No existe un usuario con ese correo (debe iniciar sesión al menos una vez).",
    ok: false,
  },
  dup: { text: "Ese usuario ya es integrante del laboratorio.", ok: false },
};

const control =
  "w-full min-w-0 border border-line bg-bg px-3 py-2 font-mono text-[13px] text-ink focus:border-accent focus:outline-none";

// Roles for THIS lab only. The hub decides who owns the lab; everything else
// is decided here, by the owner and the admins.
//
// One card per person, stacking cleanly on a phone: identity on top, the role
// control below. No table — a table with selects inside is what made this
// unusable on small screens.
export default async function LabUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const [{ m }, ctx] = await Promise.all([searchParams, getLabContext()]);
  if (!ctx.configured || !ctx.user) redirect("/");
  if (!ctx.canAdmin || !ctx.projectId) redirect("/");
  // Bind after the guard: property narrowing is lost inside the callbacks below.
  const projectId = ctx.projectId;

  const supabase = await createClient();
  const [{ data: members }, { data: owner }] = await Promise.all([
    supabase!
      .from("project_members")
      .select(
        "user_id, role, profiles!project_members_user_id_fkey (email, full_name)",
      )
      .eq("project_id", projectId),
    supabase!
      .from("projects")
      .select("profiles!projects_owner_id_fkey (email, full_name)")
      .eq("id", projectId)
      .maybeSingle(),
  ]);

  const banner = m ? MESSAGES[m] : undefined;
  const roster = (members ?? []).sort((a, b) =>
    (a.profiles?.email ?? "").localeCompare(b.profiles?.email ?? ""),
  );

  return (
    <div className="mx-auto w-full max-w-2xl p-4 md:p-8">
      <Link
        href="/"
        className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink3 hover:text-accent"
      >
        ← Volver al laboratorio
      </Link>
      <h1 className="mb-1 mt-4 font-head text-2xl font-extrabold tracking-tight text-ink">
        Equipo del laboratorio
      </h1>
      <p className="mb-6 font-mono text-[12px] leading-relaxed text-ink3">
        {ctx.lab?.name} — quién puede operar el hardware y quién solo observar.
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

      {/* add someone — first, because it is the most frequent action */}
      <form
        action={addMemberAction}
        className="mb-6 rounded-xl border border-line bg-card p-4"
      >
        <input type="hidden" name="project_id" value={projectId} />
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
          Añadir integrante
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
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
              className={control}
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:w-44">
            <label
              className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink3"
              htmlFor="new-role"
            >
              Rol
            </label>
            <select id="new-role" name="role" defaultValue="viewer" className={control}>
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="border-[1.5px] border-accent px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-accent transition hover:bg-accent hover:text-white sm:shrink-0"
          >
            Añadir
          </button>
        </div>
      </form>

      {/* owner, read-only: assigned from the hub */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-bg2 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-bold text-ink">
            {owner?.profiles?.full_name ?? owner?.profiles?.email ?? "Sin asignar"}
          </p>
          <p className="truncate font-mono text-[11px] text-ink3">
            {owner?.profiles?.email ?? "Se asigna desde el hub"}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] ${ROLE_STYLE.owner}`}
        >
          Propietario
        </span>
      </div>

      {/* members */}
      {roster.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center font-mono text-[12px] text-ink3">
          Todavía no hay integrantes además del propietario.
        </p>
      ) : (
        <ul className="list-none space-y-2">
          {roster.map((member) => (
            <li
              key={member.user_id}
              className="rounded-xl border border-line bg-card p-4"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-bold text-ink">
                    {member.profiles?.full_name ?? member.profiles?.email}
                  </p>
                  <p className="truncate font-mono text-[11px] text-ink3">
                    {member.profiles?.email}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] ${
                    ROLE_STYLE[member.role] ?? ROLE_STYLE.viewer
                  }`}
                >
                  {ROLE_OPTIONS.find((r) => r.value === member.role)?.label ??
                    member.role}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <form
                  action={setMemberRoleAction}
                  className="flex min-w-0 flex-1 basis-56 items-center gap-2"
                >
                  <input type="hidden" name="project_id" value={projectId} />
                  <input type="hidden" name="user_id" value={member.user_id} />
                  <label className="sr-only" htmlFor={`role-${member.user_id}`}>
                    Rol de {member.profiles?.email}
                  </label>
                  <select
                    id={`role-${member.user_id}`}
                    name="role"
                    defaultValue={member.role}
                    className={control}
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="shrink-0 border border-line px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink2 transition hover:border-accent hover:text-accent"
                  >
                    Guardar
                  </button>
                </form>
                <form action={removeMemberAction} className="shrink-0">
                  <input type="hidden" name="project_id" value={projectId} />
                  <input type="hidden" name="user_id" value={member.user_id} />
                  <button
                    type="submit"
                    className="border border-line px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink2 transition hover:border-danger hover:text-danger"
                  >
                    Quitar
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <dl className="mt-6 space-y-1.5 border-t border-line pt-4 font-mono text-[11px] text-ink3">
        {ROLE_OPTIONS.map((r) => (
          <div key={r.value} className="flex flex-wrap gap-x-2">
            <dt className="font-semibold text-ink2">{r.label}:</dt>
            <dd>{r.hint}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
