#!/usr/bin/env node
/**
 * Provisions one readable WhatsApp tracking link per public listing page.
 *
 * ## Why
 *
 * `resolveTrackingLinks()` only uses a link that is `enabled`, verified
 * (`placement_verified_at IS NOT NULL`), in the company channel, with
 * `placement_source='website'` and `entry_point_type='sales'`, bound to the exact
 * (property, listing number, deal type). Production had **one** such link out of
 * 629 canonical listings, so 628 listing pages fell back to the untracked company
 * WhatsApp link and no enquiry could be attributed to a listing.
 *
 * ## What it creates, per missing listing
 *
 *   whatsapp_tracking_links          code = web-<LISTING>-<deal>   (readable)
 *   whatsapp_tracking_link_versions  website / sales / verified / enabled
 *   whatsapp_tracking_link_placements  website:primary, batch-compatible key
 *
 * The destination number does not change: every link still redirects to the same
 * company WhatsApp number. The link only records which listing the click came from.
 *
 * ## Safety
 *
 * - Dry run by default. `--apply` is required to write.
 * - One transaction: either every planned link exists afterwards or none does.
 * - Idempotent: a listing that already has exactly one usable link is skipped, so
 *   re-running after a partial run provisions only what is missing.
 * - The company channel is read from the same env rule the site uses
 *   (`EP_WA_COMPANY_CHANNEL_ID`, else `WOZTELL_CHANNEL_ID` while
 *   `EP_WA_ENQUIRY_MODE` is observe/active), or from `--channel`. It is never
 *   inferred from an existing link: on 2026-10-30 the production channel changed
 *   and the one old verified link still carried the retired channel, which is
 *   exactly how a run can provision 628 links that the redirect then rejects.
 *   Readable links already on a different channel abort the run.
 * - After the write it re-runs the same coverage query the site uses and refuses
 *   to report success unless every canonical listing has exactly one candidate.
 *
 * Usage:
 *   EP_WA_COMPANY_CHANNEL_ID=<id> node scripts/whatsapp/provision-website-links.mjs
 *   EP_WA_COMPANY_CHANNEL_ID=<id> node scripts/whatsapp/provision-website-links.mjs --apply
 *   node scripts/whatsapp/provision-website-links.mjs --apply --expect 628 --channel <id>
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

import { buildWebsiteCoverageQuery } from "../../src/lib/neon/whatsapp-coverage-query.mjs";
import { resolveCompanyChannel } from "./company-channel.mjs";
import { planWebsiteLinks } from "./website-link-codes.mjs";

const ENV_FILE = ".env.local";

function loadEnv() {
  try {
    return Object.fromEntries(
      readFileSync(ENV_FILE, "utf8")
        .split(/\r?\n/)
        .map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line))
        .filter(Boolean)
        .map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, "")]),
    );
  } catch {
    return {};
  }
}

const env = { ...loadEnv(), ...process.env };
const databaseUrl = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL_UNPOOLED or DATABASE_URL is required.");
  process.exit(1);
}
const target = new URL(databaseUrl);
console.log(`target: ${target.host}${target.pathname} as ${decodeURIComponent(target.username)}`);

const apply = process.argv.includes("--apply");
const expectIndex = process.argv.indexOf("--expect");
const expectCount = expectIndex >= 0 ? Number(process.argv[expectIndex + 1]) : null;
if (expectIndex >= 0 && !Number.isInteger(expectCount)) {
  console.error("--expect needs an integer.");
  process.exit(1);
}

const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

const { channelId, source: channelSource } = resolveCompanyChannel({ env, argv: process.argv });
console.log(`company channel: ${channelId} (from ${channelSource})`);

// A readable link on another channel means a previous run used a different
// company channel. Provisioning now would duplicate codes and leave the old
// links inert; move them to a new version first.
const { rows: foreignChannels } = await client.query(
  `SELECT v.channel_id, count(*)::int AS n
     FROM whatsapp_tracking_links l
     JOIN whatsapp_tracking_link_versions v ON v.link_id = l.id AND l.current_version = v.version
    WHERE l.code LIKE 'web-%' AND v.channel_id <> $1
    GROUP BY v.channel_id
    ORDER BY n DESC`,
  [channelId],
);
if (foreignChannels.length) {
  throw new Error(
    `readable links already exist on another channel: ${JSON.stringify(foreignChannels)}. ` +
      `The company channel changed; re-version those links to ${channelId} before provisioning.`,
  );
}

const coverage = async () =>
  (await client.query(buildWebsiteCoverageQuery(), [channelId, null, null, null])).rows;

const before = await coverage();
const plan = planWebsiteLinks({ channelId, listings: before });
console.log(
  `canonical listings: ${before.length} — to create: ${plan.create.length}, ` +
    `already covered: ${plan.skip}, ambiguous (left alone): ${plan.ambiguous}`,
);
console.log("sample codes:", JSON.stringify(plan.create.slice(0, 5).map((row) => row.code)));

if (plan.create.length === 0) {
  console.log("nothing to do");
  await client.end();
  process.exit(0);
}

if (expectCount !== null && plan.create.length !== expectCount) {
  console.error(`refusing: planned ${plan.create.length} but --expect ${expectCount}`);
  await client.end();
  process.exit(1);
}

if (!apply) {
  console.log("\nDRY RUN — no writes. Re-run with --apply.");
  await client.end();
  process.exit(0);
}

const { rows: adminRows } = await client.query(
  `SELECT s.id FROM staff_users s JOIN staff_roles r ON r.staff_user_id = s.id
    WHERE s.active AND r.role = 'admin' ORDER BY s.created_at LIMIT 1`,
);
const actorId = adminRows[0]?.id ?? null;

await client.query("BEGIN");
try {
  for (const row of plan.create) {
    const linkId = randomUUID();
    await client.query(
      "INSERT INTO whatsapp_tracking_links(id, code, current_version, created_by) VALUES($1::uuid,$2,1,$3::uuid)",
      [linkId, row.code, actorId],
    );
    await client.query(
      `INSERT INTO whatsapp_tracking_link_versions(
         link_id, version, channel_id, placement_source, entry_point_type,
         public_listing_no, property_id, deal_type, enabled, created_by, placement_verified_at)
       VALUES($1::uuid,1,$2,'website','sales',$3,$4::uuid,$5,true,$6::uuid,now())`,
      [linkId, channelId, row.publicListingNo, row.propertyId, row.dealType, actorId],
    );
    await client.query(
      `INSERT INTO whatsapp_tracking_link_placements(placement_key, placement_id, link_id)
       VALUES($1,'website:primary',$2::uuid)`,
      [row.placementKey, linkId],
    );
  }
  await client.query("COMMIT");
  console.log(`committed ${plan.create.length} tracking links`);
} catch (error) {
  await client.query("ROLLBACK");
  await client.end();
  throw error;
}

const after = await coverage();
const bad = after.filter((row) => Number(row.candidate_count) !== 1);
console.log(
  `post-check: ${after.length - bad.length} / ${after.length} listings have exactly one link`,
);
if (bad.length) {
  console.error("NOT CLEAN:", JSON.stringify(bad.slice(0, 10)));
  await client.end();
  process.exit(1);
}

await client.end();
console.log("DONE");
