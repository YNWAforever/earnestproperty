import { createHash } from "node:crypto";
import type { EventKind } from "./contracts.ts";
import type { NormalizedWoztellEvent } from "../woztell/woztell.server.ts";

export type IdentityInput = {
  tenantKey: string;
  provider: string;
  appId: string;
  channelId: string;
  eventKind: EventKind;
  providerEventId?: string | null;
  providerMessageId?: string | null;
  providerStatus?: string | null;
  providerOccurredAt?: string | null;
  payloadDigest: string;
};

export type IdentityDecision = {
  scopedProviderKey: string | null;
  similarityKey: string;
  certainty: "provider" | "ambiguous";
};

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function deriveInboundIdentity(input: IdentityInput): IdentityDecision {
  if (
    !input.tenantKey ||
    !input.provider ||
    !input.appId ||
    !input.channelId ||
    !/^[0-9a-f]{64}$/i.test(input.payloadDigest)
  )
    throw new Error("WA_INBOUND_IDENTITY_SCOPE_REQUIRED");
  const scope = [input.tenantKey, input.provider, input.appId, input.channelId, input.eventKind];
  const eventId = input.providerEventId?.trim() || null;
  const messageId = input.providerMessageId?.trim() || null;
  const status = input.providerStatus?.trim().toLowerCase() || null;
  let discriminator: unknown = null;
  if (eventId) discriminator = ["event", eventId];
  else if (messageId && input.eventKind === "delivery_receipt" && status)
    discriminator = [
      "message-status",
      messageId,
      status,
      input.providerOccurredAt ?? input.payloadDigest,
    ];
  else if (messageId && input.eventKind !== "delivery_receipt")
    discriminator = ["message", messageId];
  const similarityKey = digest([...scope, input.payloadDigest]);
  return {
    scopedProviderKey: discriminator ? `wa:${digest([...scope, discriminator])}` : null,
    similarityKey,
    certainty: discriminator ? "provider" : "ambiguous",
  };
}

export function eventForReceiptProjection(
  event: NormalizedWoztellEvent,
  receiptId: string,
  eventKind: EventKind,
  identityKey: string | null,
): NormalizedWoztellEvent {
  if (eventKind !== "customer_message") return event;
  if (identityKey) {
    return {
      ...event,
      externalMessageId: identityKey,
      // Look up a pre-migration transcript in this same channel/member only.
      legacyExternalMessageId: event.externalMessageId,
      identityCertainty: "provider",
    };
  }
  return {
    ...event,
    // One durable attempt per unknown-ID delivery. Similarity is review evidence,
    // never authority to erase either genuine repeated message.
    externalMessageId: `wa-ambiguous:${receiptId}`,
    legacyExternalMessageId: null,
    identityCertainty: "ambiguous",
  };
}
