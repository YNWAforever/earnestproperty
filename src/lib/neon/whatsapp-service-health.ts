import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { withStaffAuthHeaders } from "@/auth";
const get = createServerFn({ method: "GET" }).handler(async () => {
  const { requireStaffAccess } = await import("./auth.server");
  const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
  return (await import("../whatsapp-enquiries/service-health.server")).getServiceHealth(actor);
});
export async function fetchWhatsappServiceHealth() {
  return get(await withStaffAuthHeaders({}));
}
