import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// FX-17a G-24 / G-26: the inventory of staff actions that destroy, publish or send. Every row
// must ask first, with the dialog actually wired: a button opens it by setting its `open`
// state, its onConfirm runs the action, and no onClick runs that action directly. A new
// destructive action belongs in this list.
const read = (path) => readFileSync(join(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
// assert.match would print the whole source file on failure; say what is missing instead.
const has = (source, pattern, message) =>
  assert.ok(typeof pattern === "string" ? source.includes(pattern) : pattern.test(source), message);
const lacks = (source, pattern, message) =>
  assert.ok(
    typeof pattern === "string" ? !source.includes(pattern) : !pattern.test(source),
    message,
  );
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The `{…}` value of `name=` starting the search at `from`, braces balanced. */
function attribute(source, name, from, until) {
  const start = source.indexOf(`${name}={`, from);
  if (start < 0 || start > until) return null;
  let depth = 0;
  for (let i = start + name.length + 1; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start + name.length + 2, i);
  }
  return null;
}

const NOT_ACTIONS = new Set(["void", "if", "Boolean", "async", "await", "return", "toast"]);

/**
 * Checks the AdminConfirmDialog whose JSX contains `title`: it is rendered (not just imported),
 * its `open` state is set somewhere outside the dialog (a trigger), and each function its
 * onConfirm calls is never called straight from an onClick (the one-click pattern).
 */
function assertWiredConfirm(action, file, title) {
  const source = read(file);
  const at = source.indexOf(title);
  assert.ok(at >= 0, `${action}: ${file} lost ${title}`);
  const start = source.lastIndexOf("<AdminConfirmDialog", at);
  assert.ok(start >= 0, `${action}: ${title} is not inside a rendered <AdminConfirmDialog>`);
  const next = source.indexOf("<AdminConfirmDialog", start + 1);
  const until = next < 0 ? source.length : next;
  const open = attribute(source, "open", start, until);
  const onConfirm = attribute(source, "onConfirm", start, until);
  assert.ok(open && onConfirm, `${action}: the dialog has no open or onConfirm wiring`);
  const state = open.match(/[A-Za-z_]\w*/g).find((name) => !NOT_ACTIONS.has(name));
  const setter = "set" + state[0].toUpperCase() + state.slice(1);
  // The component that renders the dialog: its trigger and handlers live there, and another
  // component's same-named handler (a different dialog) does not count.
  let from = 0;
  let to = source.length;
  for (const match of source.matchAll(/\n(export )?(default )?function /g)) {
    if (match.index < start) from = match.index;
    else {
      to = match.index;
      break;
    }
  }
  const component = source.slice(from, to);
  const outside = source.slice(from, start) + source.slice(until, to);
  has(outside, new RegExp(`\\b${setter}\\(`), `${action}: nothing calls ${setter} to open it`);
  const actions = [...onConfirm.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)]
    .map((match) => match[1])
    .filter((name) => !NOT_ACTIONS.has(name) && !/^set[A-Z]/.test(name));
  for (const fn of actions)
    lacks(
      component,
      new RegExp(`onClick=\\{[^}]*\\b${escape(fn)}\\(`),
      `${action}: an onClick calls ${fn} directly, without the confirmation`,
    );
  return { source, actions };
}

