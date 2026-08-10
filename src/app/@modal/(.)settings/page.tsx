import { Suspense } from "react";
import { Modal, ModalSkeleton } from "@/components/modal";
import { getControlUrl, getLabSlug } from "@/lib/lab";
import { SettingsPanel } from "@/app/settings/panel";

// Intercepts /settings when it is reached from inside the app: the console
// keeps running underneath, and the URL is still /settings, so a refresh or a
// shared link lands on the standalone page instead.
export default function InterceptedSettings() {
  return (
    <Modal
      title="Ajustes del laboratorio"
      subtitle={`${getLabSlug()} · ${getControlUrl() ?? "sin backend configurado"}`}
    >
      <Suspense fallback={<ModalSkeleton />}>
        <SettingsPanel />
      </Suspense>
    </Modal>
  );
}
