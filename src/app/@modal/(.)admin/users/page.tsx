import { Suspense } from "react";
import { Modal, ModalSkeleton } from "@/components/modal";
import { getLabContext } from "@/lib/lab";
import { UsersPanel } from "@/app/admin/users/panel";

// Intercepts /admin/users from inside the app. Managing who may drive is
// something an admin does *while* watching the lab, often because of what they
// are watching — so it opens over the session rather than replacing it.
export default async function InterceptedUsers() {
  const ctx = await getLabContext();

  return (
    <Modal
      title="Equipo del laboratorio"
      subtitle={`${ctx.lab?.name ?? "Dobot CR3"} — quién opera y quién observa`}
    >
      <Suspense fallback={<ModalSkeleton />}>
        <UsersPanel />
      </Suspense>
    </Modal>
  );
}
