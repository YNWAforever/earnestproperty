import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  canSaveReviewedMapping,
  switchWizardStaff,
  applyMappingConflict,
  parseWhatsappSettingsSearch,
} from "./staff-mapping-wizard-state";
import { InboxAccountPicker } from "./InboxAccountPicker";
import { StaffMappingWizard } from "./StaffMappingWizard";
import { StaffConnectionSummary } from "./StaffConnectionSummary";

const staffId = "10000000-0000-4000-8000-000000000001";
const otherStaffId = "10000000-0000-4000-8000-000000000002";
const review = {
  evidenceId: "20000000-0000-4000-8000-000000000001",
  result: "verified" as const,
  expiresAt: "2026-09-27T12:05:00.000Z",
  reasons: [],
};
test("same display name still requires an exact Inbox account selection", () => {
  const html = renderToStaticMarkup(
    createElement(InboxAccountPicker, {
      items: [
        {
          userId: "provider-user-1111",
          displayName: "Alex",
          email: "one@example.test",
          channelId: "company",
          role: "AGENT",
        },
        {
          userId: "provider-user-2222",
          displayName: "Alex",
          email: "two@example.test",
          channelId: "company",
          role: "AGENT",
        },
      ],
      selectedUserId: "",
      onSelect: () => {},
      query: "",
      onQueryChange: () => {},
      onSearch: () => {},
      onNextPage: () => {},
      nextCursor: null,
      busy: false,
    }),
  );
  expect(html).toContain("one@example.test");
  expect(html).toContain("two@example.test");
  expect(html).toContain("選擇 Inbox 帳戶");
  expect(html).not.toContain("實際 Inbox User ID");
});
test("staff switch clears previous provider selection and evidence", () => {
  const state = {
    staffId,
    userId: "provider-user-1111",
    folderKey: "main",
    review,
    dirty: true,
  };
  const switched = switchWizardStaff(state, otherStaffId);
  expect(switched).toEqual({
    staffId: otherStaffId,
    userId: "",
    folderKey: "",
    review: null,
    dirty: false,
  });
});
test("only current verified evidence can enable reviewed mapping; conflict preserves selection", () => {
  const state = { staffId, userId: "provider-user-1111", folderKey: "main", review, dirty: true };
  expect(canSaveReviewedMapping(state, 1, 1, "2026-09-27T12:00:00.000Z")).toBe(true);
  expect(canSaveReviewedMapping({ ...state, review: null }, 1, 1, "2026-09-27T12:00:00.000Z")).toBe(
    false,
  );
  expect(canSaveReviewedMapping(state, 1, 2, "2026-09-27T12:00:00.000Z")).toBe(false);
  expect(canSaveReviewedMapping(state, 1, 1, "2026-09-27T12:06:00.000Z")).toBe(false);
  const conflict = applyMappingConflict(state, 2);
  expect(conflict.userId).toBe(state.userId);
  expect(conflict.folderKey).toBe(state.folderKey);
  expect(conflict.review).toBeNull();
});
test("validated settings search accepts only local staff, step and opaque draft ID", () => {
  expect(parseWhatsappSettingsSearch({ staffId, step: "2", draftId: review.evidenceId })).toEqual({
    staffId,
    step: 2,
    draftId: review.evidenceId,
  });
  expect(
    parseWhatsappSettingsSearch({ staffId: "https://external.test", step: "99", draftId: "../x" }),
  ).toEqual({});
});
test("summary labels unverified state and keeps provider IDs in advanced details", () => {
  const html = renderToStaticMarkup(
    createElement(StaffConnectionSummary, {
      mapping: null,
      review: null,
      candidate: null,
      folder: null,
    }),
  );
  expect(html).toContain("未核實");
  expect(html).not.toContain("可接單");
});

test("first step names local staff with email and branch without provider inputs", () => {
  const html = renderToStaticMarkup(
    createElement(StaffMappingWizard, {
      agents: [
        { id: staffId, name: "Haze", email: "haze@example.test", branch: "Central", active: true },
      ],
    }),
  );
  expect(html).toContain("haze@example.test");
  expect(html).toContain("Central");
  expect(html).toContain("選擇在職同事");
  expect(html).not.toContain("實際 Inbox User ID");
});

test("reviewed mapping save has no feature-flag guard", () => {
  // The step-1 save button only mounts after the async folder load, which a static render cannot
  // reach, so assert the save path carries no feature-flag guard and the wizard takes no such prop.
  // Behavioural proof: e2e/admin-staff-setup.spec.ts "four steps save no send and fresh mapping
  // readback keeps phone separate" saves a valid mapping with no flag set.
  const source = readFileSync(new URL("./StaffMappingWizard.tsx", import.meta.url), "utf8");
  expect(source).not.toContain("allowReviewedSave");
  expect(source).not.toContain("核實映射的儲存功能尚未啟用");
});