const confirms = [
  ["CMS 封存 屋苑／文章", "src/routes/admin.cms.tsx", 'title="封存"'],
  ["CMS FAQ 刪除", "src/routes/admin.cms.tsx", 'title="刪除 FAQ"'],
  ["CMS 發布", "src/routes/admin.cms.tsx", 'title="確認發布內容"'],
  ["Estate editor 封存", "src/components/admin/estates/AdminEstateEditorForm.tsx", "封存屋苑"],
  [
    "Estate editor 發布",
    "src/components/admin/estates/AdminEstateEditorForm.tsx",
    "發布屋苑資料？",
  ],
  [
    "Estate editor FAQ 刪除",
    "src/components/admin/estates/AdminEstateEditorForm.tsx",
    "刪除 FAQ？",
  ],
  [
    "Listing 全部下架 / 下架所選",
    "src/components/admin/AdminPropertyWorkspace.tsx",
    "確認全部下架？",
  ],
  ["Listing bulk edit", "src/components/admin/AdminPropertyBulkActions.tsx", "確認批量修改"],
  ["Lead bulk update", "src/routes/admin.leads.tsx", "確認批量更新？"],
  ["Template send", "src/routes/admin.whatsapp.tsx", 'title="確認傳送範本？"'],
  ["不是退訂", "src/components/admin/whatsapp/OptOutEvidenceNotice.tsx", 'title="不是退訂要求？"'],
  ["Campaign send", "src/routes/admin.blasts.tsx", "確認發送 WhatsApp 群發？"],
  ["Campaign cancel", "src/routes/admin.blasts.tsx", "取消整個 Campaign？"],
  ["Campaign retry", "src/routes/admin.blasts.tsx", "重新發送失敗收件人？"],
  ["Campaign finish", "src/routes/admin.blasts.tsx", "結束 Campaign（沒有尚待發送收件人）"],
  ["Audience delete", "src/routes/admin.blasts.tsx", "確認刪除收件群組？"],
  ["Link 停用", "src/components/admin/whatsapp/WhatsappLinksTable.tsx", 'title="停用此來源連結？"'],
  [
    "Jobs retry / cancel",
    "src/components/admin/operations/AdminOperationsJobs.tsx",
    "確認重試此工作？",
  ],
  [
    "Receipts retry",
    "src/components/admin/operations/AdminOperationsReceipts.tsx",
    "重試這則來訊？",
  ],
  [
    "Migrations apply",
    "src/components/admin/operations/AdminOperationsMigrations.tsx",
    "確認套用資料庫遷移？",
  ],
];

