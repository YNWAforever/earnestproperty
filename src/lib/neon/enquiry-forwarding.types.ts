export type EnquiryRecipientSetting = {
  key: string;
  kind: "copy" | "manager" | "sales";
  name: string;
  phone: string;
  version: number | null;
  enabled: boolean;
  verified: boolean;
  purposeReviewed?: boolean;
  memberAssociated?: boolean;
};
export type EnquiryEstateRouteSetting = {
  key: string;
  label: string;
  managerKey: string;
  version: number;
  enabled: boolean;
};
export type EnquiryRecipientReadiness = {
  checked: boolean;
  customerConflictRecipientKeys: string[];
  distinctBlockedPhoneCount: number;
  invalidRecipientKeys?: string[];
  revokedRecipientKeys?: string[];
};
export type EnquiryForwardingSettings = {
  available: boolean;
  recipients: EnquiryRecipientSetting[];
  routes: EnquiryEstateRouteSetting[];
  counts: Record<string, number>;
  recipientReadiness?: EnquiryRecipientReadiness;
  informationalPolicy?: {
    available: boolean;
    armed: boolean;
    scope: { appId: string; channelId: string } | null;
  };
  providerCheck: { ready: boolean; checkedAt: string | null; reasonCodes: string[] } | null;
};
