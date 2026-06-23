import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("admin route modules cover CMS, CRM, WhatsApp, and blasts", () => {
  const routeFiles = [
    "src/routes/admin.tsx",
    "src/routes/admin.cms.tsx",
    "src/routes/admin.listings.tsx",
    "src/routes/admin.leads.tsx",
    "src/routes/admin.whatsapp.tsx",
    "src/routes/admin.blasts.tsx",
  ];

  for (const file of routeFiles) {
    assert.equal(existsSync(join(root, file)), true, `${file} should exist`);
  }

  const admin = read("src/routes/admin.tsx");
  assert.match(admin, /Neon/);
  assert.match(admin, /WhatsApp/);
  assert.match(admin, /CMS/);
  assert.doesNotMatch(admin, /supabase/i);
});

test("admin child routes are present in the generated route tree", () => {
  const routeTree = read("src/routeTree.gen.ts");
  const adminPaths = [
    "/admin/cms",
    "/admin/listings",
    "/admin/leads",
    "/admin/whatsapp",
    "/admin/blasts",
  ];

  for (const path of adminPaths) {
    assert.match(routeTree, new RegExp(`['"]${path}['"]`), `${path} should be routable`);
  }
});

test("admin server functions recover from stale deployed hashes", () => {
  const adminData = read("src/lib/neon/admin-data.ts");

  assert.match(adminData, /STALE_SERVER_FN_RELOAD_KEY/);
  assert.match(adminData, /isStaleServerFunctionError/);
  assert.match(adminData, /window\.location\.reload\(\)/);
  assert.match(adminData, /callStaffServerFn/);

  const protectedFetches = [
    "fetchAdminOverview",
    "fetchAdminListings",
    "fetchAdminEstateOptions",
    "fetchAdminProperty",
    "saveAdminProperty",
    "deleteAdminProperty",
    "fetchAdminCms",
    "fetchAdminLeads",
    "fetchAdminConversations",
    "fetchAdminCampaigns",
    "updateAdminInquiryStatus",
  ];

  for (const name of protectedFetches) {
    const pattern = new RegExp(`export async function ${name}[\\s\\S]*?return callStaffServerFn`);
    assert.match(adminData, pattern, `${name} should use stale server-function recovery`);
  }
});

test("Woztell API routes are present and server-only", () => {
  const files = [
    "src/routes/api.woztell.webhook.ts",
    "src/routes/api.admin.woztell.send.ts",
    "src/routes/api.admin.campaigns.$id.queue.ts",
    "src/routes/api.admin.jobs.send-queue.ts",
  ];

  for (const file of files) {
    assert.equal(existsSync(join(root, file)), true, `${file} should exist`);
    assert.match(read(file), /server-only|@tanstack\/react-start\/server-only/);
  }
});

test("Blob upload SDK is loaded lazily to keep SSR boot clean", () => {
  const mediaUpload = read("src/routes/api.admin.media.upload.ts");
  assert.doesNotMatch(mediaUpload, /import\s+\{\s*put\s*\}\s+from\s+["']@vercel\/blob["']/);
  assert.match(mediaUpload, /await import\(["']@vercel\/blob["']\)/);
});

test("admin routes expose functional workflows, not only read-only tables", () => {
  const expectations = [
    ["src/routes/admin.cms.tsx", ["saveAdminEstate", "saveAdminArticle", "saveAdminFaq"]],
    ["src/routes/admin.listings.tsx", ["updateAdminPropertyStatus", "fetchAdminAgents"]],
    ["src/routes/admin.leads.tsx", ["fetchAdminLead", "updateAdminLead", "createAdminLeadActivity"]],
    ["src/routes/admin.whatsapp.tsx", ["fetchAdminConversation", "sendAdminConversationReply"]],
    ["src/routes/admin.blasts.tsx", ["saveAdminCampaign", "previewAdminAudience", "queueAdminCampaign"]],
  ];

  for (const [file, requiredNames] of expectations) {
    const source = read(file);
    for (const name of requiredNames) {
      assert.match(source, new RegExp(`\\b${name}\\b`), `${file} should use ${name}`);
    }
  }
});
