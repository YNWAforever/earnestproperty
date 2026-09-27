import { test, expect } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaffTestNotificationDialog } from "./StaffTestNotificationDialog";
import { StaffReadinessBadge } from "./StaffReadinessBadge";
import { StaffEndpointEditor } from "../StaffEndpointEditor";

const staffId = "10000000-0000-4000-8000-000000000001";
const previewButton = (transport: "inbox_private_note" | "staff_whatsapp") =>
  renderToStaticMarkup(
    createElement(StaffTestNotificationDialog, {
      staffId,
      transport,
      endpointVersion: 1,
    }),
  );
test("each transport has an explicit test action before any send", () => {
  expect(previewButton("inbox_private_note")).toContain("測試 Inbox 私有備註");
  expect(previewButton("staff_whatsapp")).toContain("測試同事 WhatsApp");
  expect(previewButton("inbox_private_note")).not.toContain("已送達");
});
test("readiness card links each repair reason to the correct step", () => {
  const html = renderToStaticMarkup(
    createElement(StaffReadinessBadge, {
      label: "Inbox 分派",
      capability: {
        state: "blocked",
        reasons: [
          {
            code: "mapping_missing",
            message: "尚未連接 Inbox 映射",
            actionHref: "/admin/whatsapp-settings?staffId=" + staffId + "&step=1",
          },
        ],
      },
    }),
  );
  expect(html).toContain('href="/admin/whatsapp-settings?staffId=');
  expect(html).toContain("尚未連接 Inbox 映射");
});
test("endpoint form derives company Channel rather than asking staff to type it", () => {
  const html = renderToStaticMarkup(
    createElement(StaffEndpointEditor, {
      agents: [{ id: staffId, name: "Synthetic", active: true }],
      selectedStaffId: staffId,
    }),
  );
  expect(html).not.toContain("公司頻道 ID");
  expect(html).toContain("私有 Inbox 備註");
  expect(html).toContain("同事 WhatsApp");
});
