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

  // Shared state is loaded server-side so the first paint already has the
  // lab's programs and camera arrangement; both fall back to empty when
  // Supabase is unconfigured, which is what keeps the demo mode working.
  const [programs, layout] = await Promise.all([
    loadPrograms().catch((): Program[] => []),
    loadCameraLayout(DEFAULT_LAYOUT).catch((): WallLayout => DEFAULT_LAYOUT),
  ]);

  return (
    <>
      {ctx.configured && !ctx.lab ? (
        <p className="border-b border-warn bg-warn/10 px-4 py-2 font-mono text-xs text-warn">
          Este laboratorio ({getLabSlug()}) aún no está registrado en la
          plataforma; funcionando en modo demostración.
        </p>
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
      />
    </>
  );
}
