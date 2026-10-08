import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));

const WRAPPER = "src/lib/neon/staff-server-fn.ts";
const DEFINITION = "src/auth.ts";
// Already unwrap every call (fact 12). Each withStaff(Auth)?Headers( call must sit in a statement
// (text since the previous ";" within 400 chars) containing unwrapServerFnResponse( |
// callStaffServerFn( | callStaffServerFnInBackground(, OR be followed within 400 chars by
// fetch("/api/ or fetch(`/api/ (raw API route), OR be the body of admin-team's local withStaffHeaders.
const LEGACY_UNWRAPPED = [
  "src/lib/neon/admin-data.ts",
  "src/lib/neon/admin-cms.ts",
  "src/lib/neon/admin-team.ts",
  "src/lib/neon/admin-properties.ts",
  "src/lib/neon/admin-property-bulk.ts",
  "src/lib/neon/admin-property-sync.ts",
  "src/lib/ai/content-copilot-admin.ts",
  "src/lib/analytics/reporting-client.ts",
  "src/lib/analytics/sales-performance-client.ts",
];
// Raw fetch to /api/admin/control-plane with its own status mapping.
const FETCH_CLIENTS = ["src/lib/admin/operations/operations-client.ts"];
// Emptied by Task 3; a test below keeps it empty.
const PENDING_TASK_3 = [];
const MIGRATED = [
  "src/lib/neon/staff-endpoints.ts",
  "src/lib/neon/staff-notifications.ts",
  "src/lib/neon/staff-reference-admin.ts",
  "src/lib/neon/whatsapp-assignment.ts",
  "src/lib/neon/whatsapp-readiness.ts",
  "src/lib/neon/whatsapp-service-health.ts",
  "src/lib/neon/whatsapp-service-policy.ts",
  "src/lib/neon/whatsapp-test-notification.ts",
  "src/lib/neon/inbox-directory.ts",
  "src/lib/neon/forwarded-enquiries.ts",
  "src/lib/neon/enquiry-resolution.ts",
  "src/lib/neon/contact-identity-review.ts",
  "src/lib/neon/whatsapp-link-management.ts",
  "src/lib/neon/whatsapp-link-selection.ts",
  "src/lib/neon/whatsapp-link-import.ts",
  "src/lib/neon/whatsapp-coverage.ts",
  "src/lib/neon/whatsapp-link-batches.ts",
  "src/lib/admin/whatsapp-link-export-api.ts",
  "src/components/admin/whatsapp/WhatsappLinksTable.tsx",
  "src/components/admin/whatsapp/WhatsappLinkWizard.tsx",
];

/** Remove line and block comments while leaving string and template literals intact. */
function stripComments(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      out += " ";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const start = i++;
      while (i < source.length && source[i] !== ch) {
        if (source[i] === "\\") i++;
        else if (ch !== "`" && source[i] === "\n") break;
        i++;
      }
      out += source.slice(start, i + 1);
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) files.push(path);
  }
  return files;
}

const sources = new Map(
  walk(join(root, "src"))
    .map((path) => relative(root, path).split(sep).join("/"))
    .filter((path) => !/\.test\./.test(path) && !path.endsWith(".d.ts"))
    .map((path) => [path, stripComments(readFileSync(join(root, path), "utf8"))]),
);
const code = (path) => {
  assert.ok(existsSync(join(root, path)), `${path} must exist`);
  return stripComments(readFileSync(join(root, path), "utf8"));
};
const mentionsAuthHeaders = (text) => /\bwithStaffAuthHeaders\b/.test(text);

test("no staff module calls withStaffAuthHeaders outside the wrapper", () => {
  const allowed = new Set([
    DEFINITION,
    WRAPPER,
    ...LEGACY_UNWRAPPED,
    ...FETCH_CLIENTS,
    ...PENDING_TASK_3,
  ]);
  const offenders = [...sources]
    .filter(([path, text]) => mentionsAuthHeaders(text) && !allowed.has(path))
    .map(([path]) => path);
  assert.deepEqual(
    offenders,
    [],
    `${offenders.join(", ")}: use callStaffServerFn from src/lib/neon/staff-server-fn.ts`,
  );
});

