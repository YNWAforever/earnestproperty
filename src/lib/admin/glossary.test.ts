import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import * as glossary from "./glossary";
import * as jobLabels from "./job-labels";

// FX-17a G-12: one glossary for admin terms and status labels.
const root = fileURLToPath(new URL("../../../", import.meta.url));

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (file: string) => relative(root, file).replaceAll("\\", "/");
const isSource = (file: string) => /\.tsx?$/.test(file) && !/\.test\.[tj]sx?$/.test(file);

const adminFiles = [
  ...readdirSync(join(root, "src/routes"))
    .filter((name) => /^admin.*\.tsx$/.test(name))
    .map((name) => join(root, "src/routes", name)),
  ...walk(join(root, "src/components/admin")),
  ...walk(join(root, "src/lib/admin")),
  join(root, "src/components/dashboard/PropertyForm.tsx"),
].filter(isSource);

const sources = new Map(adminFiles.map((file) => [rel(file), readFileSync(file, "utf8")]));
const source = (path: string) => sources.get(path) ?? readFileSync(join(root, path), "utf8");

const STATUS_MAPS = {
  LEAD_STAGE_LABELS: glossary.LEAD_STAGE_LABELS,
  LEAD_SOURCE_LABELS: glossary.LEAD_SOURCE_LABELS,
  CONVERSATION_STATUS_LABELS: glossary.CONVERSATION_STATUS_LABELS,
  PROPERTY_STATUS_LABELS: glossary.PROPERTY_STATUS_LABELS,
  CAMPAIGN_STATUS_LABELS: glossary.CAMPAIGN_STATUS_LABELS,
  CMS_REVISION_STATE_LABELS: glossary.CMS_REVISION_STATE_LABELS,
  JOB_STATUS_LABELS: glossary.JOB_STATUS_LABELS,
  HEALTH_STATUS_LABELS: glossary.HEALTH_STATUS_LABELS,
  ASSIGNMENT_STATE_LABELS: glossary.ASSIGNMENT_STATE_LABELS,
  PLACEMENT_SOURCE_LABELS: glossary.PLACEMENT_SOURCE_LABELS,
  ROLE_LABELS: glossary.ROLE_LABELS,
} as const;

function definesMap(text: string, map: Record<string, string>) {
  return Object.entries(map).every(([key, label]) => {
    const quoted = `["']?${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']?`;
    const asProperty = new RegExp(`${quoted}\\s*:\\s*["'\`]${label}["'\`]`);
    const asOption = new RegExp(`value:\\s*["']${key}["']\\s*,\\s*label:\\s*["'\`]${label}["'\`]`);
    return asProperty.test(text) || asOption.test(text);
  });
}

test("each status map has one definition", () => {
  for (const [name, map] of Object.entries(STATUS_MAPS)) {
    expect(Object.keys(map).length).toBeGreaterThan(2);
    const owners = [...sources.entries()]
      .filter(([path, text]) => path !== "src/lib/admin/glossary.ts" && definesMap(text, map))
      .map(([path]) => path);
    expect({ name, owners }).toEqual({ name, owners: [] });
  }
});

test("the glossary re-exports the job maps from job-labels", () => {
  expect(glossary.JOB_TYPE_LABELS).toBe(jobLabels.JOB_TYPE_LABELS);
  expect(glossary.JOB_FAILURE_REASONS).toBe(jobLabels.JOB_FAILURE_REASONS);
});

test("the approved status labels are the ones the table gives", () => {
  expect(glossary.HEALTH_STATUS_LABELS).toEqual({
    healthy: "正常",
    degraded: "需要留意",
    failed: "故障",
  });
  expect(glossary.LEAD_SOURCE_LABELS.live_agent).toBe("問樓助手");
  expect(glossary.ROLE_LABELS).toEqual({
    admin: "管理員",
    manager: "經理",
    agent: "代理",
    viewer: "只讀同事",
  });
  expect(glossary.PLACEMENT_SOURCE_LABELS).toEqual({
    website: "網站",
    "28hse": "28Hse",
    youtube: "YouTube",
    unknown: "來源未記錄",
    other: "其他",
  });
  expect(glossary.PROPERTY_STATUS_LABELS).toEqual({
    active: "公開",
    draft: "草稿",
    offline: "已下架",
    inactive: "來源已下架",
    sold: "已售",
    rented: "已租",
  });
  expect(glossary.CONVERSATION_STATUS_LABELS).toEqual({
    open: "開啟",
    pending: "待跟進",
    closed: "已關閉",
  });
  expect(glossary.ADMIN_TERMS.unassigned).toBe("未指派");
  expect(glossary.ADMIN_TERMS.publish).toBe("發布");
});

const REJECTED_VARIANTS = [
  "物業管理",
  "追蹤連結",
  "WhatsApp 群發",
  "未分配",
  "未分派",
  "未指定代理",
  "發佈",
  "線上客服",
  "降級",
  "live agent",
];

// Only what the plan defers to 17b or gives no copy for. Each entry names one source line.
const DEFERRED_LINES: Array<{ file: string; line: string; why: string }> = [
  {
    file: "src/routes/admin.blasts.tsx",
    line: "確認發送 WhatsApp 群發？",
    why: "17b rebuilds the blasts screen; this confirm title is not in the copy table",
  },
  {
    file: "src/routes/admin.segments.tsx",
    line: "WhatsApp 群發",
    why: "the audience (segments) screen is 17b; no copy is approved for these lines",
  },
  {
    file: "src/components/admin/operations/WhatsappServiceHealth.tsx",
    line: "追蹤連結限流",
    why: "technical rate-limit line, not in the copy table",
  },
];

