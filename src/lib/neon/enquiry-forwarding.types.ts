export type EnquiryRecipientSetting = {
  key: string;
  kind: "copy" | "manager" | "sales";
  name: string;
  phone: string;
  version: number | null;
  enabled: boolean;
  verified: boolean;
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
};
export type EnquiryForwardingSettings = {
  available: boolean;
  recipients: EnquiryRecipientSetting[];
  routes: EnquiryEstateRouteSetting[];
  counts: Record<string, number>;
  recipientReadiness?: EnquiryRecipientReadiness;
  providerCheck: { ready: boolean; checkedAt: string | null; reasonCodes: string[] } | null;
};
