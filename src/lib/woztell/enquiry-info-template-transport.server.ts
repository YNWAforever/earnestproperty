import "@tanstack/react-start/server-only";

import { createHash } from "node:crypto";
import { normalizePhone } from "../phone.js";
import { forwardingPhone } from "../whatsapp-enquiries/enquiry-forwarding-policy.mjs";
import { companyPhone, providerChannelId } from "../whatsapp-enquiries/wa-config.server.ts";
import { boundedProviderFetch } from "./provider-fetch.ts";
import { parseWoztellProviderResult } from "./provider-result.ts";
import {
  parseStaffAlertTemplate,
  isForwardingTemplate,
  STAFF_PARAM_LIMITS,
  sanitizeTemplateParam,
  type StaffAlertTemplate,
  type StaffTemplateResponse,
} from "./staff-alert-template.ts";

export const ENQUIRY_INFO_TRANSPORT_PURPOSE = "enq_forward_info";
export const ENQUIRY_INFO_TRANSPORT_VERSION = 1;
const BOT_ENDPOINT = "https://bot.api.woztell.com/sendResponses";
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const ID = /^[a-zA-Z0-9_-]{1,160}$/;

/** All fields describe one frozen dispatch claim, not provider delivery evidence. */
export type EnquiryInfoSendBinding = {
  purpose: typeof ENQUIRY_INFO_TRANSPORT_PURPOSE;
  version: typeof ENQUIRY_INFO_TRANSPORT_VERSION;
  appId: string;
  channelId: string;
  companySenderPhone: string;
  recipientPhone: string;
  attemptId: string;
  /** Local dispatch claim/operation UUID, never an invented provider message id. */
  operationId: string;
  armId: string;
  providerProofAuditId: string;
  recipientVersion: number;
  frozenEvidenceHash: string;
  templateDigest: string;
};

/**
 * Trusted worker port: re-read actual policy/review/provider/lease facts and authorize
 * this one claim. An echoed client object or reference presence is not authorization.
 * The worker must durably prevent reuse across transport instances/processes.
 */
export type ResolveEnquiryInfoPermit = (
  request: Readonly<EnquiryInfoSendBinding>,
) => Promise<Readonly<EnquiryInfoSendBinding> | null>;

export type EnquiryInfoRuntime = {
  enabled: boolean;
  appId: string | null;
  channelId: string | null;
  companySenderPhone: string | null;
  botAccessToken: string | null;
};
export type EnquiryInfoSendResult = {
  state: "accepted" | "failed" | "unknown";
  evidenceKind?: "provider_accepted";
  providerOperationId?: string;
};
export type EnquiryInfoTemplateSend = {
  binding: EnquiryInfoSendBinding;
  templateContract: StaffAlertTemplate;
  template: StaffTemplateResponse;
  beforeSend: () => Promise<void>;
};
export type EnquiryInfoTransportOptions = {
  resolvePermit: ResolveEnquiryInfoPermit;
  fetch?: typeof fetch;
  runtime?: () => EnquiryInfoRuntime;
  /** Complete extra private-value set from the trusted caller, including unselected values. */
  privateValues: readonly string[];
  timeoutMs?: number;
};