test("no admin page title, nav label or breadcrumb uses a rejected variant", () => {
  const hits: string[] = [];
  for (const [path, text] of sources) {
    text.split(/\r?\n/).forEach((line, index) => {
      for (const variant of REJECTED_VARIANTS) {
        if (!line.toLowerCase().includes(variant.toLowerCase())) continue;
        const allowed = DEFERRED_LINES.some(
          (entry) => entry.file === path && line.includes(entry.line),
        );
        if (!allowed) hits.push(`${path}:${index + 1} ${variant}`);
      }
    });
  }
  expect(hits).toEqual([]);
});

const APPROVED_PLACEMENTS: Array<[file: string, text: string]> = [
  ["src/components/admin/AdminShell.tsx", "樓盤管理"],
  ["src/routes/admin.listings.tsx", '"樓盤管理｜Earnest Admin"'],
  ["src/routes/admin.listings.tsx", 'title="樓盤管理"'],
  ["src/routes/admin.listings_.$id.tsx", ">樓盤管理</Link>"],
  ["src/components/admin/AdminPropertyTable.tsx", "樓盤管理；每個樓編一行"],
  ["src/components/admin/whatsapp/WhatsappLinkWizard.tsx", "已從樓盤管理帶入"],
  ["src/components/admin/whatsapp/WhatsappLinkWizard.tsx", "從樓盤管理可選更多"],
  ["src/routes/admin.whatsapp-links.tsx", '"WhatsApp 來源連結 | Earnest Admin"'],
  ["src/routes/admin.whatsapp-links.tsx", 'title="WhatsApp 來源連結"'],
  ["src/components/admin/whatsapp/WhatsappLinksTable.tsx", 'aria-label="編輯來源連結"'],
  ["src/routes/admin.blasts.tsx", '"推廣活動｜Earnest Admin"'],
  ["src/routes/admin.blasts.tsx", '<AdminShell title="推廣活動"'],
  [
    "src/routes/admin.blasts.tsx",
    'description="推廣活動：只用已審批範本、只發給已同意接收的客戶。"',
  ],
  ["src/routes/admin.blasts.tsx", '<Field label="負責代理">'],
  ["src/routes/admin.whatsapp.tsx", "查看客戶訊息、指派負責代理及回覆；對話列表每分鐘自動更新"],
  ["src/routes/admin.whatsapp.tsx", '{ value: "unassigned", label: "未指派" }'],
  ["src/routes/admin.analytics.tsx", 'label="查詢紀錄"'],
  ["src/routes/admin.analytics.tsx", 'label="已連結客戶查詢的查詢紀錄"'],
  ["src/routes/admin.analytics.tsx", 'label="客戶查詢"'],
  ["src/routes/admin.analytics.tsx", 'label="未指派查詢紀錄"'],
  ["src/routes/admin.analytics.tsx", 'label="未指派客戶查詢"'],
  ["src/routes/admin.analytics.tsx", 'label="未指派對話"'],
  ["src/routes/admin.analytics.tsx", "客戶查詢和對話是不同記錄，不能相加當作客戶人數。"],
  ["src/routes/admin.analytics.tsx", "客戶查詢及 WhatsApp 對話數量"],
  ["src/routes/admin.leads.tsx", '<SelectItem value="unassigned">未指派</SelectItem>'],
  ["src/routes/admin.leads.tsx", '<SelectItem value="none">未指派</SelectItem>'],
  ["src/routes/admin.leads_.command-center.tsx", '{ key: "unassigned", label: "未指派" }'],
  ["src/routes/admin.leads_.command-center.tsx", '{ key: "live_agent", label: "問樓助手" }'],
  ["src/routes/admin.leads_.command-center.tsx", 'RECENT_HANDOFF: "問樓助手新轉介"'],
  ["src/routes/admin.leads_.command-center.tsx", 'label: "新問樓助手轉介"'],
  ["src/routes/admin.cms.tsx", 'title="確認發布內容"'],
  ["src/routes/admin.cms.tsx", 'confirmLabel="確認發布"'],
  ["src/routes/admin.cms.tsx", "圖片上載中，完成後才可儲存、發布或關閉"],
  ["src/routes/admin.cms.tsx", "發布中…"],
  ["src/components/admin/AdminContentCopilot.tsx", "不會修改售價、狀態或已發布資料。"],
  ["src/components/admin/AdminContentCopilot.tsx", "仍需由你儲存或發布。"],
  ["src/components/admin/AdminContentCopilot.tsx", "放棄不會發布或傳送。"],
];

test("every approved term appears where the table says", () => {
  const missing = APPROVED_PLACEMENTS.filter(([file, text]) => !source(file).includes(text)).map(
    ([file, text]) => `${file}: ${text}`,
  );
  expect(missing).toEqual([]);
});

test("each former owner imports the glossary instead of redefining a map", () => {
  const importers = [
    "src/lib/admin/crm-presentation.ts",
    "src/lib/admin/property-management-ui.ts",
    "src/routes/admin.whatsapp.tsx",
    "src/routes/admin.blasts.tsx",
    "src/routes/admin.cms.tsx",
    "src/components/admin/estates/AdminEstateEditorForm.tsx",
    "src/components/admin/CmsRestoreConfirm.tsx",
    "src/components/admin/operations/AdminOperationsJobs.tsx",
    "src/components/admin/operations/AdminOperationsOverview.tsx",
    "src/routes/admin.operations.tsx",
    "src/routes/admin.index.tsx",
    "src/components/admin/WhatsappEnquiryContext.tsx",
    "src/components/admin/whatsapp/WhatsappLinksTable.tsx",
    "src/components/dashboard/PropertyForm.tsx",
  ];
  const without = importers.filter(
    (file) => !/@\/lib\/admin\/glossary|\.\/glossary/.test(source(file)),
  );
  expect(without).toEqual([]);
});
