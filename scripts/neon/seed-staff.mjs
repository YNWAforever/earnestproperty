/**
 * Seed staff_users from the client-approved roster in src/config/site-team.ts.
 *
 * Idempotent on public_slug (constraint added in 20260801090000). Only roster
 * agents are touched: the admin account and the leftover "test" row both have a
 * null public_slug, so they are never matched and stay unpublished.
 *
 * Contact details are optional. Pass a JSON file of transcribed namecard values
 * keyed by slug — { "tommy-yiu": { phone, whatsapp, licence } } — and anything
 * failing validation is written as null rather than guessed:
 *
 *   node scripts/neon/seed-staff.mjs [path/to/agent-contacts.json]
 *
 * Usage:
 *   DATABASE_URL="$(neonctl connection-string production \
 *     --project-id dawn-meadow-79190048 --pooled)" node scripts/neon/seed-staff.mjs
 */
import { existsSync, readFileSync } from "node:fs";

import { neon } from "@neondatabase/serverless";

import { SITE_TEAM } from "../../src/config/site-team.ts";
import {
  normaliseLicence,
  normalisePhone,
  normaliseWhatsapp,
} from "../../src/lib/staff/licence.ts";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. See the usage comment at the top of this file.");
  process.exit(1);
}

const contactsPath = process.argv[2];
if (contactsPath && !existsSync(contactsPath)) {
  console.error(`Contacts file not found: ${contactsPath}`);
  process.exit(1);
}
const contacts = contactsPath ? JSON.parse(readFileSync(contactsPath, "utf8")) : {};

// Every value is hand-transcribed into a hand-authored file with no schema, and
// an unquoted number is the natural thing to type for a HK number (they have no
// leading zero). It is truthy, so normalisePhone's `if (!input)` guard misses it
// and `input.replace` throws partway through the loop.
const shapeErrors = [];
for (const [slug, contact] of Object.entries(contacts)) {
  if (typeof contact !== "object" || contact === null) {
    shapeErrors.push(`${slug}: expected an object, got ${typeof contact}`);
    continue;
  }
  for (const field of ["phone", "whatsapp", "licence"]) {
    const value = contact[field];
    if (value !== undefined && value !== null && typeof value !== "string") {
      shapeErrors.push(`${slug}.${field}: expected a string, got ${typeof value} (${value})`);
    }
  }
}
if (shapeErrors.length) {
  console.error("Contacts file has invalid values:\n  " + shapeErrors.join("\n  "));
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const rejected = [];
const statements = [];

for (const [index, member] of SITE_TEAM.entries()) {
  const contact = contacts[member.slug] ?? {};
  const phone = normalisePhone(contact.phone);
  const whatsapp = normaliseWhatsapp(contact.whatsapp ?? contact.phone);
  const licence = normaliseLicence(contact.licence);

  // A value that was supplied but did not survive validation is reported, never
  // silently dropped — a misread digit routes a real enquiry to a stranger.
  for (const [field, raw, clean] of [
    ["phone", contact.phone, phone],
    ["whatsapp", contact.whatsapp ?? contact.phone, whatsapp],
    ["licence", contact.licence, licence],
  ]) {
    if (raw && !clean) rejected.push(`${member.slug}.${field}: ${JSON.stringify(raw)}`);
  }

  statements.push(sql`
    INSERT INTO staff_users
      (public_slug, name_en, name_zh, job_title, branch, phone, whatsapp,
       licence_no, avatar_url, display_order, active, show_on_website)
    VALUES
      (${member.slug}, ${member.nameEn}, ${member.nameZh}, ${member.jobTitle},
       ${member.branch}, ${phone}, ${whatsapp}, ${licence}, ${member.photo},
       ${index}, true, true)
    ON CONFLICT (public_slug) DO UPDATE SET
      -- Additive only. Neon is the source of truth now, so the admin panel is
      -- where corrections happen; this script's job is to make sure the 23 rows
      -- exist, not to force them to match the file. Overwriting reverted admin
      -- edits, and forcing active/show_on_website republished agents an admin had
      -- deliberately unpublished.
      name_en = COALESCE(staff_users.name_en, EXCLUDED.name_en),
      name_zh = COALESCE(staff_users.name_zh, EXCLUDED.name_zh),
      job_title = COALESCE(staff_users.job_title, EXCLUDED.job_title),
      branch = COALESCE(staff_users.branch, EXCLUDED.branch),
      phone = COALESCE(staff_users.phone, EXCLUDED.phone),
      whatsapp = COALESCE(staff_users.whatsapp, EXCLUDED.whatsapp),
      licence_no = COALESCE(staff_users.licence_no, EXCLUDED.licence_no),
      avatar_url = COALESCE(staff_users.avatar_url, EXCLUDED.avatar_url)
      -- active, show_on_website and display_order are set on INSERT only.
  `);
}

await sql.transaction(statements);

// Scoped to roster slugs. Counting every published row would fail the moment an
// admin unpublishes an agent or adds a 24th through the panel -- both of which
// are supported, so neither is an error this script should report.
const rosterSlugs = SITE_TEAM.map((member) => member.slug);
const [counts] = await sql`
  SELECT count(*)::int AS roster_rows,
         count(*) FILTER (WHERE active AND show_on_website)::int AS published,
         count(*) FILTER (WHERE active AND show_on_website AND branch IS NOT NULL)::int AS with_branch,
         count(*) FILTER (WHERE active AND show_on_website AND whatsapp IS NOT NULL)::int AS with_whatsapp
  FROM staff_users WHERE public_slug = ANY(${rosterSlugs})`;

console.log(
  `roster_rows=${counts.roster_rows}/${SITE_TEAM.length} published=${counts.published} with_branch=${counts.with_branch} with_whatsapp=${counts.with_whatsapp}`,
);
if (rejected.length) console.log("rejected (left null):\n  " + rejected.join("\n  "));

// A missing row means an upsert did not land -- that is a real failure. A roster
// row that exists but is unpublished is an admin decision, so it is reported
// rather than treated as an error.
if (counts.roster_rows !== SITE_TEAM.length) {
  console.error(
    `EXPECTED ${SITE_TEAM.length} roster rows, got ${counts.roster_rows}. An upsert did not land.`,
  );
  process.exit(1);
}
if (counts.published !== SITE_TEAM.length) {
  console.log(
    `note: ${SITE_TEAM.length - counts.published} roster agent(s) are unpublished or inactive — leaving them alone.`,
  );
}
