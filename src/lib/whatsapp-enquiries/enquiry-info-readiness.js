import { isForwardingTemplate } from "../woztell/staff-alert-template.ts";

export const ENQUIRY_INFO_PURPOSE = "enq_forward_info";
export const ENQUIRY_INFO_POLICY_VERSION = 1;
export const ENQUIRY_INFO_SCHEMA_VERSION = "20261116010000_enquiry_information_scope";

const record = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const identifier = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
const sha = (value, length) =>
  typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const uuid = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

/**
 * Informational copies have their own evidence contract. This predicate does not
 * grant recipient permission and does not infer readiness from legacy references.
 * Installation facts must come from the server's protected release/schema reader.
 */
export function deriveEnquiryInfoReadiness(report, installation, sensitiveContentRejected = false) {
  const source = record(report);
  const flags = record(source.flags);
  const channel = record(source.channel);
  const template = record(source.template);
  const configured = record(template.configured);
  const installed = record(installation);
  const reasons = [];
  const requireFact = (condition, reason) => {
    if (!condition) reasons.push(reason);
  };

  requireFact(flags.woztellEnabled === true, "INFO_WOZTELL_DISABLED");
  requireFact(flags.staffNotificationsEnabled === true, "INFO_NOTIFICATIONS_DISABLED");
  requireFact(
    flags.enquiryMode === "observe" || flags.enquiryMode === "active",
    "INFO_INTAKE_MODE_UNAVAILABLE",
  );
  requireFact(
    flags.botAccessTokenPresent === true &&
      flags.openApiTokenPresent === true &&
      flags.channelSecretPresent === true,
    "INFO_RUNTIME_CREDENTIALS_UNAVAILABLE",
  );
  const appId = identifier(channel.appId);
  const channelId = identifier(channel.configuredChannelId);
  requireFact(!!appId && !!channelId, "INFO_CHANNEL_SCOPE_UNVERIFIED");
  requireFact(channel.connected === true, "INFO_CHANNEL_CONNECTION_UNVERIFIED");
  // `archived` is normally authoritative; a declared live-delivery proof substitutes only
  // when the provider omits the field (see channel-archive-proof.js).
  requireFact(
    channel.archived === false ||
      (channel.archived !== true && record(channel.archiveProof).mode === "live_delivery"),
    "INFO_CHANNEL_ARCHIVE_UNVERIFIED",
  );
  requireFact(
    channel.companyPhoneMatches === true &&
      channel.senderDifferentFromFixedCopy === true &&
      typeof channel.senderPhone === "string" &&
      /^852[2-9]\d{7}$/.test(channel.senderPhone) &&
      channel.senderPhone !== "85297987774" &&
      sha(channel.proofHash, 64),
    "INFO_SENDER_UNVERIFIED",
  );

  const mappingValid =
    typeof configured.name === "string" &&
    /^[a-z0-9_]{1,512}$/.test(configured.name) &&
    typeof configured.language === "string" &&
    /^[a-z]{2,3}(_[A-Z]{2})?$/.test(configured.language) &&
    Array.isArray(configured.params) &&
    configured.params.every((param) => typeof param === "string") &&
    isForwardingTemplate(configured);
  const candidates = Array.isArray(template.candidates) ? template.candidates : [];
  const approved = candidates
    .map(record)
    .filter(
      (candidate) =>
        candidate.name === configured.name &&
        candidate.language === configured.language &&
        mappingValid &&
        candidate.paramCount === configured.params.length &&
        identifier(candidate.providerTemplateId) &&
        sha(candidate.proofHash, 64),
    );
  const proofs = new Set(approved.map((candidate) => candidate.proofHash));
  const templateProofHash = proofs.size === 1 ? approved[0].proofHash : null;
  requireFact(
    template.selectionRequired === false &&
      template.configuredApproved === true &&
      template.validationComplete === true &&
      mappingValid &&
      !!templateProofHash,
    "INFO_APPROVED_TEMPLATE_UNVERIFIED",
  );

  requireFact(
    installed.purpose === ENQUIRY_INFO_PURPOSE &&
      installed.version === ENQUIRY_INFO_POLICY_VERSION &&
      installed.schemaVersion === ENQUIRY_INFO_SCHEMA_VERSION &&
      installed.schemaAvailable === true &&
      installed.receiptAdmissionVersion === ENQUIRY_INFO_POLICY_VERSION &&
      installed.neutralHoldVersion === ENQUIRY_INFO_POLICY_VERSION &&
      installed.templateTransportVersion === ENQUIRY_INFO_POLICY_VERSION,
    "INFO_POLICY_INSTALLATION_UNVERIFIED",
  );
  requireFact(
    !!appId &&
      !!channelId &&
      installed.appId === appId &&
      installed.channelId === channelId &&
      sha(installed.runtimeBuildSha, 40) &&
      installed.verifiedBuildSha === installed.runtimeBuildSha &&
      uuid(installed.releaseAuditId),
    "INFO_RELEASE_SCOPE_UNVERIFIED",
  );
  requireFact(sensitiveContentRejected !== true, "SENSITIVE_PROVIDER_CONTENT_REDACTED");

  return {
    purpose: ENQUIRY_INFO_PURPOSE,
    version: ENQUIRY_INFO_POLICY_VERSION,
    appId,
    channelId,
    ready: reasons.length === 0,
    reasonCodes: reasons,
    channelProofHash: sha(channel.proofHash, 64) ? channel.proofHash : null,
    templateProofHash,
    releaseAuditId: uuid(installed.releaseAuditId) ? installed.releaseAuditId : null,
    /** A reviewed receiving purpose is distinct from registration or delivery. */
    provesWhatsappRegistration: false,
    provesDelivery: false,
  };
}
