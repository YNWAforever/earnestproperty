import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { callStaffServerFn } from "./staff-server-fn";
import { propertyGroupFiltersSchema } from "./admin-properties.types";

const snapshot = createServerFn({ method: "POST" })
  .inputValidator(propertyGroupFiltersSchema)
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
    return (await import("./whatsapp-link-selection.server")).snapshotLinkOffers(data, actor);
  });

export const snapshotWhatsappLinkOffers = async (filters: Parameters<typeof snapshot>[0]["data"]) =>
  callStaffServerFn(snapshot, { data: filters });
