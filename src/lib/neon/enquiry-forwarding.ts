import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { callStaffServerFn } from "./staff-server-fn";
import { enquiryPhoneReviewInput, enquiryHeldReplyInput } from "./enquiry-info-review.types";
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
const identityReview = createServerFn({ method: "GET" }).handler(async () => {
  const { requireStaffAccess } = await import("./auth.server");
  return (await import("./enquiry-info-review.server")).getEnquiryInfoReviewState(
    await requireStaffAccess(getRequest(), ["admin", "manager"]),
  );
});
const phoneReview = createServerFn({ method: "POST" })
  .inputValidator(enquiryPhoneReviewInput)
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    return (await import("./enquiry-info-review.server")).reviewEnquiryInfoPhone(
      data,
      await requireStaffAccess(getRequest(), ["admin", "manager"]),
    );
  });
const heldReply = createServerFn({ method: "POST" })
  .inputValidator(enquiryHeldReplyInput)
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    return (await import("./enquiry-info-review.server")).resolveEnquiryInfoReply(
      data,
      await requireStaffAccess(getRequest(), ["admin", "manager"]),
    );
  });
export const fetchEnquiryIdentityReview = (isCurrent?: () => boolean) =>
  callStaffServerFn(identityReview, {}, isCurrent);
export const reviewEnquiryPhonePurpose = (
  data: Parameters<typeof phoneReview>[0]["data"],
  isCurrent?: () => boolean,
) => callStaffServerFn(phoneReview, { data }, isCurrent);
export const resolveEnquiryHeldReply = (
  data: Parameters<typeof heldReply>[0]["data"],
  isCurrent?: () => boolean,
) => callStaffServerFn(heldReply, { data }, isCurrent);
export const fetchEnquiryForwardingSettings = (isCurrent?: () => boolean) =>
  callStaffServerFn(settings, {}, isCurrent);
export const updateEnquiryForwardingEnabled = (
  data: Parameters<typeof enabled>[0]["data"],
  isCurrent?: () => boolean,
) => callStaffServerFn(enabled, { data }, isCurrent);
export const requestEnquiryForwardingCheck = (isCurrent?: () => boolean) =>
  callStaffServerFn(check, {}, isCurrent);