const BINDING_KEYS = [
  "purpose",
  "version",
  "appId",
  "channelId",
  "companySenderPhone",
  "recipientPhone",
  "attemptId",
  "operationId",
  "armId",
  "providerProofAuditId",
  "recipientVersion",
  "frozenEvidenceHash",
  "templateDigest",
] as const;
function blocked(): Error & { code: string } {
  return Object.assign(new Error("STAFF_NOTIFICATION_PREFLIGHT_BLOCKED"), {
    code: "STAFF_NOTIFICATION_PREFLIGHT_BLOCKED",
  });
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw blocked();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw blocked();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => !descriptors[key] || !("value" in descriptors[key])) ||
    Object.keys(descriptors).some((key) => !keys.includes(key))
  )
    throw blocked();
  return value as Record<string, unknown>;
}
function list(value: unknown, length: number): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length !== length ||
    Reflect.ownKeys(value).length !== length + 1
  )
    throw blocked();
  return Array.from({ length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) throw blocked();
    return descriptor.value as unknown;
  });
}
function bindingOf(value: unknown): Readonly<EnquiryInfoSendBinding> {
  const row = object(value, BINDING_KEYS);
  if (
    row.purpose !== ENQUIRY_INFO_TRANSPORT_PURPOSE ||
    row.version !== ENQUIRY_INFO_TRANSPORT_VERSION ||
    typeof row.appId !== "string" ||
    !ID.test(row.appId) ||
    typeof row.channelId !== "string" ||
    !ID.test(row.channelId) ||
    typeof row.companySenderPhone !== "string" ||
    normalizePhone(row.companySenderPhone) !== row.companySenderPhone ||
    typeof row.recipientPhone !== "string" ||
    forwardingPhone(row.recipientPhone) !== row.recipientPhone ||
    row.companySenderPhone === row.recipientPhone ||
    ![row.attemptId, row.operationId, row.armId, row.providerProofAuditId].every(
      (id) => typeof id === "string" && UUID.test(id),
    ) ||
    typeof row.recipientVersion !== "number" ||
    !Number.isSafeInteger(row.recipientVersion) ||
    row.recipientVersion < 1 ||
    ![row.frozenEvidenceHash, row.templateDigest].every(
      (hash) => typeof hash === "string" && HASH.test(hash),
    )
  )
    throw blocked();
  return Object.freeze(
    Object.fromEntries(BINDING_KEYS.map((key) => [key, row[key]])),
  ) as Readonly<EnquiryInfoSendBinding>;
}
function templateOf(contractValue: unknown, templateValue: unknown) {
  const rawContract = object(contractValue, ["name", "language", "params"]);
  const paramCount = Array.isArray(rawContract.params) && rawContract.params.length === 5 ? 5 : 4;
  const semantics = list(rawContract.params, paramCount);
  if (
    typeof rawContract.name !== "string" ||
    typeof rawContract.language !== "string" ||
    semantics.some((value) => typeof value !== "string")
  )
    throw blocked();
  const contract = parseStaffAlertTemplate(
    JSON.stringify({ name: rawContract.name, language: rawContract.language, params: semantics }),
  );
  if (!contract || !isForwardingTemplate(contract)) throw blocked();
  const wire = object(templateValue, ["type", "elementName", "languageCode", "components"]);
  if (
    wire.type !== "TEMPLATE" ||
    wire.elementName !== contract.name ||
    wire.languageCode !== contract.language
  )
    throw blocked();
  const body = object(list(wire.components, 1)[0], ["type", "parameters"]);
  if (body.type !== "body") throw blocked();
  const parameters = list(body.parameters, paramCount).map((value, index) => {
    const parameter = object(value, ["type", "text"]);
    const semantic = contract.params[index];
    if (
      parameter.type !== "text" ||
      typeof parameter.text !== "string" ||
      !parameter.text ||
      sanitizeTemplateParam(parameter.text, "-", STAFF_PARAM_LIMITS[semantic]) !== parameter.text
    )
      throw blocked();
    return Object.freeze({ type: "text" as const, text: parameter.text });
  });
  const template: StaffTemplateResponse = {
    type: "TEMPLATE",
    elementName: contract.name,
    languageCode: contract.language,
    components: [{ type: "body", parameters }],
  };
  Object.freeze(contract.params);
  Object.freeze(contract);
  Object.freeze(parameters);
  Object.freeze(template.components[0]);
  Object.freeze(template.components);
  Object.freeze(template);
  return { contract, template };
}
function digestOf(contract: StaffAlertTemplate, template: StaffTemplateResponse) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        ENQUIRY_INFO_TRANSPORT_PURPOSE,
        ENQUIRY_INFO_TRANSPORT_VERSION,
        contract.name,
        contract.language,
        contract.params,
        template,
      ]),
    )
    .digest("hex");
}
/** Binds the approved semantic order and the exact sanitized wire body, not just its name. */
export function enquiryInfoTemplateDigest(
  contract: StaffAlertTemplate,
  template: StaffTemplateResponse,
): string {
  const frozen = templateOf(contract, template);
  return digestOf(frozen.contract, frozen.template);
}
function currentRuntime(): EnquiryInfoRuntime {
  return {
    enabled:
      process.env.WOZTELL_ENABLED === "true" &&
      process.env.EP_WA_STAFF_NOTIFICATIONS_ENABLED === "true",
    appId: process.env.WOZTELL_APP_ID ?? null,
    channelId: providerChannelId(),
    companySenderPhone: normalizePhone(companyPhone()),
    botAccessToken: process.env.WOZTELL_BOT_ACCESS_TOKEN ?? null,
  };
}
function runtimeOf(get: () => EnquiryInfoRuntime, binding: Readonly<EnquiryInfoSendBinding>) {
  const runtime = object(get(), [
    "enabled",
    "appId",
    "channelId",
    "companySenderPhone",
    "botAccessToken",
  ]) as EnquiryInfoRuntime;
  if (
    runtime.enabled !== true ||
    runtime.appId !== binding.appId ||
    runtime.channelId !== binding.channelId ||
    runtime.companySenderPhone !== binding.companySenderPhone ||
    typeof runtime.botAccessToken !== "string" ||
    !runtime.botAccessToken.trim()
  )
    throw blocked();
  return { ...runtime };
}
function safeOperationId(value: string | null, secrets: readonly string[]): string | null {
  if (
    !value ||
    !/^(?:[a-zA-Z0-9_-]{1,128}|wamid\.[a-zA-Z0-9+/=_-]{1,480})$/.test(value) ||
    secrets.some(
      (secret) =>
        value.includes(secret) ||
        value.includes(encodeURIComponent(secret)) ||
        value.includes(Buffer.from(secret).toString("base64")),
    )
  )
    return null;
  return value;
}

