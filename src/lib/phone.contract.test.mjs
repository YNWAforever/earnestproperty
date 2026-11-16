import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import test from "node:test";

import { hkLocalNumber, normalizePhone } from "./phone.js";
import { normalizeAdminPhone } from "./neon/admin-workflow.ts";
import { normalizePhoneDigits } from "./contact-links.ts";
import { normalisePhone } from "./staff/licence.ts";
import { validateHandoffPhone } from "./ai/live-agent.ts";
import { splitSqlStatements } from "../../scripts/acceptance/migrated-schema.mjs";

// FX-12 (D-12): every parser that turns a typed or received phone into an
// identity agrees with src/lib/phone.js, and no SQL copy of the phone match
// lives anywhere else.

const INPUTS = [
  // Behaviour-change table (FX-12 Task 1).
  "00852 9123 4567",
  "+9123 4567",
  "９１２３ ４５６７",
  "９１２３　４５６７",
  "0044 20 7946 0958",
  "9123456",
  "123456789",
  "01234567",
  "9123 4567 ext 12",
  // Inputs that keep today's output.
  "9123 4567",
  "+852 9123-4567",
  "0085291234567",
  "85291234567",
  "(852) 9123 4567",
  "９１２３４５６７",
  "2688 2988",
  "+852 2688 2988",
  "(852) 6123-4567",
  "+44 20 7946 0958",
  "+86 138 1234 5678",
  "8613812345678",
  "+852 6090 3521",
  " 6090-3521 ",
  "85260903521",
  // Labelled and punctuated spellings (fix round 1, I-1/I-2, Minor 2).
  "Tel: 9123 4567",
  "T: +852 9123 4567",
  "(+852) 9123 4567",
  "9123/4567",
  "(852)91234567",
  "+852-9123-4567",
  "電話：2688 2988",
  "WhatsApp: 6123 4567",
  "9123\t4567",
  "-+14384031",
  "+9123 4567",
  "+2688 2988",
  // Groupings the live agent used to join that the normaliser does not (final fix wave).
  "91 23 45 67",
  "9 1 2 3 4 5 6 7",
  "8529123 4567",
  "852 9123 45 67",
  // Garbage.
  "9123 4567 / 9876 5432",
  "Fax: 9123 4567",
  "85212345678",
  "",
  null,
  undefined,
  "+",
  "abc",
  "n/a",
  "00000000",
  "12345678",
  "42345678",
  "+852 9123 456",
  "+85212345678",
  "+1234567890123456",
];

test("every customer-phone parser agrees with normalizePhone", () => {
  for (const input of INPUTS) {
    const label = JSON.stringify(input);
    const canonical = normalizePhone(input);
    assert.equal(normalizeAdminPhone(input), canonical, "normalizeAdminPhone " + label);
    assert.equal(normalizePhoneDigits(input), canonical, "normalizePhoneDigits " + label);
    const local = hkLocalNumber(canonical);
    const expectedStaff = local && /^[23569]\d{7}$/.test(local) ? local : null;
    assert.equal(normalisePhone(input), expectedStaff, "normalisePhone " + label);
    const handoff = validateHandoffPhone(input);
    if (handoff.ok) {
      assert.equal(handoff.normalized, canonical, "validateHandoffPhone " + label);
    }
  }
});

const ROOT = process.cwd();
const ALLOWLIST = new Map([
  // Fact 6: the FX-05b staff-destination guard compares every legacy spelling
  // on both sides on purpose and refuses more than it needs to.
  ["src/lib/whatsapp-enquiries/staff-recipient-guard.ts", "FX-05b staff guard (Fact 6)"],
  // #237: a detector that strips phone numbers before listing-number parsing.
  ["src/lib/ai/live-agent-intent.ts", "#237 HK_PHONE_RE detector, not identity"],
  // The company WhatsApp number from env, not a customer identity.
  ["src/config/whatsapp-phone.js", "company env number, not a customer"],
  // The one home of the phone match.
  ["src/lib/phone.js", "the canonical builder"],
]);

