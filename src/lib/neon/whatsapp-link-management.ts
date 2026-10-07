import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { callStaffServerFn } from "./staff-server-fn";
import { linkPageInput } from "./whatsapp-link-management.types";

const page = createServerFn({ method: "GET" })
  .inputValidator(linkPageInput)
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    return (await import("./whatsapp-link-management.server")).listWhatsappTrackingLinksPage(
      data,
      await requireStaffAccess(getRequest(), ["admin", "manager"]),
    );
  });
export const getWhatsappTrackingLinksPage = async (data: Parameters<typeof page>[0]["data"]) =>
  callStaffServerFn(page, { data });
