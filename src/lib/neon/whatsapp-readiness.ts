import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { withStaffAuthHeaders } from "@/auth";

const staff = createServerFn({ method: "GET" })
  .inputValidator(z.object({ staffId: z.string().uuid().optional() }).strict())
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
    return (await import("./whatsapp-readiness.server")).listWhatsappStaffReadiness(actor, data);
  });

const runtime = createServerFn({ method: "GET" }).handler(async () => {
  const { requireStaffAccess } = await import("./auth.server");
  const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
  return (await import("./whatsapp-readiness.server")).readWhatsappRuntimeStatus(actor);
});

export async function getWhatsappStaffReadiness(data: { staffId?: string } = {}) {
  return staff(await withStaffAuthHeaders({ data }));
}
export async function getWhatsappRuntimeStatus() {
  return runtime(await withStaffAuthHeaders({}));
}
