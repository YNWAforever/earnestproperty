export const ENQUIRY_INFO_PURPOSE: "enq_forward_info";
export const ENQUIRY_INFO_POLICY_VERSION: 1;
export const ENQUIRY_INFO_SCHEMA_VERSION: "20261116010000_enquiry_information_scope";

/** Obtained only from the protected server release/schema validator, never client input. */
export type EnquiryInfoInstallationEvidence = {
  purpose: "enq_forward_info";
  version: 1;
  appId: string;
  channelId: string;
  schemaVersion: string;
  schemaAvailable: boolean;
  receiptAdmissionVersion: number;
  neutralHoldVersion: number;
  templateTransportVersion: number;
  runtimeBuildSha: string;
  verifiedBuildSha: string;
  releaseAuditId: string;
};

export type EnquiryInfoProviderFacts = {
  flags: {
    woztellEnabled: boolean;
    staffNotificationsEnabled: boolean;
    enquiryMode: string;
    botAccessTokenPresent: boolean;
    openApiTokenPresent: boolean;
    channelSecretPresent: boolean;
  };
  channel: {
    appId?: string | null;
    configuredChannelId: string | null;
    connected: boolean | null;
    archived: boolean | null;
    senderPhone: string | null;
    companyPhoneMatches: boolean | null;
    senderDifferentFromFixedCopy: boolean | null;
    proofHash: string | null;
  };
  template: {
    configured: { name: string; language: string; params: readonly string[] } | null;
    configuredApproved: boolean;
    selectionRequired: boolean;
    validationComplete: boolean;
    candidates: readonly {
      name: string;
      language: string;
      providerTemplateId: string;
      paramCount: number;
      proofHash: string;
    }[];
  };
};

export type EnquiryInfoReadiness = {
  purpose: "enq_forward_info";
  version: 1;
  appId: string | null;
  channelId: string | null;
  ready: boolean;
  reasonCodes: string[];
  channelProofHash: string | null;
  templateProofHash: string | null;
  releaseAuditId: string | null;
  provesWhatsappRegistration: false;
  provesDelivery: false;
};

export function deriveEnquiryInfoReadiness(
  report: EnquiryInfoProviderFacts | null | undefined,
  installation: EnquiryInfoInstallationEvidence | null | undefined,
  sensitiveContentRejected?: boolean,
): EnquiryInfoReadiness;
