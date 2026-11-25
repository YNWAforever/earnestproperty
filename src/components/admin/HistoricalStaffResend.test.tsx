import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

function unexpectedAction(): never {
  throw new Error("Rendering a review must not request or submit a notification");
}
mock.module("@/lib/neon/historical-resend", () => ({
  fetchHistoricalRecipients: unexpectedAction,
  reviewHistoricalRecipient: unexpectedAction,
  sendHistoricalNotification: unexpectedAction,
}));
const { HistoricalApproval, HistoricalStaffResend } = await import("./HistoricalStaffResend");
const defaults = {
  ready: true,
  checked: false,
  busy: false,
  previewOnly: false,
  onCheck: unexpectedAction,
  onSend: unexpectedAction,
};
const render = (props: Partial<typeof defaults>) =>
  renderToStaticMarkup(createElement(HistoricalApproval, { ...defaults, ...props }));
test("opening the panel leaves historic leads and send controls behind review", () => {
  const html = renderToStaticMarkup(
    createElement(HistoricalStaffResend, { isWorkspaceCurrent: () => true }),
  );
  expect(html).toContain("查看待核對通知");
  expect(html).not.toContain('type="checkbox"');
});
test("only an approved production recipient gets a confirmation control", () => {
  expect(render({ previewOnly: true, checked: true })).not.toContain("<button");
  expect(render({ ready: false, checked: true })).not.toContain("<button");
  expect(render({})).toMatch(/<button[^>]* disabled=""/);
  expect(render({ checked: true, busy: true })).toMatch(/<button[^>]* disabled=""/);
  expect(render({ checked: true })).not.toMatch(/<button[^>]* disabled=""/);
});
