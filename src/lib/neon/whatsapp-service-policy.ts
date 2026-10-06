import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { callStaffServerFn } from "./staff-server-fn";
import type { ServiceRules } from "../whatsapp-enquiries/service-policy";
const list = createServerFn({ method: "GET" }).handler(async () => {
  const { requireStaffAccess } = await import("./auth.server");
  const a = await requireStaffAccess(getRequest(), ["admin", "manager"]);
  return (await import("../whatsapp-enquiries/policy-admin.server")).listServicePolicies(a);
});
const save = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { rules: ServiceRules; afterHoursCopy: string | null; copyVersion: string | null }) =>
      data,
  )
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    const a = await requireStaffAccess(getRequest(), ["admin", "manager"]);
    return (await import("../whatsapp-enquiries/policy-admin.server")).saveServicePolicyDraft(
      data,
      a,
    );
  });
const approve = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { id: string; version: number; effectiveAt: string; decisionEvidenceRef: string }) =>
      data,
  )
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    const a = await requireStaffAccess(getRequest(), ["admin", "manager"]);
    return (await import("../whatsapp-enquiries/policy-admin.server")).approveServicePolicy(
      data,
      a,
    );
  });
export async function getWhatsappServicePolicies(isWorkspaceCurrent?: () => boolean) {
  return callStaffServerFn(list, {}, isWorkspaceCurrent);
}
export async function saveWhatsappServicePolicy(
  data: Parameters<typeof save>[0]["data"],
  isWorkspaceCurrent?: () => boolean,
) {
  return callStaffServerFn(save, { data }, isWorkspaceCurrent);
}
export async function approveWhatsappServicePolicy(
  data: Parameters<typeof approve>[0]["data"],
  isWorkspaceCurrent?: () => boolean,
) {
  return callStaffServerFn(approve, { data }, isWorkspaceCurrent);
}
