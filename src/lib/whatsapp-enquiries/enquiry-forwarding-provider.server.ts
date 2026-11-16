import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { boundedProviderFetch } from "../woztell/provider-fetch.ts";
import {
  parseStaffAlertTemplate,
  type StaffAlertTemplate,
} from "../woztell/staff-alert-template.ts";

const OPEN_API = "https://open.api.woztell.com/v3";
const CLOUD_API = "https://api.whatsapp-cloud.woztell.sanuker.com/v1.2/api/";
const COPY_PHONE = "85297987774";
const MAX_PAGES = 3;
const MAX_CANDIDATES = 20;
const PARAMS = ["name", "source", "phone", "link"];
const CHANNEL_QUERY = `query EarnestForwardingChannel($app:ID,$channel:ID){
  apiViewer(appId:$app){channel(channelId:$channel){
    _id appId name type connected archived appIntegrationAccessToken
  }}
}`;
const MEMBERS_QUERY = `query EarnestForwardingMembers($app:ID,$channel:String,$phones:[String]){
  apiViewer(appId:$app){members(channelId:$channel,externalIds:$phones,first:100){
    edges{node{_id channelId externalId}} pageInfo{hasNextPage}
  }}
}`;
type Row = Record<string, unknown>;
const row = (value: unknown): Row =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const present = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const identifier = (value: unknown): string | null =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : null;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function phone(value: unknown): string | null {
  if (typeof value !== "string" || !/^[+\d().\s-]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, "").replace(/^00852/, "852");
  return /^[2-9]\d{7}$/.test(digits)
    ? `852${digits}`
    : /^852[2-9]\d{7}$/.test(digits)
      ? digits
      : null;
}
export type ForwardingTemplateCandidate = {
  providerTemplateId: string;
  name: string;
  language: string;
  bodyText: string;
  paramCount: 4;
  proofHash: string;
};
type InspectionStage = "CHANNEL" | "SENDER" | "TEMPLATES" | "MEMBERS";
export type ProviderRequestObservation = {
  stage: InspectionStage;
  httpStatus: number;
  jsonBody: boolean;
  hasError: boolean;
  providerOk: boolean | null;
};
export type EnquiryForwardingProviderInspection = {
  schemaVersion: 1;
  checkedAt: string;
  /** Configuration readiness only; never delivery or phone ownership verification. */
  ready: boolean;
  flags: {
    woztellEnabled: boolean;
    staffNotificationsEnabled: boolean;
    serviceAutomationEnabled: boolean;
    enquiryMode: "off" | "observe" | "active" | "invalid";
    botAccessTokenPresent: boolean;
    openApiTokenPresent: boolean;
    channelSecretPresent: boolean;
  };
  /** Presence of existing references, not newly manufactured verification. */
  capabilities: {
    whatsappVerification: boolean;
    correlationVerification: boolean;
    associationReview: boolean;
    replyContext: boolean;
  };
  channel: {
    configuredChannelId: string | null;
    connected: boolean | null;
    archived: boolean | null;
    senderPhone: string | null;
    companyPhoneMatches: boolean | null;
    senderDifferentFromFixedCopy: boolean | null;
    proofHash: string | null;
  };
  members: {
    checked: boolean;
    complete: boolean;
    requestedPhoneCount: number;
    matched: { phone: string; memberId: string; proofHash: string }[];
    /** Member records do not prove current WhatsApp registration or ownership. */
    provesWhatsappRegistration: false;
  };
  template: {
    configured: StaffAlertTemplate | null;
    configuredApproved: boolean;
    selectionRequired: boolean;
    validationComplete: boolean;
    candidates: ForwardingTemplateCandidate[];
  };
  /** Bounded structural observations only; no URLs, headers, body text or credentials. */
  requests: ProviderRequestObservation[];
  reasonCodes: string[];
};

/** Read-only provider inspection. Tokens remain inside this server invocation.
 * Docs: https://doc.woztell.com/open-api-reference/ and
 * https://doc.woztell.com/docs/integrations/whatsapp/wa-cloud-public-api/
 */
