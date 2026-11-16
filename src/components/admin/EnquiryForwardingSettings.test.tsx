import { describe, expect, mock, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { EnquiryForwardingSettings as Settings } from "@/lib/neon/enquiry-forwarding.types";

const actualReact = { ...React };
let currentSettings: Settings | null = null;
let rendering = false;
mock.module("react", () => ({
  ...actualReact,
  useState: (initial: unknown) =>
    rendering && initial === null
      ? [
          currentSettings,
          () => {
            throw Error("Static render cannot mutate settings");
          },
        ]
      : actualReact.useState(initial),
}));
const noRequest = () => {
  throw Error("Static UI cannot request or activate delivery");
};
mock.module("@/lib/neon/enquiry-forwarding", () => ({
  fetchEnquiryForwardingSettings: noRequest,
  requestEnquiryForwardingCheck: noRequest,
  updateEnquiryForwardingEnabled: noRequest,
  fetchEnquiryIdentityReview: noRequest,
  reviewEnquiryPhonePurpose: noRequest,
  resolveEnquiryHeldReply: noRequest,
}));
const { EnquiryForwardingSettings } = await import("./EnquiryForwardingSettings");
const base = (): Settings => ({
  available: true,
  recipients: [
    {
      key: "copy",
      kind: "copy",
      name: "固定副本",
      phone: "85297987774",
      version: 2,
      enabled: false,
      verified: false,
      purposeReviewed: true,
      memberAssociated: false,
    },
    {
      key: "sales:owned",
      kind: "sales",
      name: "Owned colleague",
      phone: "85292786562",
      version: 1,
      enabled: false,
      verified: false,
      purposeReviewed: true,
      memberAssociated: false,
    },
  ],
  routes: [],
  counts: {},
  recipientReadiness: {
    checked: true,
    customerConflictRecipientKeys: [],
    distinctBlockedPhoneCount: 0,
  },
  informationalPolicy: {
    available: true,
    armed: false,
    scope: { appId: "owned-app", channelId: "owned-channel" },
  },
  providerCheck: { ready: true, checkedAt: "2026-01-01T00:00:00Z", reasonCodes: [] },
});
function render(value: Settings) {
  currentSettings = value;
  rendering = true;
  try {
    return renderToStaticMarkup(React.createElement(EnquiryForwardingSettings));
  } finally {
    rendering = false;
    currentSettings = null;
  }
}
const button = (html: string, label: string) => {
  const found = html.match(new RegExp(`<button[^>]*>${label}</button>`));
  expect(found).not.toBeNull();
  return found![0];
};

describe("informational forwarding settings", () => {
  test("reviewed phone purpose enables without claiming provider membership or registration", () => {
    const html = render(base());
    expect(button(html, "啟用新查詢通知")).not.toContain(' disabled=""');
    expect(html).toContain("通知用途已核對");
    expect(html).toContain("收件用途已核對");
    expect(html).not.toContain("身份關聯已核對");
    expect(html).not.toContain("已註冊");
    expect(html).not.toContain("未註冊");
  });
  test("only a genuine supplied member association is labelled separately", () => {
    const value = base();
    value.recipients[1].memberAssociated = true;
    const html = render(value);
    expect(html).toContain("身份關聯已核對");
    expect(html).toContain("通知用途已核對");
    expect(html).not.toContain("WhatsApp 已註冊");
  });
  test("missing installation, provider proof, unresolved overlap and revocation keep enable disabled", () => {
    const variants = [base(), base(), base(), base()];
    variants[0].informationalPolicy!.available = false;
    variants[1].providerCheck = {
      ready: false,
      checkedAt: null,
      reasonCodes: ["INFO_CHANNEL_ARCHIVE_UNVERIFIED"],
    };
    variants[2].recipientReadiness = {
      checked: true,
      customerConflictRecipientKeys: ["sales:owned"],
      distinctBlockedPhoneCount: 1,
    };
    variants[3].recipientReadiness = {
      checked: true,
      customerConflictRecipientKeys: [],
      revokedRecipientKeys: ["sales:owned"],
      distinctBlockedPhoneCount: 1,
    };
    for (const value of variants)
      expect(button(render(value), "啟用新查詢通知")).toContain(' disabled=""');
    expect(render(variants[1])).toContain("渠道封存狀態需要核對");
    expect(render(variants[3])).toContain("已撤回通知用途");
  });
  test("pause remains actionable while provider, schema and recipient readiness are unavailable", () => {
    const value = base();
    value.recipients[0].enabled = true;
    value.providerCheck = {
      ready: false,
      checkedAt: null,
      reasonCodes: ["INFO_POLICY_INSTALLATION_UNVERIFIED"],
    };
    value.informationalPolicy!.available = false;
    value.recipientReadiness!.checked = false;
    const html = render(value);
    expect(button(html, "暫停新查詢通知")).not.toContain(' disabled=""');
    expect(html).toContain("查詢通知用途設定尚未就緒");
  });
});