test("every action in the inventory goes through a confirmation", () => {
  for (const [action, file, title] of confirms) assertWiredConfirm(action, file, title);

  // CMS 還原: both editors open the shared dialog from a 還原 button and restore only from it.
  for (const file of [
    "src/routes/admin.cms.tsx",
    "src/components/admin/estates/AdminEstateEditorForm.tsx",
  ]) {
    const source = read(file);
    has(source, "<CmsRestoreConfirm", `CMS 還原: ${file} does not render CmsRestoreConfirm`);
    has(source, /setPendingRestore\(revision\)/, `CMS 還原: ${file} never opens the confirmation`);
    lacks(
      source,
      /onClick=\{[^}]*\b(onRestoreRevision|handleRestore\w*)\(/,
      `CMS 還原: ${file} restores straight from a click`,
    );
  }

  // CMS 還原's shared dialog is open while it holds a revision and restores only that one.
  const restore = read("src/components/admin/CmsRestoreConfirm.tsx");
  has(restore, 'title="還原此版本？"', "CMS 還原: lost its title");
  has(restore, "open={revision !== null}", "CMS 還原: not opened by the pending revision");
  has(restore, "onConfirm={() => onConfirm(target.id)}", "CMS 還原: confirms another revision");

  // Team: the shared dialog takes its title from a map; the page opens it by setting `pending`
  // and runs the action only from its onConfirm.
  const team = read("src/components/admin/team/AdminTeamDialogs.tsx");
  has(team, "open={Boolean(pending)}", "Team: the dialog is not opened by the pending action");
  has(team, "onConfirm={onConfirm}", "Team: the dialog does not run the action");
  const teamPage = read("src/routes/admin.team.tsx");
  has(
    teamPage,
    /<AdminTeamDialogs[\s\S]{0,400}onConfirm=\{\(\) => void confirm\(\)\}/,
    "Team: not wired",
  );
  has(teamPage, /setPending\(\{/, "Team: nothing opens the confirmation");
  lacks(teamPage, /onClick=\{[^}]*\bconfirm\(/, "Team: an onClick runs the action directly");
  for (const title of ["確認停用帳戶", "確認變更角色", "發送密碼重設連結", "確認連結帳戶"])
    has(team, `"${title}"`, `Team: lost ${title}`);

  // Template send: the customer and send target are named, and nothing confirms without a template.
  const whatsapp = read("src/routes/admin.whatsapp.tsx");
  has(whatsapp, "<CustomerConfirmDetails customer={customer} />", "Template send: no 客戶 block");
  lacks(
    whatsapp,
    "將向客戶傳送已審批範本",
    "Template send: the old copy that names no one is back",
  );
  has(whatsapp, "disabled={disabled || !selected}", "Template send: 傳送 works with no template");

  // Consent change: an explicit save inside a dialog that names the customer.
  const consent = read("src/components/admin/WhatsappConsentDialog.tsx");
  has(consent, "<CustomerConfirmLine customer={customer} />", "Consent: no 客戶 line");
  has(consent, /onClick=\{\(\) => void save\(\)\}/, "Consent: the save is not the dialog's button");
  has(consent, "<DialogContent>", "Consent: the save is not inside a dialog");

  // Mapping retire: a typed reason is the confirmation; retire refuses without one.
  has(
    read("src/components/admin/whatsapp/StaffMappingWizard.tsx"),
    "retireReason.trim().length < 3) return;",
    "Mapping retire: runs without a typed reason",
  );
});

test("link 停用 never saves from the card; 重新啟用 stays one click", () => {
  const source = read("src/components/admin/whatsapp/WhatsappLinksTable.tsx");
  // Any spelling of a one-click disable: save(link, !link.enabled), save(link, false), ….
  lacks(source, /save\(\s*link\s*,\s*!\s*link\.enabled\s*\)/, "停用 toggles in one click again");
  const disables = [...source.matchAll(/save\(\s*(\w+)\s*,\s*false\b/g)];
  assert.deepEqual(
    disables.map((match) => match[1]),
    ["link"],
    "a link is saved as disabled outside the confirmation",
  );
  const confirm = source.slice(source.indexOf("async function confirmDisable"));
  has(confirm.slice(0, 600), /await save\(link, false\)/, "confirmDisable no longer saves");
  has(source, /setPendingDisable\(link\)/, "停用 no longer opens the confirmation");
  has(source, /else void run\(\(\) => save\(link, true\)\)/, "重新啟用 is no longer one click");
});

test("deferred actions are still one click; when one is fixed, move it into the inventory", () => {
  const whatsapp = read("src/routes/admin.whatsapp.tsx");
  const leads = read("src/routes/admin.leads.tsx");
  has(
    whatsapp,
    /onValueChange=\{\(value\) => onAgentChange\(/,
    "Conversation reassignment (17b, G-06) changed: add it to the inventory",
  );
  has(
    whatsapp,
    /window\.confirm\("將會覆蓋你已輸入的回覆內容/,
    "AI suggestion overwrite (17c) changed: add it to the inventory",
  );
  has(
    leads,
    /if \(isLeadDetailDirty\) \{\s*setPendingStageAction\(\{ stage, label \}\);\s*return;\s*\}\s*void markStage\(stage, label\);/,
    "Lead 標記為已結束 (deferred, #238) changed: add it to the inventory",
  );
});

test("the customer shown in a confirmation comes from the record the action targets", () => {
  const source = read("src/routes/admin.whatsapp.tsx");
  // Template send: the open conversation's detail and its member id (the provider send target,
  // outbound-intent.server.ts), never a list row or the CRM phone.
  has(
    source,
    /<TemplateSendPanel\s+key=\{detail\.id\}\s+customer=\{templateRecipientLabel\(\{\s*name: detail\.customer_display_name \?\? detail\.name,\s*memberId: detail\.woztell_member_id,\s*\}\)\}/,
    "TemplateSendPanel does not name the open conversation's send target",
  );
  // Consent changes the contact: its CRM phone, from the detail that supplies contactId.
  has(
    source,
    /contactId=\{detail\.contact_id\}\s+onSaved=\{onConsentSaved\}\s+customer=\{customerConfirmLabel\(\{\s*name: detail\.customer_display_name \?\? detail\.name,\s*phone: detail\.phone,\s*\}\)\}/,
    "the consent dialog does not name the contact it changes",
  );
  lacks(source, /selectedRow[^\n]*ConfirmLabel|ConfirmLabel\([^)]*selectedRow/, "label from a row");
  const notice = read("src/components/admin/whatsapp/OptOutEvidenceNotice.tsx");
  has(
    notice,
    /customerConfirmLabel\(\{\s*name: detail\.customer_display_name \?\? detail\.name,\s*phone: detail\.phone,?\s*\}\)/,
    "OptOutEvidenceNotice does not name the customer from its own detail",
  );
});
