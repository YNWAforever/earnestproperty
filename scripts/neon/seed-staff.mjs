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
import { normaliseLicence, normalisePhone } from "../../src/lib/staff/licence.ts";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. See the usage comment at the top of this file.");
  process.exit(1);
}

const contactsPath = process.argv[2];
const contacts =
  contactsPath && existsSync(contactsPath) ? JSON.parse(readFileSync(contactsPath, "utf8")) : {};
if (contactsPath && !existsSync(contactsPath)) {
  console.error(`Contacts file not found: ${contactsPath}`);
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const rejected = [];

for (const [index, member] of SITE_TEAM.entries()) {
  const contact = contacts[member.slug] ?? {};
  const phone = normalisePhone(contact.phone);
  const whatsapp = normalisePhone(contact.whatsapp ?? contact.phone);
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

  await sql`
    INSERT INTO staff_users
      (public_slug, name_en, name_zh, job_title, branch, phone, whatsapp,
       licence_no, avatar_url, display_order, active, show_on_website)
    VALUES
      (${member.slug}, ${member.nameEn}, ${member.nameZh}, ${member.jobTitle},
       ${member.branch}, ${phone}, ${whatsapp}, ${licence}, ${member.photo},
       ${index}, true, true)
    ON CONFLICT (public_slug) DO UPDATE SET
      name_en = EXCLUDED.name_en,
      name_zh = COALESCE(EXCLUDED.name_zh, staff_users.name_zh),
      job_title = EXCLUDED.job_title,
      branch = EXCLUDED.branch,
      -- COALESCE so a re-run without a contacts file never blanks a value an
      -- admin has since filled in by hand.
      phone = COALESCE(EXCLUDED.phone, staff_users.phone),
      whatsapp = COALESCE(EXCLUDED.whatsapp, staff_users.whatsapp),
      licence_no = COALESCE(EXCLUDED.licence_no, staff_users.licence_no),
      avatar_url = EXCLUDED.avatar_url,
      display_order = EXCLUDED.display_order,
      active = true,
      show_on_website = true
  `;
}

const [counts] = await sql`
  SELECT count(*) FILTER (WHERE show_on_website)::int AS published,
         count(*) FILTER (WHERE show_on_website AND branch IS NOT NULL)::int AS with_branch,
         count(*) FILTER (WHERE show_on_website AND whatsapp IS NOT NULL)::int AS with_whatsapp
  FROM staff_users`;

console.log(
  `published=${counts.published} with_branch=${counts.with_branch} with_whatsapp=${counts.with_whatsapp}`,
);
if (counts.published !== SITE_TEAM.length) {
  console.error(
    `EXPECTED ${SITE_TEAM.length} published rows. A different count means a row without a roster slug got published — check before leaving this.`,
  );
}
if (rejected.length) console.log("rejected (left null):\n  " + rejected.join("\n  "));
