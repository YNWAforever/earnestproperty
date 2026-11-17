import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { boundedProviderFetch } from "../woztell/provider-fetch.ts";
import {
  deriveEnquiryInfoReadiness,
  type EnquiryInfoInstallationEvidence,
  type EnquiryInfoReadiness,
} from "./enquiry-info-readiness.js";
import {
  parseStaffAlertTemplate,
  type StaffAlertTemplate,
} from "../woztell/staff-alert-template.ts";
import { staffCorrelationPlan } from "./staff-correlation-mode.js";
import {
  channelArchiveProof,
  channelArchiveVerified,
  type ChannelArchiveProof,
} from "./channel-archive-proof.js";

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
// Optional failure diagnostics: masked environment info is reduced to booleans only.
// Never request unmaskToken, integration secrets, signatures, or expose raw configuration.
const CHANNEL_INTEGRATIONS_QUERY = `query EarnestForwardingChannelIntegrations($app:ID,$channel:ID){
  apiViewer(appId:$app){channel(channelId:$channel){
    _id appId environments{envId on integrationInstalled info integration{_id integrationId build}}
  }}
}`;
// Deprecated identity fields, queried only in the explicit identity diagnostic mode.
// Documentation marks them "No longer supported"; if they still resolve they may provide
// read-only identity facts while the Cloud Public API refuses every credential.
const IDENTITY_QUERY = `query EarnestForwardingChannelIdentity($app:ID,$channel:ID){
  apiViewer(appId:$app){channel(channelId:$channel){
    _id appId wabaStatus wabaError wabaInfo
    wabaIntegration{id accountId name namespace type}
    environments{envId}
  }}
}`;
// Fixed allowlist: only these key names may be echoed, never their values.
const INFO_KEY_ALLOWLIST = [
  "integrationId",
  "build",
  "alias",
  "appIntegrationId",
  "subscribed",
  "wabaId",
  "phoneNumberId",
  "displayPhoneNumber",
  "phoneNumber",
  "namespace",
  "accountId",
] as const;
// Payload & SignedContext authentication for endpoints that require it. The signature is a
// credential: it is registered for masking and never appears in any report.
const SIGNATURE_QUERY = `query EarnestForwardingEnvironmentSignature($app:ID,$channel:ID,$env:ID!){
  apiViewer(appId:$app){channel(channelId:$channel){
    _id appId environment(envId:$env){envId appIntegrationSignature integration{_id integrationId build}}
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
// Decoding is not signature verification. These bounded observations cannot prove
// identity, authorization, token validity, or readiness; no claim values leave this helper.
function inspectCredential(token: string | null, env: NodeJS.ProcessEnv, channelId: string) {
  const bounded = token !== null && token.length <= 16_384;
  const jwtLike = bounded && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);
  let claims: Row | null = null;
  if (jwtLike) {
    try {
      const parsed: unknown = JSON.parse(
        Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
      );
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed))
        claims = row(parsed);
    } catch {
      // Invalid or opaque credentials remain unknown; never repair or re-encode them.
    }
  }
  const matches = (other: string | undefined) =>
    token && present(other) ? token === other.trim() : null;
  const claimMatches = (keys: string[], expected: string | undefined) => {
    if (!claims || !present(expected)) return null;
    const values = keys.filter((key) => Object.hasOwn(claims, key)).map((key) => claims[key]);
    if (!values.length || values.some((value) => !present(value))) return null;
    return values.every((value) => value === expected);
  };
  const numericDate = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);
  return {
    signatureVerified: false as const,
    configuredPresent: token !== null,
    exceedsInspectionLimit: token !== null && !bounded,
    matchesOpenToken: matches(env.WOZTELL_OPEN_API_TOKEN),
    matchesBotToken: matches(env.WOZTELL_BOT_ACCESS_TOKEN),
    containsPercentEscape: bounded && /%[0-9a-f]{2}/i.test(token),
    containsLiteralEscape: bounded && /\\[nrt]/.test(token),
    placeholderLike:
      bounded &&
      /\*{3,}|<redacted>|\{\{SECRET_[^}]+\}\}|your[_ -]?(?:access[_ -]?)?token|change[_ -]?me/i.test(
        token,
      ),
    jwtLike,
    claimsReadable: claims !== null,
    claimsExpired: numericDate(claims?.exp) ? claims.exp <= Date.now() / 1000 : null,
    claimsNotYetValid: numericDate(claims?.nbf) ? claims.nbf > Date.now() / 1000 : null,
    appClaimMatches: claimMatches(["app", "appId"], env.WOZTELL_APP_ID),
    channelClaimMatches: claimMatches(["channel", "channelId"], channelId),
    wabaClaimMatches: claimMatches(["waba", "wabaId"], env.WOZTELL_DIAGNOSTIC_WABA_ID),
  };
}
function emptyIdentityInspection(): NonNullable<
  EnquiryForwardingProviderInspection["identityInspection"]
> {
  return {
    queried: false,
    refused: false,
    infoKeyMembers: [],
    wabaInfoPresent: null,
    wabaInfoHasWabaId: null,
    wabaInfoHasPhoneNumberId: null,
    wabaInfoHasPhoneNumber: null,
    wabaInfoHasNamespace: null,
    wabaInfoHasName: null,
    configuredWabaMatches: null,
    companyPhoneMatches: null,
    wabaStatusPresent: null,
    wabaStatusConnectedLike: null,
    wabaErrorPresent: null,
    wabaIntegrationPresent: null,
    wabaIntegrationHasId: null,
    wabaIntegrationHasNamespace: null,
    wabaIntegrationHasName: null,
  };
}
export type ForwardingTemplateCandidate = {
  providerTemplateId: string;
  name: string;
  language: string;
  bodyText: string;
  paramCount: 4;
  proofHash: string;
};
type InspectionStage =
  | "CHANNEL"
  | "SENDER"
  | "TEMPLATES"
  | "MEMBERS"
  | "CHANNEL_INTEGRATIONS"
  | "SENDER_CHANNEL_TOKEN"
  | "SENDER_WABA_ID"
  | "TEMPLATES_WABA_ID"
  | "SENDER_V1_1"
  | "CHANNEL_IDENTITY"
  | "CHANNEL_SIGNATURE"
  | "BUSINESS_PROFILE"
  | "DISPLAYNAME_STATUS"
  | "SENDER_DIAGNOSTIC_TOKEN"
  | "TEMPLATES_DIAGNOSTIC_TOKEN";
// These are observations of untrusted error text, never authentication or readiness proof.
const ERROR_SIGNALS = {
  invalid_token:
    /\b(?:invalid (?:access )?token|(?:access )?token (?:is )?(?:not valid|invalid)|invalid oauth access token)\b/i,
  expired_token:
    /\b(?:jwt expired|(?:access )?token (?:has )?expired|expired (?:access )?token)\b/i,
  malformed_token:
    /\b(?:jwt malformed|invalid token format|malformed (?:access )?token|jwt must be a string)\b/i,
  invalid_signature: /\b(?:invalid signature|signature (?:verification )?failed)\b/i,
  missing_token:
    /\b(?:(?:access )?token (?:is )?(?:required|missing)|missing (?:access )?token|no (?:access )?token provided|jwt must be provided)\b/i,
  permission_denied:
    /\b(?:permission denied|access denied|unauthorized|not authorized|insufficient permissions?|forbidden)\b/i,
  channel_not_found:
    /\b(?:channel (?:is )?(?:not found|missing|invalid)|invalid channel|no channel found)\b/i,
  waba_not_found: /\b(?:waba (?:is )?(?:not found|missing|invalid)|invalid waba|no waba found)\b/i,
  integration_not_found:
    /\b(?:(?:app )?integration (?:is )?(?:not found|missing|invalid)|invalid integration|no integration found)\b/i,
  null_property_access:
    /\b(?:cannot read (?:properties|property(?: ['"][^'"\r\n]{1,64}['"])?) of (?:null|undefined)|cannot destructure property)\b/i,
  upstream_timeout:
    /\b(?:etimedout|econnreset|econnrefused|fetch failed|request timed out|gateway timeout)\b/i,
  internal_error: /\b(?:internal server error|internal error|unexpected error)\b/i,
  not_supported: /\b(?:not supported|unsupported (?:operation|request|api|version))\b/i,
} as const;
const ERROR_NAMES = [
  "Error",
  "TypeError",
  "ReferenceError",
  "SyntaxError",
  "JsonWebTokenError",
  "TokenExpiredError",
  "NotBeforeError",
  "OAuthException",
  "GraphMethodException",
] as const;
type ProviderErrorObservation = {
  shape: "string" | "object" | "array" | "other";
  knownName: (typeof ERROR_NAMES)[number] | null;
  signals: (keyof typeof ERROR_SIGNALS)[];
};
function observeProviderError(
  value: unknown,
  secrets: ReadonlySet<string>,
): ProviderErrorObservation {
  const entry = row(value);
  // Inspect only these bounded error leaves. Never retain text, keys, codes, stack or URLs.
  const leaves = [
    typeof value === "string" ? value : null,
    entry.message,
    entry.name,
    entry.type,
    entry.code,
  ];
  const text = leaves
    .filter((item): item is string => typeof item === "string" && item.length <= 4096)
    .map((item) => {
      let safe = item;
      for (const secret of secrets) {
        if (secret.length < 4) continue;
        safe = safe.replaceAll(secret, " ").replaceAll(encodeURIComponent(secret), " ");
      }
      return safe;
    })
    .join("\n");
  return {
    shape:
      typeof value === "string"
        ? "string"
        : Array.isArray(value)
          ? "array"
          : value !== null && typeof value === "object"
            ? "object"
            : "other",
    knownName:
      ERROR_NAMES.find((name) =>
        text.split("\n").some((line) => line === name || line.startsWith(`${name}:`)),
      ) ?? null,
    signals: (Object.keys(ERROR_SIGNALS) as (keyof typeof ERROR_SIGNALS)[]).filter((name) =>
      ERROR_SIGNALS[name].test(text.replaceAll("_", " ")),
    ),
  };
}
export type ProviderRequestObservation = {
  stage: InspectionStage;
  httpStatus: number;
  jsonBody: boolean;
  hasError: boolean;
  providerOk: boolean | null;
  /** Constant-only error observations; never used to relax a failed readiness check. */
  providerError?: ProviderErrorObservation;
};
export type EnquiryForwardingProviderInspection = {
  schemaVersion: 1;
  checkedAt: string;
  /** Configuration readiness only; never delivery or phone ownership verification. */
  ready: boolean;
  /** Separate informational policy; legacy capability flags and ready remain unchanged. */
  infoForwarding?: EnquiryInfoReadiness;
  flags: {
    woztellEnabled: boolean;
    staffNotificationsEnabled: boolean;
    serviceAutomationEnabled: boolean;
    enquiryMode: "off" | "observe" | "active" | "invalid";
    botAccessTokenPresent: boolean;
    openApiTokenPresent: boolean;
    channelSecretPresent: boolean;
    cloudAccessTokenPresent?: boolean;
  };
  /** Selected only after channel/app scope checks; presence/source does not verify validity. */
  cloudAccessTokenSource?: "configured" | "channel_integration" | "unavailable";
  /** Boolean-only credential diagnostics. A comparison probe never establishes readiness. */
  tokenDiagnostics?: {
    configuredOuterWhitespace: boolean;
    configuredQuoted: boolean;
    configuredBearerPrefix: boolean;
    configuredInternalWhitespace: boolean;
    channelTokenPresent: boolean;
    configuredMatchesChannelToken: boolean | null;
    comparisonAttempted: boolean;
    comparisonSenderVerified: boolean;
    wabaComparisonAttempted?: boolean;
    wabaComparisonVerified?: boolean;
    wabaComparisonCompanyPhoneMatches?: boolean;
  };
  /** Presence of existing references, not newly manufactured verification. */
  capabilities: {
    whatsappVerification: boolean;
    correlationVerification: boolean;
    associationReview: boolean;
    replyContext: boolean;
  };
  channel: {
    appId?: string | null;
    configuredChannelId: string | null;
    connected: boolean | null;
    archived: boolean | null;
    archiveProof: ChannelArchiveProof | null;
    senderPhone: string | null;
    companyPhoneMatches: boolean | null;
    senderDifferentFromFixedCopy: boolean | null;
    proofHash: string | null;
  };
  credentialInspection?: ReturnType<typeof inspectCredential>;
  tokenProbe?: {
    attempted: boolean;
    distinctFromConfigured: boolean | null;
    senderVerified: boolean;
    companyPhoneMatches: boolean;
    expectedWabaMatches: boolean;
    templatesReadable: boolean | null;
    templateListed: boolean | null;
    templateLanguageApproved: boolean | null;
  };
  phoneProbe?: {
    attempted: boolean;
    profileAttempted: boolean;
    profileValidEnvelope: boolean | null;
    profileHasVertical: boolean | null;
    profileHasWebsites: boolean | null;
    signatureObtained: boolean;
    displayStatusAttempted: boolean;
    displayStatusValidEnvelope: boolean | null;
    displayStatusPhoneMatchesCompany: boolean | null;
    displayStatusIdMatchesConfigured: boolean | null;
    displayStatusAccountModeLive: boolean | null;
    displayStatusVerifiedNamePresent: boolean | null;
  };
  identityInspection?: {
    queried: boolean;
    refused: boolean;
    infoKeyMembers: (typeof INFO_KEY_ALLOWLIST)[number][];
    wabaInfoPresent: boolean | null;
    wabaInfoHasWabaId: boolean | null;
    wabaInfoHasPhoneNumberId: boolean | null;
    wabaInfoHasPhoneNumber: boolean | null;
    wabaInfoHasNamespace: boolean | null;
    wabaInfoHasName: boolean | null;
    configuredWabaMatches: boolean | null;
    companyPhoneMatches: boolean | null;
    wabaStatusPresent: boolean | null;
    wabaStatusConnectedLike: boolean | null;
    wabaErrorPresent: boolean | null;
    wabaIntegrationPresent: boolean | null;
    wabaIntegrationHasId: boolean | null;
    wabaIntegrationHasNamespace: boolean | null;
    wabaIntegrationHasName: boolean | null;
  };
  versionProbe?: {
    attempted: boolean;
    senderVerified: boolean;
    companyPhoneMatches: boolean;
    expectedWabaMatches: boolean;
  };
  templateProbe?: {
    attempted: boolean;
    validResponse: boolean;
    configuredTemplateListed: boolean;
    configuredLanguageApproved: boolean;
  };
  environmentConfiguration?: {
    enabled: boolean | null;
    installed: boolean | null;
    subscribed: boolean | null;
    bindingMatches: boolean | null;
    buildMatches: boolean | null;
    configuredWabaMatches: boolean | null;
  }[];
  integrationInspection: {
    attempted: boolean;
    checked: boolean;
    complete: boolean;
    environmentCount: number;
    cloudIntegrationCount: number;
    otherIntegrationCount: number;
    unknownIntegrationCount: number;
    /** Enumerating environments does not establish the selected live environment. */
    selectedEnvironmentVerified: false;
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
    /** Server-validated protected release/schema evidence, never request-body flags. */
    informationalInstallation?: EnquiryInfoInstallationEvidence | null;
  } = {},
): Promise<EnquiryForwardingProviderInspection> {
  const env = options.env ?? process.env;
  const configuredCloudToken = present(env.WOZTELL_CLOUD_ACCESS_TOKEN)
    ? env.WOZTELL_CLOUD_ACCESS_TOKEN.trim()
    : null;
  const secrets = new Set(
    Object.entries(env)
      .filter(
        ([key, value]) =>
          /TOKEN|SECRET|SIGNATURE|VERIFICATION_REF|REVIEW_REF/.test(key) && present(value),
      )
      .map(([, value]) => value as string),
  );
  if (configuredCloudToken) secrets.add(configuredCloudToken);
  const sensitiveText = (value: string) =>
    [...secrets].some((secret) => secret.length >= 4 && value.includes(secret));
  const reasons = new Set<string>();
  const correlation = staffCorrelationPlan(env);
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
      cloudAccessTokenPresent: configuredCloudToken !== null,
    },
    cloudAccessTokenSource: "unavailable",
    capabilities: {
      whatsappVerification: present(env.EP_WA_STAFF_WHATSAPP_VERIFICATION_REF),
      correlationVerification: present(env.EP_WA_STAFF_CORRELATION_VERIFICATION_REF),
      associationReview: present(env.EP_WA_STAFF_ASSOCIATION_REVIEW_REF),
      replyContext: present(env.EP_WA_STAFF_REPLY_CONTEXT_PATH),
    },
    channel: {
      appId: null,
      configuredChannelId: channelId,
      connected: null,
      archived: null,
      archiveProof: null,
      senderPhone: null,
      companyPhoneMatches: null,
      senderDifferentFromFixedCopy: null,
      proofHash: null,
    },
    integrationInspection: {
      attempted: false,
      checked: false,
      complete: false,
      environmentCount: 0,
      cloudIntegrationCount: 0,
      otherIntegrationCount: 0,
      unknownIntegrationCount: 0,
      selectedEnvironmentVerified: false,
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
  // Strict mode needs a verified quote path; member-id mode waives only the provider field
  // that the recorded webhook payloads never contain (see staff-correlation-mode.mjs).
  if (
    !report.capabilities.whatsappVerification ||
    !report.capabilities.associationReview ||
    !correlation.ready
  )
    reasons.add("CAPABILITY_REFERENCES_MISSING");
  if (!configured) reasons.add("STAFF_TEMPLATE_SELECTION_REQUIRED");
  const finish = () => {
    report.ready =
      reasons.size === 0 &&
      report.flags.woztellEnabled &&
      report.flags.staffNotificationsEnabled &&
      report.flags.botAccessTokenPresent &&
      report.flags.channelSecretPresent &&
      report.capabilities.whatsappVerification &&
      report.capabilities.associationReview &&
      correlation.ready &&
      report.channel.connected === true &&
      channelArchiveVerified(report.channel) &&
      report.channel.companyPhoneMatches === true &&
      report.channel.senderDifferentFromFixedCopy === true &&
      report.template.configuredApproved &&
      report.template.validationComplete;
    report.infoForwarding = deriveEnquiryInfoReadiness(report, options.informationalInstallation);
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
      if (clean.infoForwarding) {
        clean.infoForwarding.ready = false;
        clean.infoForwarding.reasonCodes.push("SENSITIVE_PROVIDER_CONTENT_REDACTED");
      }
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
        ...(body.error != null || array(body.errors).length > 0
          ? { providerError: observeProviderError(body.error ?? array(body.errors)[0], secrets) }
          : {}),
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
  report.channel.appId = identifier(channel.appId);
  if (present(channel.appIntegrationAccessToken)) secrets.add(channel.appIntegrationAccessToken);
  const cloudToken =
    configuredCloudToken ??
    (present(channel.appIntegrationAccessToken) ? channel.appIntegrationAccessToken : null);
  report.cloudAccessTokenSource = configuredCloudToken
    ? "configured"
    : cloudToken
      ? "channel_integration"
      : "unavailable";
  const channelToken = present(channel.appIntegrationAccessToken)
    ? channel.appIntegrationAccessToken.trim()
    : null;
  report.tokenDiagnostics = {
    configuredOuterWhitespace:
      typeof env.WOZTELL_CLOUD_ACCESS_TOKEN === "string" &&
      env.WOZTELL_CLOUD_ACCESS_TOKEN !== env.WOZTELL_CLOUD_ACCESS_TOKEN.trim(),
    configuredQuoted: configuredCloudToken !== null && /^["']|["']$/.test(configuredCloudToken),
    configuredBearerPrefix:
      configuredCloudToken !== null && /^Bearer\s/i.test(configuredCloudToken),
    configuredInternalWhitespace: configuredCloudToken !== null && /\s/.test(configuredCloudToken),
    channelTokenPresent: channelToken !== null,
    configuredMatchesChannelToken:
      configuredCloudToken && channelToken ? configuredCloudToken === channelToken : null,
    comparisonAttempted: false,
    comparisonSenderVerified: false,
  };
  if (channelToken) secrets.add(channelToken);
  report.channel.connected = typeof channel.connected === "boolean" ? channel.connected : null;
  report.channel.archived = typeof channel.archived === "boolean" ? channel.archived : null;
  // A declared live-delivery proof only stands in when the channel is actually connected.
  report.channel.archiveProof =
    report.channel.archived === false ||
    report.channel.archived === true ||
    report.channel.connected !== true
      ? null
      : channelArchiveProof(env);
  if (report.channel.connected === false) reasons.add("PROVIDER_CHANNEL_NOT_CONNECTED");
  else if (report.channel.connected !== true)
    reasons.add("PROVIDER_CHANNEL_CONNECTION_STATUS_UNKNOWN");
  if (report.channel.archived === true) reasons.add("PROVIDER_CHANNEL_ARCHIVED");
  else if (!channelArchiveVerified(report.channel))
    reasons.add("PROVIDER_CHANNEL_ARCHIVE_STATUS_UNKNOWN");
  let cloudEnvironmentId: string | null = null;
  async function inspectChannelIntegrations() {
    report.integrationInspection.attempted = true;
    const body = await open(
      CHANNEL_INTEGRATIONS_QUERY,
      { app: env.WOZTELL_APP_ID, channel: channelId },
      "CHANNEL_INTEGRATIONS",
    );
    if (!body || array(body.errors).length) return;
    const metadata = row(row(row(body.data).apiViewer).channel);
    if (
      metadata._id !== channelId ||
      metadata.appId !== channel.appId ||
      !Array.isArray(metadata.environments)
    )
      return;
    report.integrationInspection.checked = true;
    if (metadata.environments.length > 20) return;
    const seen = new Set<string>();
    const environments: { envId: string; integrationId: string | null }[] = [];
    for (const value of metadata.environments) {
      const entry = row(value),
        envId = identifier(entry.envId);
      if (!envId || seen.has(envId)) return;
      const integration = row(entry.integration);
      const integrationId =
        entry.integration === null ? null : identifier(integration.integrationId);
      if (entry.integration !== null && integration.integrationId !== null && !integrationId)
        return;
      seen.add(envId);
      environments.push({ envId, integrationId });
    }
    report.integrationInspection.environmentCount = environments.length;
    report.integrationInspection.cloudIntegrationCount = environments.filter(
      ({ integrationId }) => integrationId === "whatsapp-cloud",
    ).length;
    report.integrationInspection.unknownIntegrationCount = environments.filter(
      ({ integrationId }) => integrationId === null,
    ).length;
    report.integrationInspection.otherIntegrationCount =
      environments.length -
      report.integrationInspection.cloudIntegrationCount -
      report.integrationInspection.unknownIntegrationCount;
    report.integrationInspection.complete = true;
    const cloudEnvironments = metadata.environments
      .map(row)
      .filter((entry) => row(entry.integration).integrationId === "whatsapp-cloud");
    if (cloudEnvironments.length === 1) cloudEnvironmentId = identifier(cloudEnvironments[0].envId);
    report.environmentConfiguration = metadata.environments
      .map(row)
      .filter((entry) => row(entry.integration).integrationId === "whatsapp-cloud")
      .map((entry) => {
        const info = row(entry.info),
          integration = row(entry.integration);
        const bool = (value: unknown) => (typeof value === "boolean" ? value : null);
        const configuredWaba = env.WOZTELL_DIAGNOSTIC_WABA_ID;
        return {
          enabled: bool(entry.on),
          installed: bool(entry.integrationInstalled),
          subscribed: bool(info.subscribed),
          bindingMatches:
            present(info.appIntegrationId) && present(integration._id)
              ? info.appIntegrationId === integration._id
              : null,
          buildMatches:
            Number.isSafeInteger(info.build) && Number.isSafeInteger(integration.build)
              ? info.build === integration.build
              : null,
          configuredWabaMatches:
            present(info.wabaId) && present(configuredWaba) ? info.wabaId === configuredWaba : null,
        };
      });
    // Key names only, from a fixed allowlist; environment.info values are never retained.
    const observed = new Set<string>();
    for (const entry of metadata.environments.map(row)) {
      if (row(entry.integration).integrationId !== "whatsapp-cloud") continue;
      const info = row(entry.info);
      for (const key of INFO_KEY_ALLOWLIST) if (Object.hasOwn(info, key)) observed.add(key);
    }
    report.identityInspection = {
      ...(report.identityInspection ?? emptyIdentityInspection()),
      infoKeyMembers: INFO_KEY_ALLOWLIST.filter((key) => observed.has(key)),
    };
  }
  if (env.WOZTELL_DIAGNOSTIC_PROBE === "authentication") {
    // Dedicated one-shot comparison; do not repeat v1.2 or member/template reads.
    // The official authentication example uses v1.1 while the main endpoint is v1.2.
    // This is never an automatic fallback and cannot establish readiness.
    report.credentialInspection = inspectCredential(configuredCloudToken, env, channelId);
    report.versionProbe = {
      attempted: false,
      senderVerified: false,
      companyPhoneMatches: false,
      expectedWabaMatches: false,
    };
    reasons.add("AUTHENTICATION_DIAGNOSTIC_ONLY");
    if (configuredCloudToken) {
      const url = new URL("https://api.whatsapp-cloud.woztell.sanuker.com/v1.1/api/waba-info");
      url.searchParams.set("accessToken", configuredCloudToken);
      url.searchParams.set("channelId", channelId);
      report.versionProbe.attempted = true;
      const body = await request(url.toString(), { method: "GET" }, "SENDER_V1_1");
      const sender = row(body?.result);
      report.versionProbe.senderVerified =
        body?.ok === 1 &&
        phone(sender.phoneNumber) !== null &&
        identifier(sender.wabaId) !== null &&
        identifier(sender.phoneNumberId) !== null;
      report.versionProbe.companyPhoneMatches =
        report.versionProbe.senderVerified &&
        !!companyPhone &&
        phone(sender.phoneNumber) === companyPhone;
      report.versionProbe.expectedWabaMatches =
        report.versionProbe.senderVerified &&
        present(env.WOZTELL_DIAGNOSTIC_WABA_ID) &&
        sender.wabaId === env.WOZTELL_DIAGNOSTIC_WABA_ID;
    }
    await inspectChannelIntegrations();
    return finish();
  }
  if (env.WOZTELL_DIAGNOSTIC_PROBE === "identity") {
    // Deprecated-field inspection: presence and known-value comparisons only.
    // No WABA name, phone number, namespace, error text or account id is retained.
    report.identityInspection = emptyIdentityInspection();
    report.identityInspection.queried = true;
    reasons.add("IDENTITY_DIAGNOSTIC_ONLY");
    const body = await open(
      IDENTITY_QUERY,
      { app: env.WOZTELL_APP_ID, channel: channelId },
      "CHANNEL_IDENTITY",
    );
    await inspectChannelIntegrations();
    const identity = row(row(row(body?.data).apiViewer).channel);
    if (body && !array(body.errors).length && identity._id === channelId) {
      const scalar = (value: unknown) =>
        (typeof value === "string" && value.length > 0) ||
        (typeof value === "number" && Number.isFinite(value));
      const rawWabaInfo = identity.wabaInfo;
      let wabaInfo: Row = {};
      if (typeof rawWabaInfo === "string" && rawWabaInfo.length <= 8192) {
        try {
          wabaInfo = row(JSON.parse(rawWabaInfo));
        } catch {
          wabaInfo = {};
        }
      } else wabaInfo = row(rawWabaInfo);
      const status = typeof identity.wabaStatus === "string" ? identity.wabaStatus : null;
      const integration = row(identity.wabaIntegration);
      const expectedWaba = env.WOZTELL_DIAGNOSTIC_WABA_ID;
      const infoPhone = [
        wabaInfo.phoneNumber,
        wabaInfo.displayPhoneNumber,
        wabaInfo.formattedPhoneNumber,
        wabaInfo.waId,
      ]
        .map(phone)
        .find((value) => value !== null);
      report.identityInspection = {
        ...report.identityInspection,
        wabaInfoPresent: identity.wabaInfo !== null && identity.wabaInfo !== undefined,
        wabaInfoHasWabaId: scalar(wabaInfo.wabaId),
        wabaInfoHasPhoneNumberId: scalar(wabaInfo.phoneNumberId),
        wabaInfoHasPhoneNumber: infoPhone !== undefined,
        wabaInfoHasNamespace: scalar(wabaInfo.namespace),
        wabaInfoHasName: typeof wabaInfo.name === "string" && wabaInfo.name.length > 0,
        configuredWabaMatches:
          scalar(wabaInfo.wabaId) && present(expectedWaba)
            ? String(wabaInfo.wabaId) === expectedWaba
            : null,
        companyPhoneMatches:
          infoPhone !== undefined && !!companyPhone ? infoPhone === companyPhone : null,
        wabaStatusPresent: status !== null,
        wabaStatusConnectedLike:
          status === null ? null : /^(?:connected|active|verified|linked)$/i.test(status),
        wabaErrorPresent: typeof identity.wabaError === "string" && identity.wabaError.length > 0,
        wabaIntegrationPresent:
          identity.wabaIntegration !== null && identity.wabaIntegration !== undefined,
        wabaIntegrationHasId: scalar(integration.id) || scalar(integration._id),
        wabaIntegrationHasNamespace: scalar(integration.namespace),
        wabaIntegrationHasName: typeof integration.name === "string" && integration.name.length > 0,
      };
    } else report.identityInspection.refused = true;
    return finish();
  }
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
  if (!cloudToken) {
    reasons.add("CLOUD_CHANNEL_READ_TOKEN_UNAVAILABLE");
    return finish();
  }
  const cloudUrl = (
    path:
      | "waba-info"
      | "whatsapp-message-templates"
      | "whatsapp-business-profile"
      | "whatsapp-displayname-status",
    params: Record<string, string>,
  ) => {
    const url = new URL(path, CLOUD_API);
    url.searchParams.set("accessToken", cloudToken);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  };
  if (present(env.WOZTELL_DIAGNOSTIC_CLOUD_TOKEN)) {
    // Operator-supplied second credential, compared read-only. It is never a fallback for the
    // production credential, never a sending credential, and never relaxes a readiness gate.
    reasons.add("TOKEN_DIAGNOSTIC_ONLY");
    const supplied = env.WOZTELL_DIAGNOSTIC_CLOUD_TOKEN.trim();
    report.tokenProbe = {
      attempted: true,
      distinctFromConfigured:
        supplied && configuredCloudToken ? supplied !== configuredCloudToken : null,
      senderVerified: false,
      companyPhoneMatches: false,
      expectedWabaMatches: false,
      templatesReadable: null,
      templateListed: null,
      templateLanguageApproved: null,
    };
    await inspectChannelIntegrations();
    if (supplied) {
      const withToken = (
        path: "waba-info" | "whatsapp-message-templates",
        params: Record<string, string>,
      ) => {
        const url = new URL(cloudUrl(path, params));
        url.searchParams.set("accessToken", supplied);
        return url.toString();
      };
      const body = await request(
        withToken("waba-info", { channelId }),
        { method: "GET" },
        "SENDER_DIAGNOSTIC_TOKEN",
      );
      const sender = row(body?.result);
      const senderPhone = phone(sender.phoneNumber);
      const senderWaba = identifier(sender.wabaId);
      report.tokenProbe.senderVerified =
        body?.ok === 1 &&
        senderPhone !== null &&
        senderWaba !== null &&
        identifier(sender.phoneNumberId) !== null;
      report.tokenProbe.companyPhoneMatches =
        report.tokenProbe.senderVerified && !!companyPhone && senderPhone === companyPhone;
      report.tokenProbe.expectedWabaMatches =
        report.tokenProbe.senderVerified &&
        present(env.WOZTELL_DIAGNOSTIC_WABA_ID) &&
        senderWaba === env.WOZTELL_DIAGNOSTIC_WABA_ID;
      if (report.tokenProbe.senderVerified && senderWaba) {
        const params: Record<string, string> = { wabaId: senderWaba, first: "10" };
        if (configured) params.name = configured.name;
        const templates = await request(
          withToken("whatsapp-message-templates", params),
          { method: "GET" },
          "TEMPLATES_DIAGNOSTIC_TOKEN",
        );
        const valid = templates?.ok === 1 && Array.isArray(templates.data);
        report.tokenProbe.templatesReadable = valid;
        if (valid && configured) {
          const matches = array(templates?.data)
            .map(row)
            .filter((item) => item.name === configured.name);
          report.tokenProbe.templateListed = matches.length > 0;
          report.tokenProbe.templateLanguageApproved = matches.some((item) =>
            array(item.statuses)
              .map(row)
              .some(
                (status) =>
                  status.language === configured?.language && status.status === "APPROVED",
              ),
          );
        }
      }
    }
  }
  if (env.WOZTELL_DIAGNOSTIC_PROBE === "phone") {
    // Endpoints keyed by phoneNumberId instead of channelId/wabaId. Read-only; never a
    // fallback, never grants readiness, and no returned text or phone number is retained.
    reasons.add("PHONE_DIAGNOSTIC_ONLY");
    const configuredPhoneNumberId = env.WOZTELL_DIAGNOSTIC_PHONE_NUMBER_ID;
    const phoneNumberId =
      typeof configuredPhoneNumberId === "string" && /^\d{5,30}$/.test(configuredPhoneNumberId)
        ? configuredPhoneNumberId
        : null;
    report.phoneProbe = {
      attempted: phoneNumberId !== null,
      profileAttempted: false,
      profileValidEnvelope: null,
      profileHasVertical: null,
      profileHasWebsites: null,
      signatureObtained: false,
      displayStatusAttempted: false,
      displayStatusValidEnvelope: null,
      displayStatusPhoneMatchesCompany: null,
      displayStatusIdMatchesConfigured: null,
      displayStatusAccountModeLive: null,
      displayStatusVerifiedNamePresent: null,
    };
    await inspectChannelIntegrations();
    if (phoneNumberId) {
      report.phoneProbe.profileAttempted = true;
      const profile = await request(
        cloudUrl("whatsapp-business-profile", { phoneNumberId }),
        { method: "GET" },
        "BUSINESS_PROFILE",
      );
      const profileData = row(profile?.data);
      report.phoneProbe.profileValidEnvelope = profile?.ok === 1;
      report.phoneProbe.profileHasVertical = typeof profileData.vertical === "string";
      report.phoneProbe.profileHasWebsites = Array.isArray(profileData.websites);
      if (cloudEnvironmentId) {
        const signatureBody = await open(
          SIGNATURE_QUERY,
          { app: env.WOZTELL_APP_ID, channel: channelId, env: cloudEnvironmentId },
          "CHANNEL_SIGNATURE",
        );
        const environment = row(row(row(row(signatureBody?.data).apiViewer).channel).environment);
        const signature = environment.appIntegrationSignature;
        const appIntegration = identifier(row(environment.integration)._id);
        if (
          present(signature) &&
          signature.length <= 4096 &&
          appIntegration &&
          environment.envId === cloudEnvironmentId &&
          !array(signatureBody?.errors).length
        ) {
          secrets.add(signature);
          report.phoneProbe.signatureObtained = true;
          report.phoneProbe.displayStatusAttempted = true;
          const payload = JSON.stringify({
            app: channel.appId,
            appIntegration,
            channel: channelId,
          });
          const status = await request(
            cloudUrl("whatsapp-displayname-status", { phoneNumberId }),
            {
              method: "GET",
              headers: {
                "X-Woztell-Payload": payload,
                "X-Woztell-SignedContext": `${signature}.${Buffer.from(payload).toString("base64")}`,
              },
            },
            "DISPLAYNAME_STATUS",
          );
          const data = row(status?.data);
          const displayPhone = phone(data.display_phone_number);
          report.phoneProbe.displayStatusValidEnvelope = status?.ok === 1;
          report.phoneProbe.displayStatusPhoneMatchesCompany =
            status?.ok === 1 && displayPhone !== null && companyPhone !== null
              ? displayPhone === companyPhone
              : null;
          report.phoneProbe.displayStatusIdMatchesConfigured =
            status?.ok === 1 ? String(data.id ?? "") === phoneNumberId : null;
          report.phoneProbe.displayStatusAccountModeLive =
            status?.ok === 1 ? data.account_mode === "LIVE" : null;
          report.phoneProbe.displayStatusVerifiedNamePresent =
            status?.ok === 1
              ? typeof data.verified_name === "string" && data.verified_name.length > 0
              : null;
        }
      }
    }
    return finish();
  }
  const senderBody = await request(
    cloudUrl("waba-info", { channelId }),
    { method: "GET" },
    "SENDER",
  );
  if (!senderBody) {
    const senderObservation = report.requests.find((entry) => entry.stage === "SENDER");
    const diagnosticWabaId = env.WOZTELL_DIAGNOSTIC_WABA_ID;
    if (
      typeof diagnosticWabaId === "string" &&
      /^\d{5,30}$/.test(diagnosticWabaId) &&
      senderObservation?.providerError?.signals.includes("permission_denied")
    ) {
      if (env.WOZTELL_DIAGNOSTIC_PROBE === "templates") {
        const params: Record<string, string> = { wabaId: diagnosticWabaId, first: "10" };
        if (configured) params.name = configured.name;
        const templates = await request(
          cloudUrl("whatsapp-message-templates", params),
          { method: "GET" },
          "TEMPLATES_WABA_ID",
        );
        const validResponse = templates?.ok === 1 && Array.isArray(templates.data);
        const matches =
          validResponse && configured
            ? array(templates?.data)
                .map(row)
                .filter((item) => item.name === configured.name)
            : [];
        report.templateProbe = {
          attempted: true,
          validResponse,
          configuredTemplateListed: matches.length > 0,
          configuredLanguageApproved: matches.some((item) =>
            array(item.statuses)
              .map(row)
              .some(
                (status) =>
                  status.language === configured?.language && status.status === "APPROVED",
              ),
          ),
        };
      } else {
        report.tokenDiagnostics.wabaComparisonAttempted = true;
        const comparison = await request(
          cloudUrl("waba-info", { wabaId: diagnosticWabaId }),
          { method: "GET" },
          "SENDER_WABA_ID",
        );
        const result = row(comparison?.result);
        report.tokenDiagnostics.wabaComparisonVerified =
          comparison?.ok === 1 &&
          result.wabaId === diagnosticWabaId &&
          phone(result.phoneNumber) !== null &&
          identifier(result.phoneNumberId) !== null;
        report.tokenDiagnostics.wabaComparisonCompanyPhoneMatches =
          report.tokenDiagnostics.wabaComparisonVerified &&
          !!companyPhone &&
          phone(result.phoneNumber) === companyPhone;
      }
    } else if (
      configuredCloudToken &&
      channelToken &&
      configuredCloudToken !== channelToken &&
      senderObservation?.providerError?.signals.includes("permission_denied")
    ) {
      // Same verified channel; different provider-issued credential. Never substitute this
      // diagnostic result for the configured sender proof or relax any readiness gate.
      report.tokenDiagnostics.comparisonAttempted = true;
      const comparisonUrl = new URL("waba-info", CLOUD_API);
      comparisonUrl.searchParams.set("accessToken", channelToken);
      comparisonUrl.searchParams.set("channelId", channelId);
      const comparison = await request(
        comparisonUrl.toString(),
        { method: "GET" },
        "SENDER_CHANNEL_TOKEN",
      );
      const result = row(comparison?.result);
      report.tokenDiagnostics.comparisonSenderVerified =
        comparison?.ok === 1 &&
        phone(result.phoneNumber) !== null &&
        identifier(result.wabaId) !== null &&
        identifier(result.phoneNumberId) !== null;
    }
    await inspectChannelIntegrations();
    return finish();
  }
  const sender = row(senderBody.result);
  const senderPhone = phone(sender.phoneNumber);
  const wabaId = identifier(sender.wabaId);
  if (senderBody.ok !== 1 || !senderPhone || !wabaId) {
    reasons.add("SENDER_PROOF_UNAVAILABLE");
    await inspectChannelIntegrations();
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
