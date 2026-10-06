import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { callStaffServerFn } from "../neon/staff-server-fn";
import { z } from "zod";
import { exportInput } from "./whatsapp-link-export";

const prepare = createServerFn({ method: "POST" })
  .inputValidator(exportInput)
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("../neon/auth.server");
    return (await import("./whatsapp-link-export.server")).prepareWhatsappLinkExport(
      data,
      await requireStaffAccess(getRequest(), ["admin", "manager"]),
    );
  });
const page = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({ snapshotId: z.string().uuid(), offset: z.number().int().min(0) }).strict(),
  )
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("../neon/auth.server");
    return (await import("./whatsapp-link-export.server")).readWhatsappLinkExportPage(
      data,
      await requireStaffAccess(getRequest(), ["admin", "manager"]),
    );
  });
export const prepareWhatsappLinkExport = async (data: z.infer<typeof exportInput>) =>
  callStaffServerFn(prepare, { data });
export const getWhatsappLinkExportPage = async (data: { snapshotId: string; offset: number }) =>
  callStaffServerFn(page, { data });
