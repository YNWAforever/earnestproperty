import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// FX-17a G-24 / G-26: the inventory of staff actions that destroy, publish or send. Every row
// must ask first; a row that names the record or customer must keep doing so. A new destructive
// action belongs in this list. Deferred rows are listed so they cannot be forgotten: when one is
// fixed, move it out of `deferred` and give it a `confirm` string.
const read = (path) => readFileSync(join(process.cwd(), path), "utf8");
// assert.match would print the whole source file on failure; say what is missing instead.
const has = (source, pattern, message) =>
  assert.ok(typeof pattern === "string" ? source.includes(pattern) : pattern.test(source), message);

const inventory = [
  {
    action: "CMS 封存 屋苑／文章",
    file: "src/routes/admin.cms.tsx",
    confirm: ['title="封存"'],
  },
  { action: "CMS FAQ 刪除", file: "src/routes/admin.cms.tsx", confirm: ['title="刪除 FAQ"'] },
  { action: "CMS 發布", file: "src/routes/admin.cms.tsx", confirm: ['title="確認發佈內容"'] },
  {
    action: "CMS 還原",
    file: "src/components/admin/CmsRestoreConfirm.tsx",
    confirm: ['title="還原此版本？"'],
    alsoIn: { "src/routes/admin.cms.tsx": ["<CmsRestoreConfirm"] },
    gone: { "src/routes/admin.cms.tsx": [/onClick=\{\(\) => onRestoreRevision\(revision\.id\)\}/] },
  },
  {
    action: "Estate editor 封存／發布／FAQ 刪除",
    file: "src/components/admin/estates/AdminEstateEditorForm.tsx",
    confirm: ['title="封存屋苑"', 'title="發布屋苑資料？"', 'title="刪除 FAQ？"'],
  },
  {
    action: "Listing 全部下架 / 下架所選",
    file: "src/components/admin/AdminPropertyWorkspace.tsx",
    confirm: ['"確認全部下架？"', 'confirmLabel="確認下架"'],
  },
  {
    action: "Listing bulk edit",
    file: "src/components/admin/AdminPropertyBulkActions.tsx",
    confirm: ['title="確認批量修改"'],
  },
  {
    action: "Lead bulk update",
    file: "src/routes/admin.leads.tsx",
    confirm: ['title="確認批量更新？"'],
  },
  {
    action: "Template send",
    file: "src/routes/admin.whatsapp.tsx",
    confirm: ['title="確認傳送範本？"', "customerConfirmLabel(", "<CustomerConfirmDetails"],
    // The old copy never said who would receive the template.
    gone: { "src/routes/admin.whatsapp.tsx": ["將向客戶傳送已審批範本"] },
  },
  {
    action: "Consent change",
    file: "src/components/admin/WhatsappConsentDialog.tsx",
    confirm: ["確認並儲存", "<CustomerConfirmLine"],
    alsoIn: { "src/routes/admin.whatsapp.tsx": ["contactId={detail.contact_id}"] },
  },
  {
    action: "不是退訂",
    file: "src/components/admin/whatsapp/OptOutEvidenceNotice.tsx",
    confirm: ['title="不是退訂要求？"', "<CustomerConfirmLine", "customerConfirmLabel("],
  },
  {
    action: "Campaign send / cancel / retry / finish; audience delete",
    file: "src/routes/admin.blasts.tsx",
    confirm: [
      'title="確認發送 WhatsApp 群發？"',
      'title="取消整個 Campaign？"',
      'title="重新發送失敗收件人？"',
      'title="結束 Campaign（沒有尚待發送收件人）"',
      'title="確認刪除收件群組？"',
    ],
  },
  {
    action: "Link 停用",
    file: "src/components/admin/whatsapp/WhatsappLinksTable.tsx",
    confirm: ['title="停用此來源連結？"', 'confirmVariant="destructive"', "投放位置", "指定同事"],
    gone: {
      "src/components/admin/whatsapp/WhatsappLinksTable.tsx": [
        /onClick=\{\(\) => void run\(\(\) => save\(link, !link\.enabled\)\)\}/,
      ],
    },
  },
  {
    action: "WhatsApp mapping retire",
    file: "src/components/admin/whatsapp/StaffMappingWizard.tsx",
    // A typed reason is the confirmation: retire refuses to run without one.
    confirm: ["retireReason.trim().length < 3"],
  },
  {
    action: "Team suspend / roles / reset / link",
    file: "src/components/admin/team/AdminTeamDialogs.tsx",
    confirm: ['"確認停用帳戶"', '"確認變更角色"', '"發送密碼重設連結"', '"確認連結帳戶"'],
  },
  {
    action: "Jobs retry / cancel",
    file: "src/components/admin/operations/AdminOperationsJobs.tsx",
    confirm: ['"確認重試此工作？"', '"確認取消此工作？"'],
  },
  {
    action: "Receipts retry",
    file: "src/components/admin/operations/AdminOperationsReceipts.tsx",
    confirm: ['title="重試這則來訊？"'],
  },
  {
    action: "Migrations apply",
    file: "src/components/admin/operations/AdminOperationsMigrations.tsx",
    confirm: ['title="確認套用資料庫遷移？"'],
  },
];

