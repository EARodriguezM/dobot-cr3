import Link from "next/link";
import { getControlUrl, getLabContext, getLabSlug } from "@/lib/lab";
import { LabConsole } from "@/components/lab-console";
import { ThemeToggle } from "@/components/theme-toggle";

const ROLE_LABEL: Record<string, string> = {
  owner: "Propietario",
  admin: "Administrador",
  operator: "Operador",
  viewer: "Observador",
};

export default async function LabPage() {
  const ctx = await getLabContext();
  const controlUrl = getControlUrl();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-line bg-[var(--nav-bg)] px-4 py-3 backdrop-blur-md md:px-6">
        <p className="font-head text-lg font-extrabold leading-none tracking-tight text-ink">
          PRIM<span className="text-accent">BIO</span>
          <span className="ml-2 font-mono text-[11px] font-normal tracking-[0.08em] text-ink3">
            {ctx.lab?.name ?? getLabSlug()}
          </span>
        </p>
        <div className="flex-1" />
        {ctx.role ? (
          <span className="rounded-full bg-bg2 px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-ink2">
            {ROLE_LABEL[ctx.role]}
          </span>
        ) : null}
        {ctx.canAdmin ? (
          <Link
            href="/admin/users"
            className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink3 transition hover:text-accent"
          >
            Usuarios
          </Link>
        ) : null}
        <ThemeToggle />
        {ctx.user ? (
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="border-[1.5px] border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink3 transition hover:border-accent hover:text-accent"
            >
              Salir
            </button>
          </form>
        ) : null}
      </header>

      <main className="flex-1 p-4 md:p-6">
        {ctx.configured && !ctx.lab ? (
          <p className="mb-4 border border-warn bg-warn/10 px-4 py-2.5 font-mono text-xs text-warn">
            Este laboratorio ({getLabSlug()}) aún no está registrado en la
            plataforma; funcionando en modo demostración.
          </p>
        ) : null}
        {ctx.configured && ctx.user && !ctx.role ? (
          <p className="mb-4 border border-line bg-bg2 px-4 py-2.5 font-mono text-xs text-ink3">
            No tienes un rol en este laboratorio. Pide a un administrador del
            proyecto que te agregue.
          </p>
        ) : null}
        <LabConsole
          controlUrl={controlUrl}
          canOperate={ctx.configured ? ctx.canOperate : true}
          userId={ctx.user?.id ?? (ctx.configured ? null : "demo")}
        />
      </main>
    </div>
  );
}
