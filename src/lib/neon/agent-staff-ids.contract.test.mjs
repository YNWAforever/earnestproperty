import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// FX-17a fix round 1: no agent-callable path returns colleague staff ids or provider
// diagnostics. Every browser-callable module that admits agents is reviewed here; a new one fails
// this test until someone says what it returns.
const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const AGENT_ROLES = /\[\s*"admin",\s*"manager",\s*"agent"\s*\]/;

// Module -> what its agent-callable handlers return, and where that is proven.
const REVIEWED = {
  "src/lib/neon/whatsapp-assignment.ts":
    "assignment context through toAssignmentContextView (diagnostics admin-only; assignment-role-enum.db + enquiry-access.owned.db)",
  "src/lib/neon/staff-notifications.ts":
    "notification list through toStaffNotificationView (allowlist, no staff ids; staff-notification-view.test)",
  "src/lib/neon/enquiry-resolution.ts":
    "enquiry detail through toEnquiryResolutionView (no staff ids unless the reader can correct; this file)",
  "src/lib/neon/forwarded-enquiries.ts":
    "lead capture/contact: CRM lead fields, no WhatsApp assignment diagnostics",
  "src/lib/neon/admin-properties.ts": "listings: no WhatsApp assignment data",
  "src/lib/neon/admin-property-bulk.ts": "listing bulk edit: no WhatsApp assignment data",
  "src/lib/neon/admin-data.ts": "role enum in an input schema and a comment; reviewed per function",
  "src/lib/neon/admin-pagination-query.ts": "pagination guard only",
  "src/lib/neon/staff-lifecycle-policy.ts": "role constants only",
  "src/routes/api.admin.media.upload.ts": "media upload result",
  "src/routes/api.admin.woztell.send.ts": "outbound reply result",
  "src/routes/api.admin.woztell.send-template.ts": "outbound template result",
};

function browserModules() {
  const neon = readdirSync(join(root, "src/lib/neon"))
    .filter((f) => /\.ts$/.test(f) && !/\.(server|types|test|d)\.ts$/.test(f))
    .map((f) => `src/lib/neon/${f}`);
  const routes = readdirSync(join(root, "src/routes"))
    .filter((f) => /^api\..*\.ts$/.test(f) && !/\.test\./.test(f))
    .map((f) => `src/routes/${f}`);
  return [...neon, ...routes];
}

test("every browser-callable module that admits agents is reviewed", () => {
  const admitting = browserModules().filter((path) => AGENT_ROLES.test(read(path)));
  // staff-notifications.ts admits agents in its handler module; review it explicitly.
  admitting.push("src/lib/neon/staff-notifications.ts");
  const unreviewed = admitting.filter((path) => !(path in REVIEWED));
  assert.deepEqual(unreviewed, [], `review what these return to agents: ${unreviewed.join(", ")}`);
});

test("the agent-callable WhatsApp reads return through their role-scoped views", () => {
  assert.match(
    read("src/lib/whatsapp-enquiries/assignment.server.ts"),
    /return toAssignmentContextView\([\s\S]*?\{ diagnostics: canReadDiagnostics\(actor\.roles\) \}/,
  );
  assert.match(
    read("src/lib/neon/staff-notification-handlers.server.ts"),
    /toStaffNotificationView\(item, \{\s*diagnostics: canReadDiagnostics\(actor\.roles\)/,
  );
  assert.match(
    read("src/lib/neon/enquiry-resolution.ts"),
    /context: toEnquiryResolutionView\(context, access\)/,
  );
  // The unscoped per-conversation enquiry list (four staff ids per row) is gone.
  assert.doesNotMatch(read("src/lib/neon/whatsapp-enquiries.ts"), /getWhatsappEnquiries/);
  assert.doesNotMatch(read("src/lib/neon/whatsapp-enquiries.server.ts"), /listEnquiries/);
});

const owner = "7917a000-0000-4000-8000-000000000101";
const requested = "7917a000-0000-4000-8000-000000000102";
const context = {
  inquiryId: "7917a000-0000-4000-8000-000000000201",
  version: 2,
  publicListingNo: "A074714",
  associationReview: true,
  providerThreadReview: false,
  ownerStaffId: owner,
  requestedStaffId: requested,
  propertyId: null,
  references: [],
  ownerCandidates: [{ id: owner, label: "合成同事甲" }],
  propertyCandidates: [],
  requestedStaffCandidates: [{ id: requested, label: "合成同事乙" }],
};

test("an enquiry reader who cannot correct gets no colleague staff id", async () => {
  const { toEnquiryResolutionView, HIDDEN_STAFF_REFERENCE } =
    await import("../whatsapp-enquiries/enquiry-access.server.ts");
  const view = toEnquiryResolutionView(structuredClone(context), { canCorrect: false });
  const payload = JSON.stringify(view);
  for (const uuid of [owner, requested]) assert.ok(!payload.includes(uuid), uuid);
  // Still says that an owner and a requested colleague are set (the panel shows 資料待核實).
  assert.equal(view.ownerStaffId, HIDDEN_STAFF_REFERENCE);
  assert.equal(view.requestedStaffId, HIDDEN_STAFF_REFERENCE);
  assert.deepEqual(view.ownerCandidates, []);
  assert.deepEqual(view.requestedStaffCandidates, []);
  const unset = toEnquiryResolutionView(
    { ...context, ownerStaffId: null, requestedStaffId: null },
    { canCorrect: false },
  );
  assert.equal(unset.ownerStaffId, null);
  assert.equal(unset.requestedStaffId, null);
});

test("an enquiry corrector keeps the ids it chooses and compares with", async () => {
  const { toEnquiryResolutionView } =
    await import("../whatsapp-enquiries/enquiry-access.server.ts");
  assert.deepEqual(
    toEnquiryResolutionView(structuredClone(context), { canCorrect: true }),
    context,
  );
});
