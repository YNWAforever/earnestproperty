import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { callStaffServerFn } from "./staff-server-fn";
const settings = createServerFn({ method: "GET" }).handler(async () => {
  const { requireStaffAccess } = await import("./auth.server");
  return (await import("./enquiry-forwarding.server")).getEnquiryForwardingSettings(
    await requireStaffAccess(getRequest(), ["admin", "manager"]),
  );
});
const enabled = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ enabled: z.boolean(), expectedCopyVersion: z.number().int().positive() }).strict(),
  )
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    return (await import("./enquiry-forwarding.server")).setEnquiryForwardingEnabled(
      data,
      await requireStaffAccess(getRequest(), ["admin", "manager"]),
    );
  });
const check = createServerFn({ method: "POST" }).handler(async () => {
  const { requireStaffAccess } = await import("./auth.server");
  return (await import("./enquiry-forwarding.server")).queueEnquiryForwardingCheck(
    await requireStaffAccess(getRequest(), ["admin", "manager"]),
  );
});
export const fetchEnquiryForwardingSettings = (isCurrent?: () => boolean) =>
  callStaffServerFn(settings, {}, isCurrent);
export const updateEnquiryForwardingEnabled = (
  data: Parameters<typeof enabled>[0]["data"],
  isCurrent?: () => boolean,
) => callStaffServerFn(enabled, { data }, isCurrent);
export const requestEnquiryForwardingCheck = (isCurrent?: () => boolean) =>
  callStaffServerFn(check, {}, isCurrent);