function sourceFiles(dir) {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = dir + "/" + entry.name;
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx|js|mjs|sql)$/.test(entry.name)) return [];
    if (/\.test\.(ts|tsx|js|mjs)$/.test(entry.name)) return [];
    if (entry.name.endsWith(".d.ts")) return [];
    return [path];
  });
}

const INFO_REFUSAL_MIGRATION = "neon/migrations/20261116010000_enquiry_information_scope.sql";
// This exact applied statement records D11's refusal set; it never resolves a customer.
// Pin its body rather than exempting the migration: edits and additional matches still fail.
const INFO_REFUSAL_STATEMENT_SHA256 =
  "d6da02e87d33cbd68e4f49017eb7fd893227dcb2ac9f5bd193cdeea915ce3e4d";
const sourceHash = (source) =>
  createHash("sha256").update(source.replaceAll("\r\n", "\n")).digest("hex");

function hasInlinePhoneMatch(path, source) {
  // A stored normalizer and a caller are separate SQL statements. Keep dollar-quoted
  // function bodies intact so an inline customer match inside either one still fails.
  // The migration splitter does not lex block comments. Preserve the original
  // file-wide guard for that syntax, where a comment's semicolon is not a boundary.
  const scopes =
    path.endsWith(".sql") && !source.includes("/*") ? splitSqlStatements(source) : [source];
  return scopes.some((scope) => {
    if (
      path === INFO_REFUSAL_MIGRATION &&
      scope.startsWith("CREATE FUNCTION enquiry_info_phone_snapshot(") &&
      sourceHash(scope) === INFO_REFUSAL_STATEMENT_SHA256
    )
      return false;
    const compact = scope.replace(/\s+/g, "");
    const twoFormat = compact.includes("left($") && compact.includes(",3)='852'");
    const prefix = compact.includes("'852'||") && compact.includes("normalized_phone");
    // Minor 9: a copy that only takes the last eight digits of a param.
    const lastEight =
      /right\(\$\d+(::text)?,8\)/.test(compact) && compact.includes("normalized_phone");
    return twoFormat || prefix || lastEight;
  });
}

test("SQL block comments cannot split an unsafe phone match out of the audit", () => {
  for (const unsafe of [
    "SELECT id FROM crm_contacts WHERE normalized_phone = CASE WHEN left($1::text/* ; */,3)='852' THEN $1 ELSE $2 END;",
    "SELECT id FROM crm_contacts WHERE normalized_phone = /* ; */ '852' || $1;",
    "SELECT id FROM crm_contacts WHERE normalized_phone = /* ; */ right($1::text,8);",
  ])
    assert.equal(hasInlinePhoneMatch("neon/migrations/phone-control.sql", unsafe), true, unsafe);
});

test("SQL statement boundaries do not hide inline customer phone matches", () => {
  const path = "neon/migrations/20261116000000_enquiry_forwarding.sql";
  const migration = readFileSync(join(ROOT, path), "utf8");
  const statements = splitSqlStatements(migration);
  const normalizer = statements.find((statement) =>
    statement.startsWith("CREATE OR REPLACE FUNCTION enquiry_notification_phone("),
  );
  assert.ok(normalizer, "inspect the real canonical SQL function definition");
  assert.ok(statements.some((statement) => statement.includes("normalized_phone")));
  assert.ok(normalizer.includes("'852'||"));
  assert.ok(!normalizer.includes("normalized_phone"));
  assert.equal(hasInlinePhoneMatch(path, migration), false);
  // The old cross-statement false positive remains detectable in file-scoped TS/JS.
  for (const extension of ["ts", "tsx", "js", "mjs"])
    assert.equal(hasInlinePhoneMatch(`src/lib/phone-scan-control.${extension}`, migration), true);

  const unsafeMatches = [
    "SELECT id::text FROM crm_contacts WHERE normalized_phone = CASE WHEN left($1::text,3)='852' THEN $1 ELSE $2 END;",
    "SELECT id::text FROM crm_contacts WHERE normalized_phone = '852' || $1;",
    "SELECT id::text FROM crm_contacts WHERE normalized_phone = right($1::text,8);",
  ];
  for (const unsafe of unsafeMatches) {
    assert.equal(hasInlinePhoneMatch(path, `${migration}\n${unsafe}`), true, unsafe);
    assert.equal(hasInlinePhoneMatch(path, `${unsafe}\n${migration}`), true, unsafe);
    const poisoned = migration.replace(normalizer, () =>
      normalizer.replace(/\$\$$/, () => `;\n${unsafe}\n$$`),
    );
    assert.notEqual(poisoned, migration, "place the unsafe query inside the real function body");
    assert.equal(splitSqlStatements(poisoned).length, statements.length);
    assert.equal(hasInlinePhoneMatch(path, poisoned), true, unsafe);
  }
});

