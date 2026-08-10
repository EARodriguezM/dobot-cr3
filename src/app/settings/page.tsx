import { AdminPage } from "@/components/admin-page";
import { getControlUrl, getLabSlug } from "@/lib/lab";
import { SettingsPanel } from "./panel";

// Reached directly rather than from the console — a bookmark, a refresh, or a
// link shared with somebody. From inside the app the same panel is intercepted
// into a modal over the running session; see app/@modal.
export default function SettingsPage() {
  return (
    <AdminPage
      title="Ajustes del laboratorio"
      subtitle={`${getLabSlug()} · ${getControlUrl() ?? "sin backend configurado"}`}
    >
      <SettingsPanel />
    </AdminPage>
  );
}
