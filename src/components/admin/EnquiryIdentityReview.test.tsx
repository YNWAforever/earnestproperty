import { expect, mock, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { EnquiryInfoReviewState } from "@/lib/neon/enquiry-info-review.types";
const noRequest = () => {
  throw Error("Rendering cannot perform authenticated actions");
};
mock.module("@/lib/neon/enquiry-forwarding", () => ({
  fetchEnquiryIdentityReview: noRequest,
  reviewEnquiryPhonePurpose: noRequest,
  resolveEnquiryHeldReply: noRequest,
  fetchEnquiryForwardingSettings: noRequest,
  requestEnquiryForwardingCheck: noRequest,
  updateEnquiryForwardingEnabled: noRequest,
}));
const { EnquiryIdentityReviewForm } = await import("./EnquiryIdentityReview");
const data = (): EnquiryInfoReviewState => ({
  phones: [
    {
      phone: "85292786562",
      names: ["Owned colleague"],
      eligible: true,
      state: "unreviewed",
      revision: 2,
      profileHash: "a".repeat(64),
      conflictHash: "b".repeat(64),
      customerConflictCount: 1,
      memberAssociated: false,
    },
  ],
  heldReplies: [
    {
      receiptId: "11111111-1111-4111-8111-111111111111",
      receivedAt: "2026-01-01T00:00:00Z",
      messageAt: "2026-01-01T00:00:00Z",
      text: "Actual original <script> message",
      fromPhone: null,
      expectedRevision: 1,
      expectedMemberRevision: 0,
      contactNames: ["Owned customer"],
      customerAllowed: true,
      staffAllowed: false,
      blockedReason: null,
    },
  ],
  heldCount: 1,
  hasMore: false,
});
const filled = {
  sourceReference: "Owned actual conversation checked",
  statement: "Owned manager confirms actual customer from that source.",
};
function props(
  kind: "phone" | "receipt" = "phone",
): React.ComponentProps<typeof EnquiryIdentityReviewForm> {
  const current = data();
  return {
    data: current,
    form: {
      kind,
      key: kind === "phone" ? current.phones[0].phone : current.heldReplies[0].receiptId,
      sourceReference: "",
      statement: "",
    },
    busy: false,
    error: "",
    notice: "",
    onForm: () => {},
    onAction: () => {
      throw Error("Render cannot submit a review");
    },
    onRefresh: () => {},
  };
}
const render = (value: ReturnType<typeof props>) =>
  renderToStaticMarkup(React.createElement(EnquiryIdentityReviewForm, value));
function button(html: string, label: string) {
  const found = html.match(new RegExp(`<button[^>]*>${label}</button>`));
  expect(found).not.toBeNull();
  return found![0];
}
test("human source and statement start empty and no phone review is submitted or enabled by render", () => {
  const html = render(props());
  expect(button(html, "確認通知用途")).toContain(' disabled=""');
  expect(button(html, "撤回通知用途")).toContain(' disabled=""');
  expect(html).toContain('aria-label="核對來源"');
  expect(html).toContain('value=""');
  expect(html).toContain('aria-label="核對內容"');
  expect(html).not.toContain("已註冊");
  expect(html).not.toContain("身份關聯已核對");
});
test("explicit source enables only eligible current phone actions and preserves changed-state visibility", () => {
  const value = props();
  value.form = { ...value.form, ...filled };
  let html = render(value);
  expect(button(html, "確認通知用途")).not.toContain(' disabled=""');
  expect(button(html, "撤回通知用途")).not.toContain(' disabled=""');
  value.data.phones[0].eligible = false;
  value.data.phones[0].state = "changed";
  html = render(value);
  expect(button(html, "確認通知用途")).toContain(' disabled=""');
  expect(html).toContain("收件資料已變更，須重新核對");
});
test("retired historical purpose permits only explicit revocation even if a stale view claims eligibility", () => {
  const value = props();
  value.form = { ...value.form, ...filled };
  value.data.phones[0].retired = true;
  value.data.phones[0].eligible = true;
  value.data.phones[0].state = "changed";
  const html = render(value);
  expect(html).toContain("歷史通知電話");
  expect(button(html, "確認通知用途")).toContain(' disabled=""');
  expect(button(html, "撤回通知用途")).not.toContain(' disabled=""');
});
test("customer release and staff association are separate and the original message stays escaped", () => {
  const value = props("receipt");
  value.form = { ...value.form, ...filled };
  const html = render(value);
  expect(button(html, "確認客戶並保存原回覆")).not.toContain(' disabled=""');
  expect(button(html, "確認同事回覆")).toContain(' disabled=""');
  expect(html).toContain("Actual original &lt;script&gt; message");
  expect(html).not.toContain("<script>");
  expect(html).toContain("Owned customer");
  expect(html).not.toContain("memberId");
});
test("unproven staff concern provides no staff escape and no false customer success", () => {
  const value = props("receipt");
  value.form = { ...value.form, ...filled };
  value.data.heldReplies[0].customerAllowed = false;
  value.data.heldReplies[0].blockedReason = "與同事通知電話有重疊，請先核對真實身份關聯。";
  value.error = "身份核對已記錄，但回覆仍未完成。請重新整理後核對。";
  const html = render(value);
  expect(button(html, "確認客戶並保存原回覆")).toContain(' disabled=""');
  expect(button(html, "確認同事回覆")).toContain(' disabled=""');
  expect(html).toContain('role="alert"');
  expect(html).toContain("回覆仍未完成");
  expect(html).not.toContain('role="status"');
  expect(html).toContain("未有可核實的同事身份關聯。");
});
test("genuine staff evidence enables only its explicit action after human source entry", () => {
  const value = props("receipt");
  value.data.heldReplies[0].staffAllowed = true;
  value.data.heldReplies[0].customerAllowed = false;
  expect(button(render(value), "確認同事回覆")).toContain(' disabled=""');
  value.form = { ...value.form, ...filled };
  expect(button(render(value), "確認同事回覆")).not.toContain(' disabled=""');
  expect(button(render(value), "確認客戶並保存原回覆")).toContain(' disabled=""');
});
test("failed-state refresh remains explicit and changing a selection clears prior review evidence", () => {
  const value = props();
  let refreshes = 0;
  value.error = "資料已變更，請重新整理。";
  value.form = { ...value.form, ...filled };
  value.onRefresh = () => {
    refreshes++;
  };
  let selected: unknown;
  value.onForm = (next) => {
    selected = next;
  };
  const tree = EnquiryIdentityReviewForm(value);
  function find(
    node: React.ReactNode,
    label: string,
  ): React.ReactElement<{ onClick: () => void }> | null {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = find(child, label);
        if (found) return found;
      }
      return null;
    }
    if (!React.isValidElement<{ children?: React.ReactNode; onClick?: () => void }>(node))
      return null;
    if (node.props.children === label && node.props.onClick)
      return node as React.ReactElement<{ onClick: () => void }>;
    return find(node.props.children, label);
  }
  expect(refreshes).toBe(0);
  find(tree, "重新整理")!.props.onClick();
  expect(refreshes).toBe(1);
  // The mode selector explicitly clears source and statement before another identity is reviewed.
  const root = tree.props.children as React.ReactElement<{ children: React.ReactNode }>[];
  const controls = root[0].props.children as React.ReactElement<{ onClick: () => void }>[];
  controls[1].props.onClick();
  expect(selected).toEqual({
    kind: "receipt",
    key: value.data.heldReplies[0].receiptId,
    sourceReference: "",
    statement: "",
  });
});
