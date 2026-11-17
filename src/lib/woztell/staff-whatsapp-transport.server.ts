import "@tanstack/react-start/server-only";
import { sendWoztellResponse } from "./woztell.server.ts";
import { parseWoztellProviderResult } from "./provider-result.ts";
import { providerChannelId } from "../whatsapp-enquiries/wa-config.server.ts";
import { forwardingPhone } from "../whatsapp-enquiries/enquiry-forwarding-policy.mjs";
import { staffCorrelationPlan } from "../whatsapp-enquiries/staff-correlation-mode.js";
import type { StaffNotificationTransport } from "../whatsapp-enquiries/staff-notifications.server.ts";
type StaffScope = Parameters<NonNullable<StaffNotificationTransport["sendStaffWhatsApp"]>>[0];
type StaffResult = Awaited<
  ReturnType<NonNullable<StaffNotificationTransport["sendStaffWhatsApp"]>>
>;
/** Dedicated staff destinations, outside the customer-bound outbox. */
export function createStaffWhatsAppTransport(
  send = sendWoztellResponse,
): StaffNotificationTransport {
  const verificationRef = process.env.EP_WA_STAFF_WHATSAPP_VERIFICATION_REF;
  const correlation = staffCorrelationPlan(process.env);
  if (!verificationRef || !process.env.EP_WA_STAFF_ASSOCIATION_REVIEW_REF || !correlation.ready)
    throw new Error("STAFF_WHATSAPP_CAPABILITY_UNVERIFIED");
  async function sendTo(
    destination:
      | { memberId: string; recipientId?: never }
      | { recipientId: string; memberId?: never },
    scope: Pick<StaffScope, "channelId" | "template" | "message" | "beforeSend">,
  ): Promise<StaffResult> {
    try {
      if (
        process.env.EP_WA_STAFF_NOTIFICATIONS_ENABLED !== "true" ||
        scope.channelId !== providerChannelId()
      )
        throw new Error("STAFF_WHATSAPP_SCOPE_UNVERIFIED");
      await scope.beforeSend();
    } catch {
      throw Object.assign(new Error("STAFF_NOTIFICATION_PREFLIGHT_BLOCKED"), {
        code: "STAFF_NOTIFICATION_PREFLIGHT_BLOCKED",
      });
    }
    const response: Record<string, unknown>[] = scope.template
      ? [scope.template]
      : [{ type: "TEXT", text: scope.message }];
    const result = await send({ ...destination, channelId: scope.channelId, response });
    const parsed = parseWoztellProviderResult("body" in result ? result.body : null, {
      expectedResponseCount: 1,
    });
    if (parsed.outcome === "definitive_refusal") return { state: "failed" };
    if (parsed.outcome === "execution_accepted" || parsed.outcome === "identifiable_acceptance")
      return {
        state: "accepted",
        evidenceKind: "provider_accepted",
        providerOperationId: parsed.primaryMessageId ?? undefined,
      };
    return { state: "unknown" };
  }
  return {
    verificationRef,
    sendStaffWhatsApp: (scope) => sendTo({ memberId: scope.memberId }, scope),
    async sendStaffWhatsAppByPhone(scope) {
      const phone = forwardingPhone(scope.phone);
      if (!phone || !scope.template)
        throw Object.assign(new Error("STAFF_NOTIFICATION_PREFLIGHT_BLOCKED"), {
          code: "STAFF_NOTIFICATION_PREFLIGHT_BLOCKED",
        });
      // WOZTELL Bot API identifies integration phone destinations by recipientId.
      return sendTo({ recipientId: phone }, scope);
    },
  };
}
