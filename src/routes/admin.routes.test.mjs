import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("Team route is noindexed and keeps URL-backed directory state", () => {
  const source = read("src/routes/admin.team.tsx");

  assert.match(source, /createFileRoute\("\/admin\/team"\)/);
  assert.match(source, /name:\s*"robots",\s*content:\s*"noindex"/);
  for (const key of ["q", "role", "state", "cursor", "member"]) {
    assert.match(source, new RegExp(`search\\.${key}`));
  }
  assert.match(source, /useSearch\(/);
  assert.match(source, /cursor:\s*directory\.nextCursor/);
  assert.match(source, /selectedMemberId/);
});

test("Team route delegates lifecycle mutations to the Task 4 server boundary", () => {
  const source = read("src/routes/admin.team.tsx");

  for (const operation of [
    "inviteStaffMember",
    "resendStaffInvitation",
    "sendStaffPasswordReset",
    "changeStaffRoles",
    "changeStaffActive",
  ]) {
    assert.match(source, new RegExp(operation));
  }
  assert.doesNotMatch(
    source,
    /localStorage|sessionStorage|window\.location|token|provider response/i,
  );
});

test("Team route removes member data for forbidden callers and carries edited lifecycle input", () => {
  const source = read("src/routes/admin.team.tsx");

  // Status is read through serverErrorStatus rather than off the error object:
  // a server-thrown Response arrives on the client as a plain Error carrying the
  // body, so `reason.status` is undefined there and the forbidden branch would
  // never run. The behaviour asserted here is unchanged -- a 403 still drops
  // both the list and the open member -- only the way the status is obtained.
  assert.match(
    source,
    /serverErrorStatus\(reason\) === 403[\s\S]*setTeam\(null\)[\s\S]*setDetail\(null\)/,
  );
  assert.match(source, /if \(forbidden\)[\s\S]*AdminError/);
  assert.match(source, /teamActionPayload\(\{[\s\S]*proposedRoles: pending\.proposedRoles/);
  assert.match(source, /reassignToStaffId: pendingOptions\.reassignToStaffId/);
  assert.match(source, /detailRequestRef\.current\.begin\(\)/);
  assert.match(source, /mergeAdminTeamPages\(teamRef\.current, nextTeam\)/);
  assert.match(source, /resetAdminTeamPage\(search\)/);
  assert.match(source, /await loadTeam\(true\)/);
  assert.match(source, /teamMutationFailure\(result\)/);
});

test("Team route prevents self-reset confusion and gives a safe 400 recovery message", () => {
  const source = read("src/routes/admin.team.tsx");
  // Same move as the 403 branch above: safeError resolves the status once via
  // serverErrorStatus and then branches on it.
  assert.match(source, /const status = serverErrorStatus\(error\);/);
  assert.match(source, /if \(status === 400\)/);
  assert.match(source, /safeError\(reason, pending\.action\)/);
  assert.match(source, /currentUserEmail=\{user\?\.email \?\? null\}/);
});

test("operations shell follows the approved navigation groups and exact Team state", () => {
  const shell = read("src/components/admin/AdminShell.tsx");

  for (const [heading, paths] of [
    ["Workspace", ["/admin", "/admin/leads", "/admin/listings"]],
    ["Growth", ["/admin/cms", "/admin/segments", "/admin/whatsapp", "/admin/blasts"]],
    ["Administration", ["/admin/team", "/admin/agents", "/admin/operations"]],
  ]) {
    assert.match(shell, new RegExp(`heading: "${heading}"`));
    for (const path of paths)
      assert.match(shell, new RegExp(`to: "${path.replaceAll("/", "\\/")}"`));
  }
  assert.match(shell, /to: "\/admin\/team"[\s\S]{0,120}activeExact: true/);
  assert.match(shell, /to: "\/admin\/agents"[\s\S]{0,120}activeExact: false/);
  assert.doesNotMatch(shell, /to: "\/admin\/operations"[\s\S]{0,120}activeExact: false/);

  // The Team directory persists filters and selected detail in its URL. Its
  // navigation item must remain active for a route such as
  // /admin/team?q=ann&role=agent&state=invited&cursor=next&member=staff-1.
  const teamEntry = shell.match(/\{\s*to:\s*"\/admin\/team",[^}]*\}/)?.[0];
  assert.ok(teamEntry, "/admin/team entry must exist in navGroups");
  assert.match(teamEntry, /includeSearch:\s*false/);
});

test("sidebar includes a 成交管理 entry linking to /admin/transactions", () => {
  const shell = read("src/components/admin/AdminShell.tsx");
  assert.match(shell, /to: "\/admin\/transactions"/);
  assert.match(shell, /label: "成交管理"/);
});

test("Overview reads operational sources independently without polling", () => {
  const overview = read("src/routes/admin.index.tsx");

  for (const source of [
    "fetchAdminOverview",
    "listAdminTeam",
    "fetchOperationsHealth",
    "fetchOperationsAudit",
  ]) {
    assert.match(overview, new RegExp(source));
  }
  for (const label of [
    "啟用團隊",
    "待處理邀請",
    "開放查詢",
    "系統健康",
    "需要跟進",
    "最近職員活動",
  ]) {
    assert.match(overview, new RegExp(label));
  }
  assert.match(overview, /role="alert"/);
  assert.match(overview, /重新整理/);
  assert.match(overview, /entry\.action\.startsWith\("staff\."\)/);
  assert.match(overview, /function staffActivityLabel\(action: string\)/);
  assert.doesNotMatch(overview, /\{entry\.action\}/);
  assert.doesNotMatch(overview, /setInterval|setTimeout/);
  assert.match(overview, /useEffect\([\s\S]*refresh/);
});

test("agent profile route retains profile editing and no longer loads access lifecycle data", () => {
  const editAgent = read("src/routes/admin.agents_.$id.tsx");

  assert.match(editAgent, /fetchAdminAgentProfile/);
  assert.doesNotMatch(
    editAgent,
    /fetchStaffAccessSummary|fetchAdminAgents|StaffAccessSummary|accessVersion/,
  );
  assert.doesNotMatch(editAgent, /\baccess=|onAccessChanged|activeStaffOptions/);
});

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
  // Regression guard: the /admin layout must stay a passthrough with NO server-side
  // beforeLoad auth check. This app authenticates server functions with a client-held
  // Neon Auth bearer token (withStaffAuthHeaders), which an SSR route guard cannot see,
  // so a server-side guard bounced every signed-in user back to /auth/sign-in. Access is
  // enforced at the data layer (requireStaff on each server fn) and client-side in AdminShell.
  assert.doesNotMatch(adminLayout, /beforeLoad/);
  assert.doesNotMatch(adminLayout, /requireStaffAccess/);

  const adminOverview = read("src/routes/admin.index.tsx");
  assert.match(adminOverview, /fetchAdminOverview/);
  assert.match(adminOverview, /listAdminTeam/);
  assert.match(adminOverview, /fetchOperationsHealth/);
  assert.match(adminOverview, /fetchOperationsAudit/);
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
// Superseded by "sidebar has no duplicate destinations and is fully grouped"
// below: this used to pin the OLD /admin/cms sidebar shape -- two separate
// entries ("CMS / FAQ" and "AI Agent") kept independently active by a
// `search` prop spread on the nav Link. That shape *was* the bug (see Task 12
// in docs/superpowers/plans/2026-08-12-staff-access-management.md): one entry
// landed on the wrong tab, one was mislabelled, and three tabs had no entry
// at all. The single grouped /admin/cms entry now relies on plain
// `includeSearch: false` instead, with no per-item `search` prop, so this
// test's premise no longer holds.
test("admin CMS route still owns its own tab search state", () => {
  const cmsRoute = read("src/routes/admin.cms.tsx");

  assert.match(cmsRoute, /validateSearch/);
  assert.match(cmsRoute, /Route\.useSearch\(\)/);
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
    "fetchAdminTransactionsFiltered",
    "fetchAdminTransaction",
    "saveAdminTransaction",
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
    "src/routes/api.admin.woztell.send-template.ts",
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
  assert.match(mediaUpload, /createVercelBlobStore/);
  const adapter = read("src/lib/media/vercel-blob.mjs");
  assert.doesNotMatch(adapter, /@vercel\/blob/);
  assert.match(adapter, /https:\/\/vercel\.com\/api\/blob/);
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

test("admin WhatsApp reply delegates recipient identity to the server", () => {
  const whatsappRoute = read("src/routes/admin.whatsapp.tsx");

  assert.doesNotMatch(whatsappRoute, /recipientId/);
  assert.match(whatsappRoute, /conversationId: targetId,[\s\S]*text/);
  assert.match(whatsappRoute, /sendingReply/);
  assert.match(whatsappRoute, /status === "sending"/);
  assert.match(whatsappRoute, /status === "failed"/);
  assert.match(whatsappRoute, /傳送中/);
  assert.match(whatsappRoute, /送出失敗/);
});

test("WhatsApp reply pre-flight check reuses the server's canReplyToConversation guard", () => {
  const whatsappRoute = read("src/routes/admin.whatsapp.tsx");

  // replyAvailability used to re-derive its own checks with their own reason
  // strings, and those leaked raw values ("WOZTELL_ENABLED 未啟用", "缺少
  // Woztell member ID") straight into the reply footer, in the same file that
  // already had a proper Chinese label for the same failure on the real send
  // path (replyErrorLabels, used when an actual send attempt fails).
  assert.match(whatsappRoute, /canReplyToConversation,\s*conversationAttention/);
  assert.match(whatsappRoute, /const guard = canReplyToConversation\(/);
  assert.match(whatsappRoute, /formatReplyError\(guard\.reason\)/);
  assert.doesNotMatch(whatsappRoute, /"WOZTELL_ENABLED 未啟用"/);
  assert.doesNotMatch(whatsappRoute, /"正在確認 WOZTELL_ENABLED"/);
  assert.doesNotMatch(whatsappRoute, /"缺少 Woztell member ID"/);
  assert.doesNotMatch(whatsappRoute, /"客戶已 Opt-out WhatsApp"/);
});

test("WhatsApp AI assist values match the frontend's Chinese label maps", () => {
  const adminData = read("src/lib/neon/admin-data.server.ts");
  const whatsappRoute = read("src/routes/admin.whatsapp.tsx");

  // "renter"/"active" used to be returned here and matched neither
  // AI_INTENT_LABELS nor AI_URGENCY_LABELS below, so every rental inquiry and
  // every conversation with 3+ messages showed raw English ("renter",
  // "active") to a Cantonese-only agent instead of a translated label.
  assert.doesNotMatch(
    adminData,
    /detectedIntent = \/租\|rent\/i\.test\(latestInboundText\)\s*\?\s*"renter"/,
  );
  assert.doesNotMatch(adminData, /urgency: messages\.length >= 3 \? "active"/);
  assert.match(whatsappRoute, /tenant:\s*"租客"/);
  assert.match(whatsappRoute, /high:\s*"高"/);
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
    "saveAdminCmsDraft",
    "publishAdminCmsRevision",
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
    "已拒收",
    "savedCampaignDraft",
    "hasUnsavedCampaignChanges",
    "請先儲存變更才可發送",
    'aria-label="Campaign template"',
    'aria-label="Campaign audience"',
    'aria-label="Campaign status"',
    // Sending is irreversible, so it must stay behind a confirmation that names
    // the campaign, the template and the recipient count.
    "AdminConfirmDialog",
    "確認發送 WhatsApp 群發？",
    "SendConfirmationDetails",
    // Cancelling a campaign is destructive and must not read like dismissing a
    // dialog.
    "取消整個 Campaign",
    // A count the operator saw minutes ago must not gate a send.
    "PREVIEW_FRESHNESS_MS",
    "clearRowPreviews: true",
    // Per-recipient outcome, so a mostly-failed blast cannot look clean.
    "CampaignDeliveryCell",
    // scheduled_at is never read by any delivery path; the label must say so.
    "僅作記錄",
  ]) {
    assert.match(read("src/routes/admin.blasts.tsx"), new RegExp(text));
  }
  // draft must not be client-side queueable -- it would desync from
  // canPrepareAdminCampaignQueue and surface a raw INVALID_CAMPAIGN_STATUS.
  assert.match(
    read("src/routes/admin.blasts.tsx"),
    /const queueableStatuses = new Set\(\["review", "scheduled"\]\)/,
  );
  assert.doesNotMatch(
    read("src/routes/admin.blasts.tsx"),
    /materializeCampaignRecipients\(\{[\s\S]*queueAdminCampaign\(\{/,
  );

  // Deep-linking: the working view and the open record belong in the URL, so a
  // reload or a Back from a detail page does not reset it, and Command Center
  // can link straight to the record it just told the agent to open.
  for (const [file, param] of [
    ["src/routes/admin.leads.tsx", "lead"],
    ["src/routes/admin.whatsapp.tsx", "conversation"],
    ["src/routes/admin.listings.tsx", "q"],
  ]) {
    assert.match(read(file), /validateSearch/, `${file} needs validateSearch`);
    assert.match(read(file), new RegExp(`search\\.${param}`), `${file} needs a ${param} param`);
  }
  // Bulk lead updates must stay a single guarded statement. A client-side loop
  // over updateAdminLead would reintroduce the serial round-trips this replaced
  // and, since AdminLeadUpdateInput has no partial-update path, would rewrite
  // every field of a lead from a draft nobody opened.
  const adminServer = read("src/lib/neon/admin-data.server.ts");
  assert.match(adminServer, /export async function bulkUpdateAdminLeads/);
  assert.match(adminServer, /WHERE id = ANY\(\$1::uuid\[\]\)/);
  assert.match(adminServer, /BULK_LEAD_UPDATE_LIMIT/);
  assert.match(
    adminServer,
    /agentScope\(actor\)[\s\S]*bulkUpdateAdminLeads|bulkUpdateAdminLeads[\s\S]*agentScope\(actor\)/,
  );
  assert.match(adminServer, /lead\.bulk_update/);
  const leadsRoute = read("src/routes/admin.leads.tsx");
  assert.match(leadsRoute, /bulkUpdateAdminLeads/);
  assert.doesNotMatch(leadsRoute, /for \(const .* of selectedVisibleIds\)/);
  // Selection must be scoped to visible rows, so a filter change cannot leave
  // invisible leads selected and then acted on from the bulk bar.
  assert.match(leadsRoute, /selectedVisibleIds/);

  const commandCenter = read("src/routes/admin.leads_.command-center.tsx");
  assert.match(commandCenter, /search=\{\{ lead: selected\.lead_id \}\}/);
  assert.match(commandCenter, /conversation: selected\.whatsapp\.conversationId/);

  const queueApi = read("src/routes/api.admin.campaigns.$id.queue.ts");
  assert.match(queueApi, /sendAdminCampaignQueue/);
  const adminDataServer = read("src/lib/neon/admin-data.server.ts");
  assert.match(
    adminDataServer,
    /validateAdminCampaignQueueability[\s\S]*materializeCampaignRecipients[\s\S]*queueAdminCampaign/,
  );

  const sendQueueJob = read("src/routes/api.admin.jobs.send-queue.ts");
  for (const text of [
    "findEligibleCampaigns",
    "enqueueJob",
    "runClaimedJobs",
    "woztell.campaign.deliver",
    "interval '15 minutes'",
  ]) {
    assert.match(sendQueueJob, new RegExp(text));
  }

  const campaignDelivery = read("src/lib/woztell/campaign-delivery.server.ts");
  for (const text of [
    "claimCampaignRecipients",
    "FOR UPDATE OF recipient SKIP LOCKED",
    "RETURNING",
    "status = 'sending'",
    "queued_at\\s*=\\s*now",
    "isBlastRecipientAllowed",
    "opt_in_whatsapp",
    "opted_out_whatsapp",
    "refreshCampaignDeliveryStatus",
  ]) {
    assert.match(campaignDelivery, new RegExp(text));
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
    ["src/routes/api.admin.ai.rebuild-knowledge.ts", ["enqueueJob", "ai.knowledge.rebuild"]],
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

// crm_segments and whatsapp_audiences previously shared no data path at all:
// a segment built in 客戶分群 never appeared as something a blast could send
// to. RECIPIENT_ELIGIBILITY_SQL is extended to carry the same filter
// vocabulary fetchSegmentContacts (segments.server.ts) already validates, so
// createAdminAudienceFromSegment can translate a segment's filters onto an
// audience losslessly.
test("audience eligibility SQL carries the same filter vocabulary segments already validate", () => {
  const server = read("src/lib/neon/admin-data.server.ts");

  assert.match(
    server,
    /RECIPIENT_ELIGIBILITY_SQL = `[\s\S]*?l\.preferred_estates && \$4::text\[\][\s\S]*?estate\.slug = ANY\(\$4::text\[\]\)[\s\S]*?p\.district_slug = \$5[\s\S]*?l\.budget_max >= \$6[\s\S]*?l\.budget_min <= \$7[\s\S]*?\$8::int IS NULL OR l\.updated_at >= now\(\)[\s\S]*?c\.opt_in_whatsapp = true/,
  );

  // An empty estates array must not silently defeat the filter: `[]` is not
  // NULL, and `preferred_estates && ARRAY[]` is always false, which would
  // exclude every contact instead of matching "any estate".
  assert.match(
    server,
    /function normalizeAudienceFilters\([\s\S]{0,700}estates\.length \? estates : undefined/,
  );
});

test("createAdminAudienceFromSegment bridges a saved segment into a WhatsApp audience, admin/manager only", () => {
  const client = read("src/lib/neon/admin-data.ts");
  const server = read("src/lib/neon/admin-data.server.ts");

  const clientStart = client.indexOf("createAdminAudienceFromSegmentServer = createServerFn");
  assert.notEqual(clientStart, -1, "client wrapper must exist");
  assert.match(
    client.slice(clientStart, clientStart + 400),
    /requireStaff\(\["admin", "manager"\]\)/,
  );

  assert.match(server, /export async function createAdminAudienceFromSegment/);
  assert.match(server, /getSegmentForAudience/);
});

// Verified live: the first version of this function always INSERTed, so one
// click of 建立收件群組 -- a plain double-click, no special timing needed --
// created two identical "audience from this segment" rows with no way to
// tell them apart. Idempotent per segment via source_segment_id (see
// neon/migrations/20260822120000_whatsapp_audience_segment_link.sql): a
// second run must UPDATE the one linked audience, not INSERT another.
test("createAdminAudienceFromSegment upserts by source_segment_id instead of always inserting", () => {
  const server = read("src/lib/neon/admin-data.server.ts");
  const migration = read("neon/migrations/20260822120000_whatsapp_audience_segment_link.sql");

  const start = server.indexOf("export async function createAdminAudienceFromSegment");
  assert.notEqual(start, -1);
  const body = server.slice(start, start + 2000);

  assert.match(body, /SELECT id FROM whatsapp_audiences WHERE source_segment_id = \$1/);
  assert.match(body, /existingId\s*\?\s*[\s\S]*?UPDATE whatsapp_audiences/);
  assert.match(body, /INSERT INTO whatsapp_audiences \([\s\S]*?source_segment_id/);

  assert.match(migration, /ADD COLUMN IF NOT EXISTS source_segment_id/);
});

test("segment list surfaces whether a WhatsApp audience already exists for it", () => {
  const segmentsServer = read("src/lib/ai/segments.server.ts");
  const segmentsRoute = read("src/routes/admin.segments.tsx");

  assert.match(
    segmentsServer,
    /EXISTS \(\s*SELECT 1 FROM whatsapp_audiences a WHERE a\.source_segment_id = s\.id\s*\) AS has_audience/,
  );
  assert.match(segmentsRoute, /segment\.has_audience/);
  assert.match(segmentsRoute, /更新收件群組/);
});

test("command center route is registered, noindex, and admin-guarded", () => {
  const route = read("src/routes/admin.leads_.command-center.tsx");
  assert.match(route, /createFileRoute\("\/admin\/leads_\/command-center"\)/);
  assert.match(route, /robots".*noindex/s);
  assert.match(route, /fetchCommandCenter/);

  const routeTree = read("src/routeTree.gen.ts");
  assert.match(routeTree, /['"]\/admin\/leads\/command-center['"]/);
});

test("Operations route is present in the generated route tree", () => {
  const routeTree = read("src/routeTree.gen.ts");
  assert.match(routeTree, /['"]\/admin\/operations['"]/);
});

// An agent-role token could previously send a real WhatsApp message on ANY
// conversation: the lookup was `WHERE wc.id = $1` with no scope, while every
// sibling conversation path in admin-data.server.ts filters on
// assigned_agent_id. The blast radius is a customer receiving a message from an
// agent who is not allowed to read their thread.
test("both WhatsApp send routes preserve acting-agent scope in the durable repository", () => {
  const intent = read("src/lib/woztell/outbound-intent.server.ts");
  for (const name of ["send", "send-template"]) {
    const route = read(`src/routes/api.admin.woztell.${name}.ts`);
    assert.match(route, /requireStaffAccess/);
    assert.match(
      route,
      /enqueueOutboundIntent\(\s*input,\s*staff.staffId,\s*agentScope\(staff\),?\s*\)/,
    );
  }
  assert.match(intent, /wc.assigned_agent_id=\$7::uuid/);
  assert.match(intent, /t.status LIKE 'active%'/);
  assert.match(intent, /i.kind='text' AND wc.last_inbound_at/);
});

test("agentScope is exported once and not redefined per call site", () => {
  const server = read("src/lib/neon/admin-data.server.ts");
  assert.match(server, /export function agentScope\(actor: StaffAccess\)/);

  // Any second definition means the two can drift apart.
  const definitions = (server.match(/function agentScope\(/g) ?? []).length;
  assert.equal(definitions, 1);
});

// Roles and deactivation are privilege operations. Managers may edit an agent's
// public profile, but must never be able to escalate anyone -- including
// themselves -- so all three are admin-only at the server boundary.
test("staff access management server functions are admin-only", () => {
  const client = read("src/lib/neon/admin-data.ts");

  for (const name of [
    "fetchStaffAccessSummaryServer",
    "updateStaffRolesServer",
    "setStaffActiveServer",
  ]) {
    const start = client.indexOf(`const ${name} = createServerFn`);
    assert.notEqual(start, -1, `${name} must exist`);
    const body = client.slice(start, start + 900);
    assert.match(body, /requireStaff\(\["admin"\]\)/, `${name} must require admin`);
  }
});

test("deactivation reassigns and flips active in one transaction", () => {
  const server = read("src/lib/neon/admin-data.server.ts");
  const start = server.indexOf("export async function setStaffActive");
  const body = server.slice(start);

  assert.notEqual(start, -1);
  assert.match(body, /staffReassignStatements\(input\.staffId, reassignToStaffId\)/);
  assert.match(body, /SET active = false/);
  assert.match(body, /writeAudit\(actor\.staffId, "staff\.deactivate"/);
});

// The zero-admin guard's shape is load-bearing, not stylistic -- see the doc
// comment on isZeroAdminGuardTrip in admin-data.server.ts. A future
// "simplification" of `1 / (CASE ... END) = 1` back to the obvious-looking
// `AND (CASE WHEN <safe> THEN true ELSE (1/0=0) END)` reintroduces a real bug,
// confirmed empirically against Postgres 17: a bare `1/0` is pure literals, so
// the planner constant-folds it during planning and it errors even on the
// safe path, on a bare EXPLAIN; and a guard that references only the bind
// parameter, not a column of the scanned row, gets hoisted into a one-time
// filter that runs before the scan finds a matching row, so it fires even
// when zero rows would ever be touched. Both guarded statements below must
// keep BOTH properties that defeat this: the risky division's divisor is a
// CASE (not constant-foldable), and that CASE's WHEN redundantly re-tests a
// column of the scanned row, not just the bind parameter.
test("zero-admin guard SQL keeps the row-dependent CASE-divisor shape in both guarded statements", () => {
  const server = read("src/lib/neon/admin-data.server.ts");

  function guardStatementSql(anchorPattern) {
    const anchorMatch = server.match(anchorPattern);
    assert.ok(anchorMatch, `guard anchor ${anchorPattern} must exist`);
    const start = anchorMatch.index;
    const end = server.indexOf("`", start);
    assert.notEqual(end, -1, `closing backtick for ${anchorPattern} not found`);
    return server.slice(start, end);
  }

  const guardedStatements = [
    {
      name: "updateStaffRoles' admin-row DELETE",
      sql: guardStatementSql(/DELETE FROM staff_roles AS target/),
      rowColumnWhen: /WHEN\s+target\.role\s*=\s*'admin'::staff_role\s+AND\s+EXISTS/,
    },
    {
      name: "setStaffActive's deactivation UPDATE",
      sql: guardStatementSql(/UPDATE staff_users AS target\s+SET active = false/),
      rowColumnWhen: /WHEN\s+target\.id\s*=\s*\$1::uuid/,
    },
  ];

  for (const { name, sql, rowColumnWhen } of guardedStatements) {
    // Property 1: the divisor is a CASE expression, not a bare literal -- a
    // bare `1/0` is pure literals and gets constant-folded by the planner
    // during planning, independent of runtime row values. See
    // isZeroAdminGuardTrip.
    assert.match(
      sql,
      /1\s*\/\s*\(\s*CASE[\s\S]*?END\s*\)\s*=\s*1/,
      `${name}: guard divisor must be "1 / (CASE ... END) = 1", a CASE that can't be constant-folded -- see the isZeroAdminGuardTrip comment in admin-data.server.ts for why a bare literal divisor errors even on the safe path`,
    );

    // Property 2: the CASE's WHEN condition redundantly re-tests a column of
    // the row being scanned (not only the bind parameter), so Postgres
    // cannot treat the guard as row-independent and hoist it into a one-time
    // filter that runs before the scan finds a matching row. See
    // isZeroAdminGuardTrip.
    assert.match(
      sql,
      rowColumnWhen,
      `${name}: guard's CASE must re-test a column of the scanned row, or Postgres can hoist it ahead of the scan and fire it even when zero rows match -- see the isZeroAdminGuardTrip comment in admin-data.server.ts`,
    );

    // Both properties above are required together; this is the exact
    // regression they guard against: a "simplified" divisor that looks
    // equivalent but is constant-foldable and row-independent.
    assert.doesNotMatch(
      sql,
      /ELSE\s*\(\s*1\s*\/\s*0\s*=\s*0\s*\)/,
      `${name}: guard must not use the known-broken "ELSE (1/0=0)" literal form -- see the isZeroAdminGuardTrip comment in admin-data.server.ts for why it silently defeats the last-admin protection`,
    );
  }
});

// Owner accounts (ADMIN_BOOTSTRAP_EMAILS) must be protected at the server
// boundary, not merely disabled in the UI -- otherwise another admin could
// demote or deactivate the owner with a direct call to the server function,
// bypassing any client-side disabled state entirely.
test("protected owner accounts are enforced server-side, not only hidden in the UI", () => {
  const auth = read("src/lib/neon/auth.server.ts");
  assert.match(auth, /export function isProtectedStaffEmail\(/);

  const server = read("src/lib/neon/admin-data.server.ts");
  assert.match(server, /isProtected: isProtectedStaffEmail\(stringOrNull\(row\.email\)\)/);

  // Bound each function body at the next top-level export, not a fixed
  // char count: updateStaffRoles' comment block alone runs past a thousand
  // characters, and a fixed window sized for it would either clip
  // setStaffActive's own (later) targetIsProtected line or, sized for that,
  // risk reading past updateStaffRoles into unrelated code.
  const updateStaffRolesStart = server.indexOf("export async function updateStaffRoles");
  const setStaffActiveStart = server.indexOf("export async function setStaffActive");
  assert.notEqual(updateStaffRolesStart, -1, "updateStaffRoles must exist");
  assert.notEqual(setStaffActiveStart, -1, "setStaffActive must exist");
  const nextExportAfterSetStaffActive = server.indexOf("\nexport ", setStaffActiveStart + 40);
  assert.notEqual(nextExportAfterSetStaffActive, -1, "next exported symbol must exist");

  const bodies = {
    updateStaffRoles: server.slice(updateStaffRolesStart, setStaffActiveStart),
    setStaffActive: server.slice(setStaffActiveStart, nextExportAfterSetStaffActive),
  };

  for (const [fnName, body] of Object.entries(bodies)) {
    assert.match(
      body,
      /targetIsProtected: summary\.isProtected/,
      `${fnName} must pass targetIsProtected into its decision function`,
    );
  }
});

// Two entries pointed at /admin/cms differing only by search param, with labels
// that named the wrong tab, while three of that screen's five tabs had no entry
// at all. A duplicate destination is the shape of that bug.
test("sidebar has no duplicate destinations and is fully grouped", () => {
  const shell = read("src/components/admin/AdminShell.tsx");

  const start = shell.indexOf("const navGroups = [");
  assert.notEqual(start, -1, "navGroups must exist");
  const block = shell.slice(start, shell.indexOf("] as const;", start));

  const destinations = [...block.matchAll(/to:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(
    new Set(destinations).size,
    destinations.length,
    `duplicate sidebar destination: ${destinations.join(", ")}`,
  );
  // 14 includes the operational analytics dashboard and command-center, which
  // had no sidebar entry at all (its only way in was a button on /admin/leads).
  assert.equal(destinations.length, 14);
  assert.ok(destinations.includes("/admin/analytics"));

  for (const heading of ["Workspace", "Growth", "Administration"]) {
    assert.match(block, new RegExp(`heading: "${heading}"`), `missing group ${heading}`);
  }

  // The old duplicate + its misleading labels must not come back.
  assert.doesNotMatch(block, /search: \{ tab: "faqs" \}/);
  assert.doesNotMatch(block, /"AI Agent"/);
  assert.doesNotMatch(block, /"CMS \/ FAQ"/);
  assert.match(block, /"團隊成員"/);

  // Pinned on the entries themselves (not the whole block) so a future
  // reorder of navGroups cannot silently invalidate this without failing
  // here. See the comment above navGroups for why these two are exact.
  const adminEntry = block.match(/\{\s*to:\s*"\/admin",[^}]*\}/)?.[0];
  assert.ok(adminEntry, "/admin entry must exist in navGroups");
  assert.doesNotMatch(
    adminEntry,
    /activeExact:\s*false/,
    "/admin must stay exact (no activeExact: false) or it matches every admin page",
  );

  const adminLeadsEntry = block.match(/\{\s*to:\s*"\/admin\/leads",[^}]*\}/)?.[0];
  assert.ok(adminLeadsEntry, "/admin/leads entry must exist in navGroups");
  assert.match(
    adminLeadsEntry,
    /activeExact:\s*false/,
    "/admin/leads owns child routes and should use prefix matching",
  );

  // `activeOptions` is where each entry's activeExact/includeSearch above
  // actually takes effect, and `explicitUndefined: true` is what makes an
  // entry with no search params (like /admin) refuse to match a URL that
  // carries extra search state it should not.
  const navLinkOpening = shell.match(
    /<Link\s+key=\{`\$\{item\.to\}-\$\{item\.label\}`\}[\s\S]*?>/,
  )?.[0];
  assert.ok(navLinkOpening, "admin nav Link opening tag should exist");
  assert.match(
    navLinkOpening,
    /activeOptions=\{\{/,
    "nav Link must pass activeOptions, or every entry's activeExact/includeSearch setting above is ignored and falls back to the Link's own defaults",
  );
  assert.match(
    navLinkOpening,
    /explicitUndefined:\s*true/,
    "explicitUndefined must stay true, or an entry with no search params (like /admin) can match a URL carrying extra search state it should not",
  );
});

test("Neon Auth UI is given the absolute site origin so password-reset links return to this app", () => {
  // The auth server lives on Neon's domain, not ours. With the provider's
  // baseURL left empty, the built-in 忘記密碼 form sends a RELATIVE
  // redirectTo ("/auth/reset-password"), which the auth server can only
  // resolve against its own origin -- so the emailed reset link never comes
  // back to this app. Neon's own password-reset example passes
  // `${window.location.origin}/reset-password`; the admin-side reset in
  // staff-identity-provider.server.ts already builds an absolute URL the same
  // way. SITE_URL is the canonical production origin, so preview deployments
  // finish the reset on production, where the same Neon Auth token is valid.
  const root = read("src/components/auth/PrivateAuthProvider.tsx");
  assert.match(root, /import \{[^}]*\bSITE_URL\b[^}]*\} from "@\/content\/seo"/);
  assert.match(root, /<NeonAuthUIProvider[^>]*baseURL=\{SITE_URL\}/);
});