const deferred = [
  { action: "Lead 標記為已結束（未成交） when the form is clean", owner: "#238 / 17b" },
  { action: "Conversation reassignment", owner: "17b (G-06)" },
  { action: "AI suggestion overwrite window.confirm", owner: "17c" },
];

test("every action in the inventory goes through a confirmation", () => {
  for (const row of inventory) {
    const source = read(row.file);
    if (row.file !== "src/components/admin/whatsapp/StaffMappingWizard.tsx")
      has(source, /AdminConfirmDialog|<Dialog\b/, `${row.action}: no dialog in ${row.file}`);
    for (const literal of row.confirm)
      assert.ok(source.includes(literal), `${row.action}: ${row.file} lost ${literal}`);
    for (const [file, literals] of Object.entries(row.alsoIn ?? {}))
      for (const literal of literals)
        assert.ok(read(file).includes(literal), `${row.action}: ${file} lost ${literal}`);
    for (const [file, patterns] of Object.entries(row.gone ?? {}))
      for (const pattern of patterns)
        assert.ok(
          typeof pattern === "string" ? !read(file).includes(pattern) : !pattern.test(read(file)),
          `${row.action}: one-click pattern ${pattern} is back in ${file}`,
        );
  }
  assert.deepEqual(
    deferred.map((row) => row.action),
    [
      "Lead 標記為已結束（未成交） when the form is clean",
      "Conversation reassignment",
      "AI suggestion overwrite window.confirm",
    ],
  );
});

test("re-enabling a link stays one click; only 停用 asks", () => {
  const source = read("src/components/admin/whatsapp/WhatsappLinksTable.tsx");
  has(source, /setPendingDisable\(link\)/, "停用 no longer opens the confirmation");
  has(source, /save\(link, true\)/, "重新啟用 is no longer one click");
});

test("the customer shown in a sending confirmation comes from the conversation being sent to", () => {
  const source = read("src/routes/admin.whatsapp.tsx");
  // Built from the open conversation's detail (the record whose id sendTemplate and the consent
  // save target), never from a list row that could be stale. Template send and consent: twice.
  const fromDetail =
    /customer=\{customerConfirmLabel\(\{\s*name: detail\.customer_display_name \?\? detail\.name,\s*phone: detail\.phone,\s*\}\)\}/g;
  assert.equal(
    source.match(fromDetail)?.length ?? 0,
    2,
    "template send and consent must both take the customer from the open conversation's detail",
  );
  has(
    source,
    /<TemplateSendPanel\s+key=\{detail\.id\}\s+customer=\{customerConfirmLabel\(/,
    "TemplateSendPanel does not receive the open conversation's customer",
  );
  has(
    source,
    /contactId=\{detail\.contact_id\}\s+onSaved=\{onConsentSaved\}\s+customer=\{customerConfirmLabel\(/,
    "the consent dialog does not receive the customer of the contact it changes",
  );
  const notice = read("src/components/admin/whatsapp/OptOutEvidenceNotice.tsx");
  has(
    notice,
    /customerConfirmLabel\(\{\s*name: detail\.customer_display_name \?\? detail\.name,\s*phone: detail\.phone,?\s*\}\)/,
    "OptOutEvidenceNotice does not name the customer from its own detail",
  );
});
