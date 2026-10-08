import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

import { hkLocalNumber, normalizePhone } from "./phone.js";
import { normalizeAdminPhone } from "./neon/admin-workflow.ts";
import { normalizePhoneDigits } from "./contact-links.ts";
import { normalisePhone } from "./staff/licence.ts";
import { validateHandoffPhone } from "./ai/live-agent.ts";

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

test("no SQL copy of the phone match outside phone.js", () => {
  const migrations = sourceFiles("neon/migrations").filter((path) => {
    const stamp = /\/(\d{8})/.exec(path)?.[1];
    return stamp !== undefined && stamp >= "20261013";
  });
  const files = [...sourceFiles("src"), ...migrations].filter(
    (path) => !ALLOWLIST.has(relative(ROOT, join(ROOT, path)).replaceAll("\\", "/")),
  );
  const offenders = files.filter((path) => {
    const compact = readFileSync(join(ROOT, path), "utf8").replace(/\s+/g, "");
    const twoFormat = compact.includes("left($") && compact.includes(",3)='852'");
    const prefix = compact.includes("'852'||") && compact.includes("normalized_phone");
    // Minor 9: a copy that only takes the last eight digits of a param.
    const lastEight =
      /right\(\$\d+(::text)?,8\)/.test(compact) && compact.includes("normalized_phone");
    return twoFormat || prefix || lastEight;
  });
  assert.deepEqual(
    offenders,
    [],
    "D-12: these files build their own SQL phone match. Use phoneMatchSql or " +
      "phoneEquivalentsSql from src/lib/phone.js so every customer path knows every " +
      "legacy spelling (8 digits, 852, 00852):\n" +
      offenders.map((path) => "  " + path).join("\n"),
  );
});