export async function inspectEnquiryForwardingProvider(
  options: {
    env?: NodeJS.ProcessEnv;
    fetch?: typeof globalThis.fetch;
    /** Optional approved registry phones; no customer/member creation or history reads. */
    recipientPhones?: readonly string[];
  } = {},
): Promise<EnquiryForwardingProviderInspection> {
  const env = options.env ?? process.env;
  const secrets = new Set(
    Object.entries(env)
      .filter(
        ([key, value]) =>
          /TOKEN|SECRET|SIGNATURE|VERIFICATION_REF|REVIEW_REF/.test(key) && present(value),
      )
      .map(([, value]) => value as string),
  );
  const sensitiveText = (value: string) =>
    [...secrets].some((secret) => secret.length >= 4 && value.includes(secret));
  const reasons = new Set<string>();
  const channelId = identifier(env.WOZTELL_CHANNEL_ID || env.EP_WA_COMPANY_CHANNEL_ID);
  const companyPhone = phone(env.EP_WA_COMPANY_PHONE || env.VITE_CONTACT_WHATSAPP_PHONE);
  let configured = parseStaffAlertTemplate(env.EP_WA_STAFF_ALERT_TEMPLATE);
  if (configured && sensitiveText(JSON.stringify(configured))) configured = null;
  const mode = env.EP_WA_ENQUIRY_MODE ?? "off";
  const report: EnquiryForwardingProviderInspection = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    ready: false,
    flags: {
      woztellEnabled: env.WOZTELL_ENABLED === "true",
      staffNotificationsEnabled: env.EP_WA_STAFF_NOTIFICATIONS_ENABLED === "true",
      serviceAutomationEnabled: env.EP_WA_SERVICE_AUTOMATION_ENABLED === "true",
      enquiryMode: mode === "off" || mode === "observe" || mode === "active" ? mode : "invalid",
      botAccessTokenPresent: present(env.WOZTELL_BOT_ACCESS_TOKEN),
      openApiTokenPresent: present(env.WOZTELL_OPEN_API_TOKEN),
      channelSecretPresent: present(env.WOZTELL_CHANNEL_SECRET),
    },
    capabilities: {
      whatsappVerification: present(env.EP_WA_STAFF_WHATSAPP_VERIFICATION_REF),
      correlationVerification: present(env.EP_WA_STAFF_CORRELATION_VERIFICATION_REF),
      associationReview: present(env.EP_WA_STAFF_ASSOCIATION_REVIEW_REF),
      replyContext: present(env.EP_WA_STAFF_REPLY_CONTEXT_PATH),
    },
    channel: {
      configuredChannelId: channelId,
      connected: null,
      archived: null,
      senderPhone: null,
      companyPhoneMatches: null,
      senderDifferentFromFixedCopy: null,
      proofHash: null,
    },
    members: {
      checked: false,
      complete: false,
      requestedPhoneCount: 0,
      matched: [],
      provesWhatsappRegistration: false,
    },
    template: {
      configured,
      configuredApproved: false,
      selectionRequired: !configured,
      validationComplete: false,
      candidates: [],
    },
    requests: [],
    reasonCodes: [],
  };
  if (!report.flags.woztellEnabled) reasons.add("WOZTELL_DISABLED");
  if (!report.flags.staffNotificationsEnabled) reasons.add("STAFF_NOTIFICATIONS_DISABLED");
  if (!report.flags.botAccessTokenPresent) reasons.add("BOT_ACCESS_TOKEN_MISSING");
  if (!report.flags.channelSecretPresent) reasons.add("CHANNEL_SECRET_MISSING");
  if (!Object.values(report.capabilities).every(Boolean))
    reasons.add("CAPABILITY_REFERENCES_MISSING");
  if (!configured) reasons.add("STAFF_TEMPLATE_SELECTION_REQUIRED");
  const finish = () => {
    report.ready =
      reasons.size === 0 &&
      report.flags.woztellEnabled &&
      report.flags.staffNotificationsEnabled &&
      report.flags.botAccessTokenPresent &&
      report.flags.channelSecretPresent &&
      Object.values(report.capabilities).every(Boolean) &&
      report.channel.connected === true &&
      report.channel.archived === false &&
      report.channel.companyPhoneMatches === true &&
      report.channel.senderDifferentFromFixedCopy === true &&
      report.template.configuredApproved &&
      report.template.validationComplete;
    report.reasonCodes = [...reasons];
    // Defensive last boundary: provider fields/errors can never echo a known secret.
    let redacted = false;
    const clean = JSON.parse(
      JSON.stringify(report, (_key, value: unknown) => {
        if (typeof value !== "string") return value;
        let text = value;
        for (const secret of secrets) {
          if (secret.length >= 4 && text.includes(secret)) {
            text = text.replaceAll(secret, "[REDACTED]");
            redacted = true;
          }
        }
        return text;
      }),
    ) as EnquiryForwardingProviderInspection;
    if (redacted) {
      clean.ready = false;
      clean.reasonCodes.push("SENSITIVE_PROVIDER_CONTENT_REDACTED");
    }
    return clean;
  };
  async function request(
    url: string,
    init: RequestInit,
    stage: InspectionStage,
  ): Promise<Row | null> {
    try {
      const { response, text } = await boundedProviderFetch(
        url,
        { ...init, redirect: "error" },
        { fetchImpl: options.fetch, timeoutMs: 6_000, maxBytes: 1_048_576 },
      );
      let decoded: unknown;
      let jsonBody = false;
      try {
        decoded = JSON.parse(text);
        jsonBody = true;
      } catch {
        // The structural observation records invalid JSON without retaining response text.
      }
      const body = row(decoded);
      report.requests.push({
        stage,
        httpStatus: response.status,
        jsonBody,
        hasError: body.error != null || array(body.errors).length > 0,
        providerOk:
          body.ok === 1 || body.ok === true
            ? true
            : body.ok === 0 || body.ok === false
              ? false
              : null,
      });
      if (!response.ok) {
        reasons.add(
          `${stage}_${response.status === 401 || response.status === 403 ? "AUTH_DENIED" : response.status === 429 ? "RATE_LIMITED" : "HTTP_FAILED"}`,
        );
        return null;
      }
      if (!jsonBody || Object.keys(body).length === 0) reasons.add(`${stage}_INVALID_RESPONSE`);
      return Object.keys(body).length ? body : null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      reasons.add(
        `${stage}_${message === "WOZTELL_RESPONSE_TOO_LARGE" ? "RESPONSE_TOO_LARGE" : message === "WOZTELL_PROVIDER_TIMEOUT" ? "TIMEOUT" : "REQUEST_FAILED"}`,
      );
      return null;
    }
  }
  const open = (query: string, variables: Row, stage: InspectionStage) =>
    request(
      OPEN_API,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.WOZTELL_OPEN_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
      },
      stage,
    );
  if (!channelId || sensitiveText(channelId)) {
    reasons.add("COMPANY_CHANNEL_INVALID");
    return finish();
  }
  if (!report.flags.openApiTokenPresent) {
    reasons.add("OPEN_API_TOKEN_MISSING");
    return finish();
  }
  const channelBody = await open(
    CHANNEL_QUERY,
    { app: env.WOZTELL_APP_ID, channel: channelId },
    "CHANNEL",
  );
  if (!channelBody) return finish();
  if (array(channelBody.errors).length) {
    reasons.add("CHANNEL_QUERY_REFUSED");
    return finish();
  }
  const channel = row(row(row(channelBody.data).apiViewer).channel);
  if (
    channel._id !== channelId ||
    (present(env.WOZTELL_APP_ID) && channel.appId !== env.WOZTELL_APP_ID)
  ) {
    reasons.add("PROVIDER_CHANNEL_SCOPE_MISMATCH");
    return finish();
  }
  report.channel.connected = typeof channel.connected === "boolean" ? channel.connected : null;
  report.channel.archived = typeof channel.archived === "boolean" ? channel.archived : null;
  if (report.channel.connected === false) reasons.add("PROVIDER_CHANNEL_NOT_CONNECTED");
  else if (report.channel.connected !== true)
    reasons.add("PROVIDER_CHANNEL_CONNECTION_STATUS_UNKNOWN");
  if (report.channel.archived === true) reasons.add("PROVIDER_CHANNEL_ARCHIVED");
  else if (report.channel.archived !== false)
    reasons.add("PROVIDER_CHANNEL_ARCHIVE_STATUS_UNKNOWN");
  // Open API member association is independent of Cloud sender/template capability.
  const requested = [
    ...new Set(
      (options.recipientPhones ?? []).map(phone).filter((value): value is string => value !== null),
    ),
  ];
  report.members.requestedPhoneCount = requested.length;
  if (requested.length > 40 || (options.recipientPhones ?? []).some((value) => !phone(value)))
    reasons.add("RECIPIENT_LOOKUP_INPUT_INVALID");
  else if (requested.length) {
    const body = await open(
      MEMBERS_QUERY,
      { app: env.WOZTELL_APP_ID, channel: channelId, phones: requested },
      "MEMBERS",
    );
    const members = row(row(row(body?.data).apiViewer).members);
    if (body && !array(body.errors).length && Array.isArray(members.edges)) {
      report.members.checked = true;
      report.members.complete =
        row(members.pageInfo).hasNextPage === false && members.edges.length <= 100;
      if (!report.members.complete) reasons.add("RECIPIENT_INSPECTION_INCOMPLETE");
      const identities = new Map<string, string>();
      const ambiguousPhones = new Set<string>();
      for (const edge of members.edges.slice(0, 100)) {
        const member = row(row(edge).node),
          memberPhone = phone(member.externalId),
          memberId = identifier(member._id);
        if (
          member.channelId !== channelId ||
          !memberPhone ||
          !requested.includes(memberPhone) ||
          !memberId
        ) {
          report.members.complete = false;
          reasons.add("RECIPIENT_MEMBER_SCOPE_MISMATCH");
          continue;
        }
        if (ambiguousPhones.has(memberPhone)) continue;
        const existingIdentity = identities.get(memberPhone);
        if (existingIdentity && existingIdentity !== memberId) {
          ambiguousPhones.add(memberPhone);
          report.members.complete = false;
          report.members.matched = report.members.matched.filter(
            (entry) => entry.phone !== memberPhone,
          );
          reasons.add("RECIPIENT_MEMBER_AMBIGUOUS");
          continue;
        }
        if (existingIdentity) continue;
        identities.set(memberPhone, memberId);
        report.members.matched.push({
          phone: memberPhone,
          memberId,
          proofHash: digest({ channelId, phone: memberPhone, memberId }),
        });
      }
    } else reasons.add("RECIPIENT_MEMBERSHIP_UNVERIFIED");
  }
  if (!present(channel.appIntegrationAccessToken)) {
    reasons.add("CLOUD_CHANNEL_READ_TOKEN_UNAVAILABLE");
    return finish();
  }
  const channelToken = channel.appIntegrationAccessToken;
  secrets.add(channelToken);
  const cloudUrl = (
    path: "waba-info" | "whatsapp-message-templates",
    params: Record<string, string>,
  ) => {
    const url = new URL(path, CLOUD_API);
    url.searchParams.set("accessToken", channelToken);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  };
  const senderBody = await request(
    cloudUrl("waba-info", { channelId }),
    { method: "GET" },
    "SENDER",
  );
  if (!senderBody) return finish();
  const sender = row(senderBody.result);
  const senderPhone = phone(sender.phoneNumber);
  const wabaId = identifier(sender.wabaId);
  if (senderBody.ok !== 1 || !senderPhone || !wabaId) {
    reasons.add("SENDER_PROOF_UNAVAILABLE");
    return finish();
  }
  report.channel.senderPhone = senderPhone;
  report.channel.companyPhoneMatches = !!companyPhone && senderPhone === companyPhone;
  report.channel.senderDifferentFromFixedCopy = senderPhone !== COPY_PHONE;
  report.channel.proofHash = digest({
    channelId,
    appId: channel.appId,
    senderPhone,
    wabaId,
    phoneNumberId: identifier(sender.phoneNumberId),
    connected: channel.connected,
    archived: channel.archived,
  });
  if (!companyPhone) reasons.add("COMPANY_PHONE_NOT_CONFIGURED");
  else if (!report.channel.companyPhoneMatches) reasons.add("PROVIDER_SENDER_PHONE_MISMATCH");
  if (!report.channel.senderDifferentFromFixedCopy) reasons.add("FIXED_COPY_IS_COMPANY_SENDER");

  let after: string | undefined;
  const cursors = new Set<string>();
  const candidateProofs = new Map<string, string>();
  const ambiguousTemplates = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string> = {
      wabaId,
      first: "100",
      status: JSON.stringify(["APPROVED"]),
    };
    if (configured) params.name = configured.name;
    if (after) params.after = after;
    const body = await request(
      cloudUrl("whatsapp-message-templates", params),
      { method: "GET" },
      "TEMPLATES",
    );
    if (!body) break;
    if (body.ok !== 1 || !Array.isArray(body.data)) {
      reasons.add("TEMPLATES_INVALID_RESPONSE");
      break;
    }
    for (const value of body.data) {
      const item = row(value),
        name = item.name;
      const templateId = identifier(typeof item.id === "number" ? String(item.id) : item.id);
      if (!templateId || typeof name !== "string" || !/^[a-z0-9_]{1,512}$/.test(name)) continue;
      for (const variant of array(item.templates)) {
        const languageTemplate = row(variant),
          language = languageTemplate.language;
        if (
          typeof language !== "string" ||
          !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(language) ||
          languageTemplate.status !== "APPROVED"
        )
          continue;
        const statuses = array(item.statuses)
          .map(row)
          .filter((entry) => entry.language === language);
        if (statuses.some((entry) => entry.status !== "APPROVED")) continue;
        const components = array(languageTemplate.components).map(row);
        const bodies = components.filter((entry) => entry.type === "BODY");
        const bodyText = bodies[0]?.text;
        if (
          bodies.length !== 1 ||
          typeof bodyText !== "string" ||
          [...bodyText].length > 1024 ||
          sensitiveText(bodyText) ||
          sensitiveText(name)
        )
          continue;
        const placeholders = [...bodyText.matchAll(/\{\{([^{}]*)\}\}/g)].map((match) => match[1]);
        if (
          placeholders.join(",") !== "1,2,3,4" ||
          /[{}]/.test(bodyText.replace(/\{\{[1-4]\}\}/g, ""))
        )
          continue;
        const extraParams = components.some((component) => {
          if (component.type === "BODY") return false;
          if (component.type === "HEADER")
            return (
              component.format !== "TEXT" ||
              typeof component.text !== "string" ||
              /[{}]/.test(component.text)
            );
          if (component.type === "FOOTER")
            return typeof component.text !== "string" || /[{}]/.test(component.text);
          if (component.type === "BUTTONS")
            return array(component.buttons).some((button) => {
              const entry = row(button);
              return (
                !["URL", "PHONE_NUMBER"].includes(String(entry.type)) ||
                /[{}]/.test(JSON.stringify(entry))
              );
            });
          return true;
        });
        if (extraParams) continue;
        const candidate: ForwardingTemplateCandidate = {
          providerTemplateId: templateId,
          name,
          language,
          bodyText,
          paramCount: 4,
          proofHash: digest({
            channelId,
            wabaId,
            templateId,
            name,
            language,
            bodyText,
            status: "APPROVED",
          }),
        };
        const selector = `${name}:${language}`;
        if (ambiguousTemplates.has(selector)) continue;
        const previousProof = candidateProofs.get(selector);
        if (previousProof && previousProof !== candidate.proofHash) {
          ambiguousTemplates.add(selector);
          report.template.candidates = report.template.candidates.filter(
            (entry) => entry.name !== name || entry.language !== language,
          );
          if (configured?.name === name && configured.language === language)
            report.template.configuredApproved = false;
          reasons.add("TEMPLATE_CONTRACT_CONFLICT");
          continue;
        }
        candidateProofs.set(selector, candidate.proofHash);
        if (
          report.template.candidates.length < MAX_CANDIDATES &&
          !report.template.candidates.some(
            (existing) => existing.name === name && existing.language === language,
          )
        )
          report.template.candidates.push(candidate);
        if (
          configured?.name === name &&
          configured.language === language &&
          configured.params.length === 4 &&
          PARAMS.every((param) =>
            configured.params.includes(param as "name" | "source" | "phone" | "link"),
          )
        )
          report.template.configuredApproved = true;
      }
    }
    const paging = row(body.paging);
    if (paging.hasNext === false) {
      report.template.validationComplete = true;
      break;
    }
    if (paging.hasNext !== true) {
      reasons.add("TEMPLATE_PAGINATION_INVALID");
      break;
    }
    const next = row(paging.cursors).after;
    if (typeof next !== "string" || !next || next.length > 1024 || cursors.has(next)) {
      reasons.add("TEMPLATE_PAGINATION_INVALID");
      break;
    }
    cursors.add(next);
    after = next;
  }
  if (!report.template.validationComplete) reasons.add("TEMPLATE_INSPECTION_INCOMPLETE");
  if (configured && !report.template.configuredApproved)
    reasons.add("CONFIGURED_TEMPLATE_NOT_APPROVED_BODY4");
  return finish();
}
