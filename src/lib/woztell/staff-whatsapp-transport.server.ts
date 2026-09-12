import "@tanstack/react-start/server-only";
import { sendWoztellResponse } from "./woztell.server.ts";
import { parseWoztellProviderResult } from "./provider-result.ts";
import type { StaffNotificationTransport } from "../whatsapp-enquiries/staff-notifications.server.ts";
/** Dedicated STAFF destination, outside the customer-bound outbox. Configuration does not imply approval. */
export function createStaffWhatsAppTransport(
  send = sendWoztellResponse,
): StaffNotificationTransport {
  const verificationRef = process.env.EP_WA_STAFF_WHATSAPP_VERIFICATION_REF;
  if (
    !verificationRef ||
    !process.env.EP_WA_STAFF_CORRELATION_VERIFICATION_REF ||
    !process.env.EP_WA_STAFF_ASSOCIATION_REVIEW_REF ||
    !process.env.EP_WA_STAFF_REPLY_CONTEXT_PATH
  )
    throw new Error("STAFF_WHATSAPP_CAPABILITY_UNVERIFIED");
  return {
    verificationRef,
    async sendStaffWhatsApp(scope) {
      try {
        if (
          process.env.EP_WA_STAFF_WHATSAPP_ALERTS_ENABLED !== "true" ||
          scope.channelId !== process.env.WOZTELL_CHANNEL_ID
        )
          throw new Error("STAFF_WHATSAPP_SCOPE_UNVERIFIED");
        if (scope.templateName) throw new Error("STAFF_TEMPLATE_CONTRACT_UNVERIFIED");
        await scope.beforeSend();
      } catch {
        throw Object.assign(new Error("STAFF_NOTIFICATION_PREFLIGHT_BLOCKED"), {
          code: "STAFF_NOTIFICATION_PREFLIGHT_BLOCKED",
        });
      }
      const response = [{ type: "TEXT", text: scope.message }];
      const result = await send({ memberId: scope.memberId, response });
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
    },
  };
}
