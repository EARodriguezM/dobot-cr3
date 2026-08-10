import { AdminPage } from "@/components/admin-page";
import { getLabContext } from "@/lib/lab";
import { UsersPanel } from "./panel";

// Standalone presentation of the team roster; inside the app it is intercepted
// into a modal over the console. See app/@modal.
export default async function LabUsersPage() {
  const ctx = await getLabContext();

  return (
    <AdminPage
      title="Equipo del laboratorio"
      subtitle={`${ctx.lab?.name ?? "Dobot CR3"} — quién puede operar el hardware y quién solo observar.`}
    >
      <UsersPanel />
    </AdminPage>
  );
}
