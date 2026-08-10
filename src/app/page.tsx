import Link from "next/link";
import { LabClosed } from "@/components/lab-closed";
import { Banner } from "@/components/ui";
import { requestPromotionAction } from "./admin/users/requests";
import { DEFAULT_LAYOUT, type WallLayout } from "@/lib/camera-layout";
import { LabConsole } from "@/components/lab-console";
import { getControlUrl, getLabContext, getLabSlug } from "@/lib/lab";
import {
  loadCameraLayout,
  loadPrograms,
  saveCameraLayout,
  savePrograms,
  type Program,
} from "@/lib/lab-settings";

const ROLE_LABEL: Record<string, string> = {
  owner: "Propietario",
  admin: "Administrador",
  operator: "Operador",
  viewer: "Observador",
};

export default async function LabPage() {
  const ctx = await getLabContext();

  // A lab that is unbuilt or under maintenance is closed to everyone except
  // the people who have to work on it — including to publish it.
  if (ctx.closure && !ctx.canEnter) {
    return <LabClosed closure={ctx.closure} labName={ctx.lab?.name ?? "Dobot CR3"} />;
  }

  // Shared state is loaded server-side so the first paint already has the
  // lab's programs and camera arrangement; both fall back to empty when
  // Supabase is unconfigured, which is what keeps the demo mode working.
  const [programs, layout] = await Promise.all([
    loadPrograms().catch((): Program[] => []),
    loadCameraLayout(DEFAULT_LAYOUT).catch((): WallLayout => DEFAULT_LAYOUT),
  ]);

  return (
    <>
      {ctx.closure ? (
        <Banner tone="warn" className="rounded-none border-x-0 border-t-0 py-2">
          {ctx.closure === "maintenance"
            ? "En mantenimiento — solo el equipo del laboratorio puede entrar."
            : "Sin publicar — solo el equipo del laboratorio puede entrar."}{" "}
          {/* A Link so it opens over the console rather than replacing it. */}
          <Link href="/settings" className="underline">
            Cambiar en Ajustes
          </Link>
        </Banner>
      ) : null}
      {ctx.configured && !ctx.lab ? (
        <Banner tone="warn" className="rounded-none border-x-0 border-t-0 py-2">
          Este laboratorio ({getLabSlug()}) aún no está registrado en la
          plataforma; funcionando en modo demostración.
        </Banner>
      ) : null}

      <LabConsole
        controlUrl={getControlUrl()}
        labName={ctx.lab?.name ?? "Dobot CR3"}
        userId={ctx.user?.id ?? (ctx.configured ? null : "demo")}
        userName={ctx.user?.name ?? null}
        roleLabel={ctx.role ? ROLE_LABEL[ctx.role] : null}
        // With Supabase unconfigured there is no session and no hardware
        // either, so the demo runs with operator affordances against the mock.
        canOperate={ctx.configured ? ctx.canOperate : true}
        canAdmin={ctx.configured ? ctx.canAdmin : true}
        configured={ctx.configured}
        initialPrograms={programs}
        initialLayout={layout}
        savePrograms={savePrograms}
        saveLayout={saveCameraLayout}
        requestPromotion={
          ctx.configured && ctx.role === "viewer" ? requestPromotionAction : undefined
        }
      />
    </>
  );
}