test("legacy modules unwrap every call", () => {
  const violations = [];
  for (const path of LEGACY_UNWRAPPED) {
    const text = code(path);
    for (const match of text.matchAll(/\bwithStaff(Auth)?Headers\(/g)) {
      const at = match.index;
      const statementStart = Math.max(text.lastIndexOf(";", at) + 1, at - 400);
      const statement = text.slice(statementStart, at + match[0].length);
      const after = text.slice(at, at + 400);
      const unwrapped =
        /\b(unwrapServerFnResponse|callStaffServerFn|callStaffServerFnInBackground)\(/.test(
          statement,
        );
      const rawApiFetch = /fetch\(\s*["`]\/api\//.test(after);
      const before = text.slice(Math.max(0, at - 400), at);
      const helperAt = before.lastIndexOf("function withStaffHeaders");
      const localHelperBody =
        path === "src/lib/neon/admin-team.ts" &&
        helperAt !== -1 &&
        !before.slice(helperAt).includes("\n}");
      if (!unwrapped && !rawApiFetch && !localHelperBody) {
        const line = text.slice(0, at).split("\n").length;
        violations.push(`${path}:${line}`);
      }
    }
  }
  assert.deepEqual(violations, [], `unwrapped staff calls: ${violations.join(", ")}`);
});

test("migrated files import callStaffServerFn and never @/auth", () => {
  for (const path of MIGRATED) {
    const text = code(path);
    assert.match(
      text,
      /import\s*\{[^}]*\bcallStaffServerFn\b[^}]*\}\s*from\s*"(\.\/staff-server-fn|\.\.\/neon\/staff-server-fn|@\/lib\/neon\/staff-server-fn)"/,
      `${path} must import callStaffServerFn from the shared wrapper`,
    );
    assert.doesNotMatch(text, /from\s*"@\/auth"/, `${path} must not import @/auth`);
    assert.ok(!mentionsAuthHeaders(text), `${path} must not call withStaffAuthHeaders`);
  }
});

test("staff server functions from whatsapp-enquiries are only called through the wrapper", () => {
  const staffFns = [
    "getWhatsappTrackingLinks",
    "saveWhatsappTrackingLink",
    "provisionWhatsappLinks",
    "getWhatsappEnquiries",
    "searchWhatsappLinkOffers",
  ];
  const offenders = [];
  for (const [path, text] of sources) {
    for (const match of text.matchAll(
      /import\s*\{([^}]*)\}\s*from\s*"(?:@\/lib\/neon\/|\.\/|\.\.\/neon\/)whatsapp-enquiries(?:\.ts)?"/g,
    )) {
      const names = match[1].split(",").map((name) => name.trim().split(/\s+as\s+/)[0]);
      if (names.some((name) => staffFns.includes(name)) && !/\bcallStaffServerFn\b/.test(text)) {
        offenders.push(path);
      }
    }
  }
  assert.deepEqual(offenders, [], `${offenders.join(", ")}: call these through callStaffServerFn`);
});

test("the wrapper imports auth through the fixture alias and never reloads", () => {
  const text = code(WRAPPER);
  assert.equal(text.match(/from\s*"@\/auth"/g)?.length ?? 0, 1);
  assert.doesNotMatch(text, /\.server["']/);
  assert.doesNotMatch(text, /server-only/);
  assert.doesNotMatch(text, /location\.reload/);
});

test("the pending list only names files that still need migrating", () => {
  const done = PENDING_TASK_3.filter((path) => !mentionsAuthHeaders(code(path)));
  assert.deepEqual(done, [], `remove migrated files from PENDING_TASK_3: ${done.join(", ")}`);
});

test("no module is still pending migration", () => assert.deepEqual(PENDING_TASK_3, []));
