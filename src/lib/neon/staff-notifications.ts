import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { callStaffServerFn } from "./staff-server-fn";
const action = z
  .object({
    notificationId: z.string().uuid(),
    expectedAssignmentVersion: z.number().int().nonnegative(),
  })
  .strict();
const list = createServerFn({ method: "GET" })
  .inputValidator(
    z
      .object({
        cursor: z.string().max(300).nullable().optional(),
        status: z
          .enum(["all", "pending", "acknowledged", "resolved", "superseded", "cancelled"])
          .default("pending"),
        limit: z.number().int().min(1).max(50).default(20),
      })
      .strict(),
  )
  .handler(async ({ data }) => {
    return (await import("./staff-notification-handlers.server")).handleStaffNotificationRequest(
      getRequest(),
      "list",
      data,
    );
  });
const ack = createServerFn({ method: "POST" })
  .inputValidator(action)
  .handler(async ({ data }) => {
    return (await import("./staff-notification-handlers.server")).handleStaffNotificationRequest(
      getRequest(),
      "ack",
      data,
    );
  });
const help = createServerFn({ method: "POST" })
  .inputValidator(action.extend({ reason: z.string().trim().min(1).max(500) }).strict())
  .handler(async ({ data }) => {
    return (await import("./staff-notification-handlers.server")).handleStaffNotificationRequest(
      getRequest(),
      "help",
      data,
    );
  });
export const fetchMyStaffNotifications = async (data: Parameters<typeof list>[0]["data"]) =>
  callStaffServerFn(list, { data });
export const confirmStaffNotification = async (data: z.infer<typeof action>) =>
  callStaffServerFn(ack, { data });
export const askStaffNotificationHelp = async (data: z.infer<typeof action> & { reason: string }) =>
  callStaffServerFn(help, { data });