/**
 * One instance per dispatch batch. Information copies only: no legacy refs, member
 * destinations, TEXT or Inbox actions. Durable claim consumption belongs to the DB port.
 */
export function createEnquiryInfoTemplateTransport(options: EnquiryInfoTransportOptions) {
  if (!options || typeof options.resolvePermit !== "function") throw blocked();
  const resolvePermit = options.resolvePermit;
  const runtime = options.runtime ?? currentRuntime;
  const fetchImpl = options.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000) throw blocked();
  if (!Array.isArray(options.privateValues) || options.privateValues.length > 128) throw blocked();
  const extraPrivate = [...options.privateValues];
  if (extraPrivate.some((value) => typeof value !== "string" || !value || value.length > 65_536))
    throw blocked();
  // The DB port is still required for cross-process reuse; this closes local duplicate calls.
  const used = new Set<string>();
  return Object.freeze({
    async sendTemplateByPhone(input: EnquiryInfoTemplateSend): Promise<EnquiryInfoSendResult> {
      let binding: Readonly<EnquiryInfoSendBinding>;
      let template: StaffTemplateResponse;
      let token: string;
      let secrets: string[];
      try {
        const raw = object(input, ["binding", "templateContract", "template", "beforeSend"]);
        binding = bindingOf(raw.binding);
        const frozen = templateOf(raw.templateContract, raw.template);
        template = frozen.template;
        if (digestOf(frozen.contract, template) !== binding.templateDigest) throw blocked();
        if (typeof raw.beforeSend !== "function") throw blocked();
        const beforeSend = raw.beforeSend as () => Promise<void>;
        const initial = runtimeOf(runtime, binding);
        const initialPrivate = [...extraPrivate, initial.botAccessToken!];
        if (initialPrivate.some((value) => JSON.stringify(template).includes(value)))
          throw blocked();
        const operation = `${binding.attemptId}:${binding.operationId}`;
        if (used.has(operation) || used.size >= 4096) throw blocked();
        used.add(operation);
        await beforeSend();
        const permit = bindingOf(await resolvePermit(binding));
        if (BINDING_KEYS.some((key) => permit[key] !== binding[key])) throw blocked();
        const latest = runtimeOf(runtime, binding);
        if (latest.botAccessToken !== initial.botAccessToken) throw blocked();
        token = latest.botAccessToken!;
        secrets = [...new Set([...extraPrivate, initial.botAccessToken!, token])];
      } catch {
        throw blocked();
      }
      try {
        const { response, text } = await boundedProviderFetch(
          BOT_ENDPOINT,
          {
            method: "POST",
            redirect: "error",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              channelId: binding.channelId,
              recipientId: binding.recipientPhone,
              response: [template],
            }),
          },
          { fetchImpl, timeoutMs, maxBytes: 262_144 },
        );
        const parsed = parseWoztellProviderResult(JSON.parse(text) as unknown, {
          expectedResponseCount: 1,
        });
        if (parsed.outcome === "definitive_refusal") return { state: "failed" };
        const providerOperationId = safeOperationId(parsed.primaryMessageId, secrets);
        if (response.ok && parsed.outcome === "identifiable_acceptance" && providerOperationId)
          return {
            state: "accepted",
            evidenceKind: "provider_accepted",
            providerOperationId,
          };
      } catch {
        // A timeout, unreadable body or provider exception may follow execution. Never retry here.
      }
      return { state: "unknown" };
    },
  });
}
