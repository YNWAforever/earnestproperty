export type CapabilityState = "ready" | "blocked" | "unknown";
export type ReadinessReason = { code: string; message: string; actionHref?: string };
export type Capability = { state: CapabilityState; reasons: ReadinessReason[] };

export type StaffWhatsappReadiness = {
  staffId: string;
  displayName: string;
  active: boolean;
  assignment: Capability;
  inboxPrivateNote: Capability;
  staffWhatsapp: Capability;
  maskedDestination: string | null;
  mappingVersion: number | null;
  endpointVersion: number | null;
  checkedAt: string;
};

export type WhatsappRuntimeStatus = {
  mode: string;
  serviceEnabled: boolean;
  assignment: Capability;
  customerReply: Capability;
  staffWhatsappText: Capability;
  staffWhatsappTemplate: Capability;
  approvedPolicyVersion: number | null;
  checkedAt: string;
};

export type StaffMappingEvidence = {
  channelId: string;
  version: number;
  reviewBasis: "legacy_manual" | "provider_verified";
  reviewEnforced: boolean;
  reviewEvidenceId: string | null;
  eligible: boolean;
  verificationRef: string | null;
  verifiedAt: string | null;
  retiredAt: string | null;
  inboxUserId: string;
  folderId: string;
};

export type StaffEndpointEvidence = {
  channelId: string;
  version: number;
  mappingVersion?: number | null;
  transport: "inbox_private_note" | "staff_whatsapp";
  destinationReference: string;
  enabled: boolean;
  verifiedAt: string | null;
  retiredAt: string | null;
  permissionGranted: boolean;
  permissionRef: string | null;
  quietHoursApproved: boolean;
  lastInboundAt: string | null;
  templateName: string | null;
  templateLanguage: string | null;
  templateVerifiedAt: string | null;
};

export type StaffReadinessInput = {
  staffId: string;
  displayName: string;
  active: boolean;
  roles: string[];
  mapping: StaffMappingEvidence | null;
  inboxEndpoint: StaffEndpointEvidence | null;
  staffEndpoint: StaffEndpointEvidence | null;
  runtime: {
    channelId: string | null;
    assignmentEnabled: boolean;
    notificationsEnabled: boolean;
    staffWhatsAppEnabled: boolean;
    inboxProviderVerified: boolean;
    staffTransportVerified: boolean;
    templateContractVerified: boolean;
  };
  checkedAt: string;
};
