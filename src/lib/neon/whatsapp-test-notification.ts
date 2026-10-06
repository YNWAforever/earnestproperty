import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { callStaffServerFn } from "./staff-server-fn";
import { z } from "zod";

const fields = z
  .object({
    staffId: z.string().uuid(),
    transport: z.enum(["inbox_private_note", "staff_whatsapp"]),
    endpointVersion: z.number().int().positive(),
  })
  .strict();
const preview = createServerFn({ method: "POST" })
  .inputValidator(fields)
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    return (await import("./whatsapp-test-notification.server")).previewStaffTestNotification(
      data,
      await requireStaffAccess(getRequest(), ["admin", "manager"]),
    );
  });
const submit = createServerFn({ method: "POST" })
  .inputValidator(
    fields.extend({ requestId: z.string().uuid(), previewToken: z.string().uuid() }).strict(),
  )
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    return (await import("./whatsapp-test-notification.server")).enqueueStaffTestNotification(
      data,
      await requireStaffAccess(getRequest(), ["admin", "manager"]),
    );
  });
const read = createServerFn({ method: "GET" })
  .inputValidator(z.object({ attemptId: z.string().uuid() }).strict())
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    return (await import("./whatsapp-test-notification.server")).readStaffTestNotification(
      data.attemptId,
      await requireStaffAccess(getRequest(), ["admin", "manager"]),
    );
  });
export const previewStaffTestNotification = async (
  data: z.infer<typeof fields>,
  isWorkspaceCurrent?: () => boolean,
) => callStaffServerFn(preview, { data }, isWorkspaceCurrent);
export const enqueueStaffTestNotification = async (
  data: z.infer<typeof fields> & { requestId: string; previewToken: string },
  isWorkspaceCurrent?: () => boolean,
) => callStaffServerFn(submit, { data }, isWorkspaceCurrent);
export const getStaffTestNotification = async (
  attemptId: string,
  isWorkspaceCurrent?: () => boolean,
) => callStaffServerFn(read, { data: { attemptId } }, isWorkspaceCurrent);

const manualConfirmation = createServerFn({ method: "POST" })
  .inputValidator(
    z
      .object({
        attemptId: z.string().uuid(),
        evidenceRef: z.string().trim().min(1).max(160),
      })
      .strict(),
  )
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    return (await import("./whatsapp-test-notification.server")).recordStaffTestManualConfirmation(
      data,
      await requireStaffAccess(getRequest(), ["admin", "manager"]),
    );
  });
export const confirmStaffTestReceipt = async (
  data: { attemptId: string; evidenceRef: string },
  isWorkspaceCurrent?: () => boolean,
) => callStaffServerFn(manualConfirmation, { data }, isWorkspaceCurrent);

const readByRequest = createServerFn({ method: "GET" })
  .inputValidator(z.object({ requestId: z.string().uuid() }).strict())
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    return (await import("./whatsapp-test-notification.server")).readStaffTestNotificationByRequest(
      data.requestId,
      await requireStaffAccess(getRequest(), ["admin", "manager"]),
    );
  });
export const findStaffTestNotificationByRequest = async (
  requestId: string,
  isWorkspaceCurrent?: () => boolean,
) => callStaffServerFn(readByRequest, { data: { requestId } }, isWorkspaceCurrent);
