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

test("Blob upload route avoids SDK imports to keep SSR boot clean", () => {
  const mediaUpload = read("src/routes/api.admin.media.upload.ts");
  assert.doesNotMatch(mediaUpload, /import\s+\{\s*put\s*\}\s+from\s+["']@vercel\/blob["']/);
  assert.doesNotMatch(mediaUpload, /@vercel\/blob/);
  assert.match(mediaUpload, /https:\/\/vercel\.com\/api\/blob/);
  assert.match(mediaUpload, /BLOB_READ_WRITE_TOKEN/);
});

test("admin lead CRM workflow guards async detail state and uses list assignment data", () => {
  const leadRoute = read("src/routes/admin.leads.tsx");
  const adminDataTypes = read("src/lib/neon/admin-data.types.ts");
  const adminDataServer = read("src/lib/neon/admin-data.server.ts");

  for (const text of [
    "selectedIdRef",
    "panelOpenRef",
    "canApplyLeadDetail",
    "contact_id: detail.contact_id",
    'aria-label="新增跟進 note"',
    "focus-visible:ring",
  ]) {
    assert.match(leadRoute, new RegExp(text));
  }

  assert.doesNotMatch(leadRoute, /Promise\.allSettled\(missingRows\.map/);
  assert.doesNotMatch(leadRoute, /loadingAssignments/);

  assert.match(
    adminDataTypes,
    /export type AdminLeadRow = \{[\s\S]*assigned_agent_id: string \| null;/,
  );
  assert.match(
    adminDataTypes,
    /export type AdminLeadDetail = AdminLeadRow & \{[\s\S]*contact_id: string \| null;/,
  );
  // Signatures gained an optional `actor` param for agent row-ownership scoping;
  // the contract still requires the assignment/contact columns to be selected.
  assert.match(
    adminDataServer,
    /export async function listAdminLeads\([\s\S]*?\)[\s\S]*l\.assigned_agent_id,/,
  );
  assert.match(
    adminDataServer,
    /export async function fetchAdminLead\(id: string[\s\S]*?\)[\s\S]*l\.contact_id,/,
  );
  assert.match(adminDataServer, /contact_id: stringOrNull\(lead\.contact_id\)/);
});

test("admin WhatsApp inbox guards stale selected conversation actions", () => {
  const whatsappRoute = read("src/routes/admin.whatsapp.tsx");

  for (const text of [
    "fetchAdminConversation",
    "updateAdminConversation",
    "sendAdminConversationReply",
    "clearConversationDetail",
    "detail.id !== selectedIdRef.current",
    "24 小時",
    "WOZTELL_ENABLED",
    "回覆",
  ]) {
    assert.match(whatsappRoute, new RegExp(text));
  }
});

test("admin routes expose functional workflows, not only read-only tables", () => {
  for (const text of [
    "屋苑 SEO",
    "文章編輯",
    "FAQ 編輯",
    "FAQ / AI Agent 配置",
    "上載 FAQ 檔案",
    "貼上 FAQ",
    "FaqImportDialog",
    "媒體庫",
    "saveAdminEstate",
    "saveAdminArticle",
    "saveAdminFaq",
    "parseAdminFaqImport",
    "匯入並訓練 AI",
    "updateAdminMediaAsset",
  ]) {
    assert.match(read("src/routes/admin.cms.tsx"), new RegExp(text));
  }

  const faqImport = read("src/lib/admin/faq-import.ts");
  for (const text of [
    "parseAdminFaqImport",
    "問題",
    "答案",
    "parseMarkdownHeadings",
    "parseDelimitedRows",
  ]) {
    assert.match(faqImport, new RegExp(text));
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
      ["saveAdminCampaign", "previewAdminAudience", "sendAdminCampaignQueue"],
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

  for (const text of [
    "fetchAdminLead",
    "updateAdminLead",
    "createAdminLeadActivity",
    "Activity",
    "跟進",
    "成交",
    "失敗",
  ]) {
    assert.match(read("src/routes/admin.leads.tsx"), new RegExp(text));
  }

  for (const text of [
    "fetchAdminConversation",
    "updateAdminConversation",
    "sendAdminConversationReply",
    "clearConversationDetail",
    "detail.id !== selectedIdRef.current",
    "24 小時",
    "WOZTELL_ENABLED",
    "回覆",
  ]) {
    assert.match(read("src/routes/admin.whatsapp.tsx"), new RegExp(text));
  }

  for (const text of [
    "fetchAdminBlastOptions",
    "saveAdminAudience",
    "previewAdminAudience",
    "saveAdminCampaign",
    "sendAdminCampaignQueue",
    "cancelAdminCampaign",
    "合資格",
    "Opt-out",
    "savedCampaignDraft",
    "hasUnsavedCampaignChanges",
    "Save changes before queueing",
    'aria-label="Campaign template"',
    'aria-label="Campaign audience"',
    'aria-label="Campaign status"',
  ]) {
    assert.match(read("src/routes/admin.blasts.tsx"), new RegExp(text));
  }
  assert.doesNotMatch(
    read("src/routes/admin.blasts.tsx"),
    /materializeCampaignRecipients\(\{[\s\S]*queueAdminCampaign\(\{/,
  );

  const queueApi = read("src/routes/api.admin.campaigns.$id.queue.ts");
  assert.match(queueApi, /sendAdminCampaignQueue/);
  const adminDataServer = read("src/lib/neon/admin-data.server.ts");
  assert.match(
    adminDataServer,
    /validateAdminCampaignQueueability[\s\S]*materializeCampaignRecipients[\s\S]*queueAdminCampaign/,
  );

  const sendQueueJob = read("src/routes/api.admin.jobs.send-queue.ts");
  for (const text of [
    "claimQueuedCampaignRecipients",
    "FOR UPDATE SKIP LOCKED",
    "RETURNING",
    "status = 'sending'",
    "queued_at = now()",
    "interval '15 minutes'",
    "r.status = 'sending'",
    "catch \\(err\\)",
    "refreshTouchedCampaignStatuses",
    "blocked, failed",
  ]) {
    assert.match(sendQueueJob, new RegExp(text));
  }

  assert.match(
    adminDataServer,
    /export async function materializeCampaignRecipients[\s\S]*validateAdminCampaignQueueability[\s\S]*fetchAudienceRecipientRows/,
  );

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

test("AI CRM, segment, and live-agent routes are wired", () => {
  const expectations = [
    ["src/routes/admin.cms.tsx", ["fetchAdminAiKnowledgeStatus", "rebuildAdminAiKnowledge"]],
    [
      "src/routes/admin.leads.tsx",
      ["fetchAdminLeadAiProfile", "analyzeAdminLeadAiProfile", "approveAdminAiTag"],
    ],
    [
      "src/routes/admin.segments.tsx",
      ["previewAdminCrmSegment", "saveAdminCrmSegment", "materializeAdminCrmSegment"],
    ],
    ["src/routes/admin.whatsapp.tsx", ["fetchAdminConversationAiAssist"]],
    [
      "src/components/live-agent/LiveAgentWidget.tsx",
      ["api/live-agent/session", "api/live-agent/message", "api/live-agent/handoff"],
    ],
    ["src/routes/api.live-agent.session.ts", ["createLiveAgentSession"]],
    ["src/routes/api.live-agent.message.ts", ["answerLiveAgentMessage"]],
    ["src/routes/api.live-agent.handoff.ts", ["requestLiveAgentHandoff"]],
    ["src/routes/api.admin.ai.rebuild-knowledge.ts", ["rebuildAdminAiKnowledge"]],
  ];

  for (const [file, requiredNames] of expectations) {
    const source = read(file);
    for (const name of requiredNames) {
      assert.match(
        source,
        new RegExp(name.replaceAll("/", "\\\\/")),
        `${file} should include ${name}`,
      );
    }
  }
});

test("admin segment editor guards selected segment and preview context", () => {
  const source = read("src/routes/admin.segments.tsx");

  assert.doesNotMatch(source, /return rows\[0\]\?\.id \?\? ""/);
  assert.match(source, /type AdminCrmSegmentPreviewState/);
  assert.match(source, /previewRequestRef/);
  assert.match(source, /isCurrentPreview/);
  assert.match(source, /setPreviewState\(\{\s*result,/);
  assert.match(source, /prompt: previewPrompt/);
  assert.match(source, /segmentId: previewSegmentId/);
  assert.match(source, /previewState\?\.result/);
  assert.match(source, /disabled=\{!canSaveSegment \|\| saving\}/);
  assert.match(source, /disabled=\{!canMaterializeSegment \|\| materializing\}/);
});
