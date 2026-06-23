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
    "src/routes/admin.index.tsx",
    "src/routes/admin.cms.tsx",
    "src/routes/admin.listings.tsx",
    "src/routes/admin.leads.tsx",
    "src/routes/admin.whatsapp.tsx",
    "src/routes/admin.blasts.tsx",
  ];

  for (const file of routeFiles) {
    assert.equal(existsSync(join(root, file)), true, `${file} should exist`);
  }

  const adminLayout = read("src/routes/admin.tsx");
  assert.match(adminLayout, /Outlet/);
  assert.match(adminLayout, /<Outlet\s*\/>/);
  assert.doesNotMatch(adminLayout, /fetchAdminOverview/);

  const adminOverview = read("src/routes/admin.index.tsx");
  assert.match(adminOverview, /Neon/);
  assert.match(adminOverview, /WhatsApp/);
  assert.match(adminOverview, /CMS/);
  assert.doesNotMatch(adminOverview, /supabase/i);
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

  assert.match(routeTree, /['"]\/admin\/['"]/);
  assert.match(routeTree, /['"]\/admin\/listings\/new['"]/);
  assert.match(routeTree, /['"]\/admin\/listings\/\$id['"]/);
  assert.doesNotMatch(routeTree, /AdminListingsRouteWithChildren/);
  assert.doesNotMatch(routeTree, /parentRoute: typeof AdminListingsRoute/);
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
  for (const text of [
    "屋苑 SEO",
    "文章編輯",
    "FAQ 編輯",
    "媒體庫",
    "saveAdminEstate",
    "saveAdminArticle",
    "saveAdminFaq",
    "updateAdminMediaAsset",
  ]) {
    assert.match(read("src/routes/admin.cms.tsx"), new RegExp(text));
  }

  const expectations = [
    ["src/routes/admin.listings.tsx", ["updateAdminPropertyStatus", "fetchAdminAgents"]],
    [
      "src/routes/admin.leads.tsx",
      ["fetchAdminLead", "updateAdminLead", "createAdminLeadActivity"],
    ],
    ["src/routes/admin.whatsapp.tsx", ["fetchAdminConversation", "sendAdminConversationReply"]],
    [
      "src/routes/admin.blasts.tsx",
      ["saveAdminCampaign", "previewAdminAudience", "queueAdminCampaign"],
    ],
  ];

  for (const [file, requiredNames] of expectations) {
    const source = read(file);
    for (const name of requiredNames) {
      assert.match(source, new RegExp(`\\b${name}\\b`), `${file} should use ${name}`);
    }
  }

  for (const text of [
    "fetchAdminListingsFiltered",
    "updateAdminPropertyStatus",
    "fetchAdminAgents",
    "公開預覽",
    "下架",
    "已售",
    "已租",
  ]) {
    assert.match(read("src/routes/admin.listings.tsx"), new RegExp(text));
  }

  for (const file of ["src/routes/admin.listings_.new.tsx", "src/routes/admin.listings_.$id.tsx"]) {
    assert.equal(existsSync(join(root, file)), true, `${file} should exist`);
  }

  for (const file of ["src/routes/admin.listings.new.tsx", "src/routes/admin.listings.$id.tsx"]) {
    assert.equal(existsSync(join(root, file)), false, `${file} should not define nested routes`);
  }

  const propertyForm = read("src/components/dashboard/PropertyForm.tsx");
  assert.match(propertyForm, /optionalNumber/);
  assert.match(propertyForm, /optionalInteger/);
  assert.doesNotMatch(
    propertyForm,
    /z\.coerce\.number\(\)\.nonnegative\(\)\.optional\(\)\.or\(z\.nan\(\)\)/,
  );

  const listingEditRoute = read("src/routes/admin.listings_.$id.tsx");
  assert.match(listingEditRoute, /let cancelled = false/);
  assert.match(listingEditRoute, /setProperty\(null\)/);
  assert.match(listingEditRoute, /if \(cancelled\) return/);
  assert.match(listingEditRoute, /cancelled = true/);

  const listingRoute = read("src/routes/admin.listings.tsx");
  assert.match(listingRoute, /useRef/);
  assert.match(listingRoute, /requestIdRef/);
  assert.match(listingRoute, /overflow-x-auto/);
});

test("shared admin workflow components exist", () => {
  for (const file of [
    "src/components/admin/AdminToolbar.tsx",
    "src/components/admin/AdminEmptyState.tsx",
    "src/components/admin/AdminConfirmDialog.tsx",
    "src/components/admin/AdminDetailPanel.tsx",
    "src/components/admin/AdminStatusSelect.tsx",
  ]) {
    assert.equal(existsSync(join(root, file)), true, `${file} should exist`);
  }
});

test("shared admin workflow components include accessible labels and descriptions", () => {
  const statusSelect = read("src/components/admin/AdminStatusSelect.tsx");
  assert.match(statusSelect, /ariaLabel/);
  assert.match(statusSelect, /aria-label/);

  const detailPanel = read("src/components/admin/AdminDetailPanel.tsx");
  assert.match(detailPanel, /SheetDescription/);
  assert.match(detailPanel, /description: string/);

  const confirmDialog = read("src/components/admin/AdminConfirmDialog.tsx");
  assert.match(confirmDialog, /Button/);
  assert.doesNotMatch(confirmDialog, /AlertDialogAction/);
  assert.match(confirmDialog, /處理中…/);
});