test("only the exact applied D11 refusal statement is separate from customer identity matching", () => {
  const migration = readFileSync(join(ROOT, INFO_REFUSAL_MIGRATION), "utf8");
  assert.equal(
    sourceHash(migration),
    "11842315c9934a183d098ff160e2ba481d921d9b7381ba034e4af8a7dbd84985",
    "the already applied migration remains immutable",
  );
  const statements = splitSqlStatements(migration);
  const snapshot = statements.find((statement) =>
    statement.startsWith("CREATE FUNCTION enquiry_info_phone_snapshot("),
  );
  assert.ok(snapshot);
  assert.equal(sourceHash(snapshot), INFO_REFUSAL_STATEMENT_SHA256);
  assert.equal(hasInlinePhoneMatch(INFO_REFUSAL_MIGRATION, migration), false);
  assert.equal(hasInlinePhoneMatch("neon/migrations/phone-control.sql", migration), true);
  for (const unsafe of [
    "SELECT id::text FROM crm_contacts WHERE normalized_phone = CASE WHEN left($1::text,3)='852' THEN $1 ELSE $2 END;",
    "SELECT id::text FROM crm_contacts WHERE normalized_phone = '852' || $1;",
    "SELECT id::text FROM crm_contacts WHERE normalized_phone = right($1::text,8);",
  ]) {
    assert.equal(hasInlinePhoneMatch(INFO_REFUSAL_MIGRATION, `${migration}\n${unsafe}`), true);
    assert.equal(hasInlinePhoneMatch(INFO_REFUSAL_MIGRATION, `${unsafe}\n${migration}`), true);
    const poisoned = migration.replace(snapshot, () =>
      snapshot.replace(/\$\$$/, () => `;\n${unsafe}\n$$`),
    );
    assert.notEqual(poisoned, migration);
    assert.equal(splitSqlStatements(poisoned).length, statements.length);
    assert.equal(hasInlinePhoneMatch(INFO_REFUSAL_MIGRATION, poisoned), true);
  }
});

test("no SQL copy of the phone match outside phone.js", () => {
  const migrations = sourceFiles("neon/migrations").filter((path) => {
    const stamp = /\/(\d{8})/.exec(path)?.[1];
    return stamp !== undefined && stamp >= "20261013";
  });
  const files = [...sourceFiles("src"), ...migrations].filter(
    (path) => !ALLOWLIST.has(relative(ROOT, join(ROOT, path)).replaceAll("\\", "/")),
  );
  const offenders = files.filter((path) =>
    hasInlinePhoneMatch(path, readFileSync(join(ROOT, path), "utf8")),
  );
  assert.deepEqual(
    offenders,
    [],
    "D-12: these files build their own SQL phone match. Use phoneMatchSql or " +
      "phoneEquivalentsSql from src/lib/phone.js so every customer path knows every " +
      "legacy spelling (8 digits, 852, 00852):\n" +
      offenders.map((path) => "  " + path).join("\n"),
  );
});
