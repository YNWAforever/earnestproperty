#!/usr/bin/env node
/**
 * Backfill property_agents from the approved source listings.
 *
 * 28hse agent:540 listing detail pages name two agents by EAA licence number
 * ("代理個人牌照號碼: S-098767" twice); property.hk names one in the URL
 * (/asking_detail/<branch>/<agent>/<id>.html). staff_users.licence_no uses the same
 * licence format, so the source agent maps to staff deterministically.
 *
 * Usage:
 *   node scripts/property-sync/backfill-property-agents.mjs --source=28hse --limit=5 --dry-run
 *   node scripts/property-sync/backfill-property-agents.mjs --source=all
 *
 * Flags: --source=28hse|propertyhk|all (default all), --limit=N, --dry-run,
 *        --force (refetch even when the property already has two agents),
 *        --since-days=N (28hse only: only properties created in the last N days),
 *        --withdraw-gone (28hse only: mark a listing inactive when its detail URL now redirects
 *        to an estate page and it has no Property.hk advertisement; needs
 *        --withdraw-actor=<staff uuid>, the owner-approved admin actor recorded in audit_logs),
 *        --from-payload=<path> (read the agent contacts the 28hse sync already parsed from each
 *        detail page, so no Firecrawl fetch is made),
 *        --delay-ms=4500 (between source fetches; Firecrawl allows ~15-20/min).
 *
 * The propertyhk run also fills the branch 主管 as the second correspondent (Property.hk
 * names only one agent), and the cross-listed listings get their Property.hk agent from the
 * recorded observation. Both need no fetch, so the daily owner-publication workflow runs
 * `--source=propertyhk` after publishing to keep new listings covered.
 */
import { readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";

const FIRECRAWL_API_URL = "https://api.firecrawl.dev/v2/scrape";
const FIRECRAWL_OPTIONS = {
  formats: ["rawHtml"],
  proxy: "basic",
  maxAge: 0,
  storeInCache: false,
  skipTlsVerification: false,
  onlyMainContent: false,
  timeout: 25000,
};

/** property.hk agent blog slug → staff public slug (from config/propertyhk-agents.json). */
export const PROPERTYHK_AGENT_SLUGS = Object.freeze({
  "ept/tommyyiu": "tommy-yiu",
  "ept/king": "king-lau",
  "ept/joeyuen": "joe-yuen",
  "ept/mon": "mon-lau",
  "ept/lee": "kelvin-lee",
  "ept/shadow": "shadow-cheung",
  "ept/winnie": "winnie-cheung",
  "ept/joanna": "joanna-tang",
  "eps/kelvin": "kelvin-lee",
  "eps/ruby": "ruby-lee",
  "eps/wendy": "wendy-lu",
  "eps/terry": "terry-chan",
  "eps/eunice": "eunice-yau",
  "epw/sam": "sam-lee",
  "epw/mike": "mike-cheung",
  "epw/george": "george-chau",
  "epw/vincy": "vincy-lam",
  "epw/eric": "eric-lai",
  "epw/dickson": "dickson-wong",
});

/** Normalise a licence number for matching: "s 098767" / "S-098767" → "S-098767". */
export function normalizeLicence(value) {
  const match = /([SE])\s*-?\s*(\d{6})/i.exec(String(value ?? ""));
  return match ? `${match[1].toUpperCase()}-${match[2]}` : null;
}

/** The two agent licences on a 28hse listing detail page, in page order. */
export function extract28hseAgentLicences(html) {
  const found = [];
  const pattern = /代理個人牌照號碼[:：]?\s*(?:<\/?[a-z][^>]*>\s*)*([SE]-\d{6})/gi;
  for (const match of String(html ?? "").matchAll(pattern)) {
    const licence = normalizeLicence(match[1]);
    if (licence && !found.includes(licence)) found.push(licence);
  }
  return found.slice(0, 2);
}

/** The 28hse "放盤聯絡人" names next to each licence block, in page order. */
export function extract28hseAgentNames(html) {
  const names = [];
  const pattern = /放盤聯絡人\s*(?:<\/?[a-z][^>]*>\s*)*([^<]{2,30})/g;
  for (const match of String(html ?? "").matchAll(pattern)) {
    const name = match[1].replace(/\s+/g, " ").trim();
    if (name) names.push(name);
  }
  return names;
}

/**
 * The branch 主管 who fills the second correspondent slot. Property.hk names only the listing
 * agent, so the senior 營業經理 of that agent's branch stands in as the second colleague; when
 * the agent already is the manager, the branch's next colleague by display order is used.
 * Pure: `branchStaff` rows are `staff_users` shaped, so `node --test` covers the rule.
 */
export function pickBranchManager(branchStaff, currentStaffId) {
  const eligible = (branchStaff ?? []).filter((row) => row.id !== currentStaffId);
  if (eligible.length === 0) return null;
  const rank = (row) => {
    if (/營業經理/.test(String(row.job_title ?? ""))) return 0;
    if (row.is_duty_manager) return 1;
    return 2;
  };
  return [...eligible].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      Number(a.display_order ?? 0) - Number(b.display_order ?? 0) ||
      String(a.id).localeCompare(String(b.id)),
  )[0];
}

/**
 * A 28hse detail fetch that is no longer the listing itself: the URL redirected to an estate
 * page, or the page no longer carries the listing markers. Challenge/blocked pages are small
 * and are treated as a fetch failure, never as "gone", so a bad scrape cannot withdraw stock.
 */
export function is28hseDetailGone({ requestedUrl, finalUrl, html }) {
  const text = String(html ?? "");
  if (text.length < 2000) return false;
  if (finalUrl) {
    const normalize = (value) => {
      try {
        const url = new URL(value);
        return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
      } catch {
        return String(value);
      }
    };
    if (normalize(finalUrl) !== normalize(requestedUrl)) return true;
  }
  return !/代理個人牌照號碼|放盤聯絡人/.test(text);
}

/**
 * The agent contacts the 28hse collector already fetched on each listing's detail page
 * (`raw_payload.agent_contacts`, added by the sync's detail parse). Reading the frozen
 * sync payload means the correspondent agents cost no extra Firecrawl fetch.
 */
export function payloadAgentListings(payload) {
  if (payload?.source !== "28hse") throw new Error("payload_source_mismatch");
  const listings = Array.isArray(payload.listings) ? payload.listings : [];
  return listings
    .map((listing) => ({
      externalId: String(listing?.property_id ?? ""),
      dealType:
        listing?.deal_type === "sale" || listing?.deal_type === "rent" ? listing.deal_type : null,
      sourceUrl: typeof listing?.source_url === "string" ? listing.source_url : null,
      contacts: (Array.isArray(listing?.raw_payload?.agent_contacts)
        ? listing.raw_payload.agent_contacts
        : []
      )
        .map((contact) => ({
          name: typeof contact?.name === "string" && contact.name.trim() ? contact.name : null,
          licence: normalizeLicence(contact?.licence),
        }))
        .filter((contact) => contact.licence),
    }))
    .filter((listing) => listing.externalId && listing.dealType && listing.contacts.length);
}

/** property.hk detail URL → staff public slug. */
export function propertyhkAgentSlug(url) {
  const match = /^\/asking_detail\/([a-z]+\/[a-z0-9_-]+)\/\d{1,12}\.html$/.exec(
    new URL(url).pathname,
  );
  return match ? match[1] : null;
}

function argValue(argv, name, fallback) {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function loadEnv() {
  const env = {};
  for (const file of [".env", ".env.local"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
  return { ...env, ...process.env };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchFirecrawl(url, apiKey) {
  // Firecrawl's plan rate limit is ~15-20 requests/minute; a 429 is waited out rather than
  // counted as a failed property.
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(FIRECRAWL_API_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ url, ...FIRECRAWL_OPTIONS }),
    });
    const body = await response.json().catch(() => null);
    if (response.status === 429 && attempt < 4) {
      await sleep(60_000);
      continue;
    }
    if (!response.ok || !body?.success) {
      throw new Error(
        `firecrawl_http_${response.status}: ${String(body?.error ?? "").slice(0, 120)}`,
      );
    }
    const data = body?.data ?? {};
    const metadata = data.metadata ?? {};
    return {
      html: String(data.rawHtml ?? ""),
      finalUrl: metadata.url ?? metadata.sourceURL ?? null,
      statusCode: Number.isInteger(metadata.statusCode) ? metadata.statusCode : null,
    };
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const source = argValue(argv, "source", "all");
  const limit = Number(argValue(argv, "limit", "0")) || 0;
  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force");
  const withdrawGone = argv.includes("--withdraw-gone");
  const withdrawActor = argValue(argv, "withdraw-actor", "");
  const delayMs = Number(argValue(argv, "delay-ms", "4500"));
  const sinceDays = Number(argValue(argv, "since-days", "0")) || 0;
  // "null" targets the legacy stock whose source_site is empty but whose source_url is 28hse.
  const sourceSite = argValue(argv, "source-site", "");
  // The 28hse sync payload already carries the detail-page agent contacts (no extra fetch).
  const fromPayload = argValue(argv, "from-payload", "");
  if (!["28hse", "propertyhk", "all"].includes(source)) throw new Error("bad --source");
  if (fromPayload && source === "all") throw new Error("--from-payload requires --source=28hse");

  const env = loadEnv();
  const databaseUrl = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL || env.IMPORT_DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (
    withdrawGone &&
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(withdrawActor)
  )
    throw new Error("--withdraw-gone requires --withdraw-actor=<staff uuid>");
  const apiKey = env.FIRECRAWL_API_KEY;
  if (!apiKey && source !== "propertyhk" && !fromPayload)
    throw new Error("FIRECRAWL_API_KEY is required");
  const sql = neon(databaseUrl);

  const staff = await sql`
    SELECT id, licence_no, public_slug, name_en, branch, job_title, is_duty_manager, display_order,
           active, coalesce((to_jsonb(staff_users)->>'show_on_website')::boolean, false) AS show_on_website
    FROM staff_users WHERE active`;
  const byLicence = new Map();
  const bySlug = new Map();
  const byBranch = new Map();
  for (const row of staff) {
    const licence = normalizeLicence(row.licence_no);
    if (licence) byLicence.set(licence, row);
    if (row.public_slug) bySlug.set(row.public_slug, row);
    if (row.show_on_website && row.branch) {
      if (!byBranch.has(row.branch)) byBranch.set(row.branch, []);
      byBranch.get(row.branch).push(row);
    }
  }
  console.log(`staff: ${staff.length} active, ${byLicence.size} with a licence`);

  let written = 0;
  let skipped = 0;
  let withdrawn = 0;
  const gone = [];
  const failures = [];

  async function upsert(propertyId, agents) {
    const unique = [];
    for (const agent of agents) {
      if (agent && !unique.some((existing) => existing.staffId === agent.staffId))
        unique.push(agent);
    }
    if (unique.length === 0) {
      skipped += 1;
      return;
    }
    if (dryRun) {
      written += 1;
      return;
    }
    await sql`DELETE FROM property_agents WHERE property_id = ${propertyId}::uuid`;
    for (const [index, agent] of unique.slice(0, 2).entries()) {
      await sql`
        INSERT INTO property_agents (property_id, position, staff_id, source, source_name, source_licence_no, source_ref)
        VALUES (${propertyId}::uuid, ${index + 1}, ${agent.staffId}::uuid, ${agent.source},
                ${agent.sourceName ?? null}, ${agent.sourceLicenceNo ?? null}, ${agent.sourceRef ?? null})`;
    }
    written += 1;
  }

  /** Keep the agents a property already has and fill the free slots from `incoming`. */
  async function merge(propertyId, incoming) {
    const existing = await sql`
      SELECT staff_id, source, source_name, source_licence_no, source_ref
      FROM property_agents WHERE property_id = ${propertyId}::uuid ORDER BY position`;
    const combined = [];
    const seen = new Set();
    const candidates = [
      ...existing.map((row) => ({
        staffId: row.staff_id,
        source: row.source,
        sourceName: row.source_name,
        sourceLicenceNo: row.source_licence_no,
        sourceRef: row.source_ref,
      })),
      ...incoming,
    ];
    for (const agent of candidates) {
      if (!agent || seen.has(agent.staffId)) continue;
      seen.add(agent.staffId);
      combined.push(agent);
    }
    const next = combined.slice(0, 2);
    const unchanged =
      next.length === existing.length &&
      next.every((agent, index) => agent.staffId === existing[index].staff_id);
    if (unchanged) {
      skipped += 1;
      return;
    }
    if (dryRun) {
      written += 1;
      return;
    }
    await sql`DELETE FROM property_agents WHERE property_id = ${propertyId}::uuid`;
    for (const [index, agent] of next.entries()) {
      await sql`
        INSERT INTO property_agents (property_id, position, staff_id, source, source_name, source_licence_no, source_ref)
        VALUES (${propertyId}::uuid, ${index + 1}, ${agent.staffId}::uuid, ${agent.source},
                ${agent.sourceName ?? null}, ${agent.sourceLicenceNo ?? null}, ${agent.sourceRef ?? null})`;
    }
    written += 1;
  }

  async function run28hse() {
    // Any active property that points at a 28hse detail page, not only the ones the 28hse sync
    // tracked in mls_source_state: listings created by the owner capture carry a 28hse URL
    // without a source-state row, and they used to be skipped forever.
    const properties = await sql`
      SELECT DISTINCT p.id, p.listing_no, p.source_url,
        (SELECT count(*)::int FROM property_agents a WHERE a.property_id = p.id) AS agent_count,
        EXISTS (SELECT 1 FROM property_source_links l
                WHERE l.property_id = p.id AND l.source = 'propertyhk') AS has_propertyhk_link,
        (SELECT min(m.public_listing_no) FROM property_public_members m
         WHERE m.property_id = p.id) AS public_listing_no
      FROM properties p
      WHERE p.status = 'active'
        AND p.source_url ~ '^https://www\.28hse\.com/(buy|rent)/[^/]+/property-[0-9]+/?$'
        AND (p.source_site = '28hse'
             OR EXISTS (SELECT 1 FROM mls_source_state s
                        WHERE s.property_id = p.id AND s.source = '28hse_agent_540'))
        AND (${sinceDays}::int = 0 OR p.created_at > now() - make_interval(days => ${sinceDays}::int))
        AND (${sourceSite} = '' OR (${sourceSite} = 'null' AND p.source_site IS NULL)
             OR p.source_site = ${sourceSite})
      ORDER BY p.listing_no`;
    const todo = force ? properties : properties.filter((row) => row.agent_count < 2);
    const limited = limit ? todo.slice(0, limit) : todo;
    console.log(
      `28hse: ${properties.length} properties, ${todo.length} to fill, running ${limited.length}`,
    );
    for (const [index, property] of limited.entries()) {
      try {
        const fetched = await fetchFirecrawl(property.source_url, apiKey);
        if (is28hseDetailGone({ requestedUrl: property.source_url, ...fetched })) {
          gone.push({
            property: property.listing_no,
            sourceUrl: property.source_url,
            finalUrl: fetched.finalUrl,
            statusCode: fetched.statusCode,
          });
          // A listing with a live Property.hk advertisement is not withdrawn: the 28hse
          // listing being gone does not mean the property is off the market. The withdrawal
          // goes through the same admin function the admin UI uses (audit log + source
          // snapshot + ownership fence), never a bare UPDATE.
          if (withdrawGone && !property.has_propertyhk_link && !dryRun) {
            if (!property.public_listing_no) {
              failures.push({
                property: property.listing_no,
                error: "withdraw_unavailable:no_public_listing_no",
              });
            } else {
              await sql`
                SELECT admin_property_manage(
                  ${property.public_listing_no},
                  admin_property_group_version(${property.public_listing_no}),
                  'all',
                  '{"status":"inactive"}'::jsonb,
                  ${withdrawActor}::uuid)`;
              withdrawn += 1;
            }
          }
          continue;
        }
        const licences = extract28hseAgentLicences(fetched.html);
        const names = extract28hseAgentNames(fetched.html);
        const agents = licences.map((licence, position) => {
          const match = byLicence.get(licence);
          return match
            ? {
                staffId: match.id,
                source: "28hse_agent_540",
                sourceName: names[position] ?? match.name_en,
                sourceLicenceNo: licence,
                sourceRef: property.source_url,
              }
            : null;
        });
        await upsert(property.id, agents.filter(Boolean));
        if ((index + 1) % 10 === 0 || index === 0) {
          console.log(
            `  28hse ${index + 1}/${limited.length} ${property.listing_no} -> ${licences.join(",") || "none"}`,
          );
        }
      } catch (error) {
        failures.push({ property: property.listing_no, error: String(error).slice(0, 160) });
      }
      await sleep(delayMs);
    }
  }

  /**
   * Write the correspondents the 28hse sync already parsed from each listing's detail page.
   * The payload is the frozen sync request, so the agent data costs no extra source fetch.
   */
  async function runFromPayload(path) {
    // Tolerate a UTF-8 BOM (the frozen payload itself is written without one).
    const payload = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
    const listings = payloadAgentListings(payload);
    console.log(`28hse payload: ${listings.length} listings with detail-page agent contacts`);
    for (const listing of listings) {
      const agents = [];
      for (const contact of listing.contacts.slice(0, 2)) {
        const match = byLicence.get(contact.licence);
        if (!match) continue;
        agents.push({
          staffId: match.id,
          source: "28hse_agent_540",
          sourceName: contact.name ?? match.name_en,
          sourceLicenceNo: contact.licence,
          sourceRef: listing.sourceUrl,
        });
      }
      if (agents.length === 0) {
        skipped += 1;
        failures.push({
          property: listing.externalId,
          error: `unmapped_agent_licence:${listing.contacts.map((contact) => contact.licence).join(",")}`,
        });
        continue;
      }
      const links = await sql`
        SELECT property_id FROM property_source_links
        WHERE source = '28hse_agent_540'
          AND external_listing_id = ${listing.externalId}
          AND deal_type::text = ${listing.dealType}
          AND status = 'active'`;
      if (links.length === 0) {
        failures.push({ property: listing.externalId, error: "no_property_link" });
        continue;
      }
      for (const link of links) await merge(link.property_id, agents);
    }
  }

  async function runPropertyhk() {
    const properties = await sql`
      SELECT DISTINCT p.id, p.listing_no, p.source_url,
        (SELECT count(*)::int FROM property_agents a WHERE a.property_id = p.id) AS agent_count
      FROM properties p
      WHERE p.source_site = 'propertyhk' AND p.source_url IS NOT NULL
      ORDER BY p.listing_no`;
    const todo = force ? properties : properties.filter((row) => row.agent_count < 2);
    console.log(`propertyhk: ${properties.length} properties, ${todo.length} to fill`);
    for (const property of todo) {
      let slug = null;
      try {
        slug = propertyhkAgentSlug(property.source_url);
      } catch {
        slug = null;
      }
      const publicSlug = slug ? PROPERTYHK_AGENT_SLUGS[slug] : null;
      const match = publicSlug ? bySlug.get(publicSlug) : null;
      if (!match) {
        failures.push({
          property: property.listing_no,
          error: `unmapped_propertyhk_agent:${slug}`,
        });
        continue;
      }
      await merge(property.id, [
        {
          staffId: match.id,
          source: "propertyhk",
          sourceName: match.name_en,
          sourceLicenceNo: normalizeLicence(match.licence_no),
          sourceRef: slug,
        },
      ]);
    }

    // Cross-listed: a 28hse-sourced property that also appears on Property.hk takes its
    // correspondent agent(s) from the recorded observation final_url
    // (/asking_detail/<branch>/<agent>/<id>.html) — no fetch needed, the slug is stored.
    // Existing 28hse agents keep their slot; property.hk agents fill the remaining one.
    const crossListed = await sql`
      SELECT p.id, p.listing_no,
        array_agg(DISTINCT o.payload->>'final_url') AS urls,
        (SELECT count(*)::int FROM property_agents a WHERE a.property_id = p.id) AS agent_count
      FROM properties p
      JOIN property_source_links l ON l.property_id = p.id AND l.source = 'propertyhk'
      JOIN listing_source_observations o
        ON o.source = 'propertyhk' AND o.external_listing_id = l.external_listing_id
      WHERE o.payload->>'final_url' LIKE 'https://www.property.hk/asking_detail/%'
      GROUP BY p.id, p.listing_no
      ORDER BY p.listing_no`;
    const crossTodo = force ? crossListed : crossListed.filter((row) => row.agent_count < 2);
    console.log(
      `propertyhk (cross-listed): ${crossListed.length} properties, ${crossTodo.length} to fill`,
    );
    for (const property of crossTodo) {
      const agents = [];
      for (const url of property.urls ?? []) {
        let slug = null;
        try {
          slug = propertyhkAgentSlug(url);
        } catch {
          slug = null;
        }
        const publicSlug = slug ? PROPERTYHK_AGENT_SLUGS[slug] : null;
        const match = publicSlug ? bySlug.get(publicSlug) : null;
        if (!match) continue;
        agents.push({
          staffId: match.id,
          source: "propertyhk",
          sourceName: match.name_en,
          sourceLicenceNo: normalizeLicence(match.licence_no),
          sourceRef: slug,
        });
      }
      await merge(property.id, agents);
    }
  }

  // Property.hk names only the listing agent; store the branch 主管 as the second correspondent
  // so every Property.hk listing (including cross-listed old-site stock) offers two colleagues.
  async function runBranchManager() {
    const rows = await sql`
      SELECT p.id, p.listing_no, a.staff_id AS agent_id, s.branch
      FROM properties p
      JOIN property_agents a ON a.property_id = p.id AND a.position = 1
      JOIN staff_users s ON s.id = a.staff_id
      WHERE p.status = 'active'
        AND a.source = 'propertyhk'
        AND (SELECT count(*) FROM property_agents x WHERE x.property_id = p.id) = 1
        AND s.branch IS NOT NULL
      ORDER BY p.listing_no`;
    console.log(`branch manager: ${rows.length} listings with a single Property.hk agent`);
    for (const row of rows) {
      const manager = pickBranchManager(byBranch.get(row.branch), row.agent_id);
      if (!manager) {
        skipped += 1;
        continue;
      }
      await merge(row.id, [
        {
          staffId: manager.id,
          source: "branch_manager",
          sourceName: manager.name_en,
          sourceLicenceNo: normalizeLicence(manager.licence_no),
          sourceRef: row.branch,
        },
      ]);
    }
  }

  if (fromPayload) {
    await runFromPayload(fromPayload);
  } else {
    if (source === "28hse" || source === "all") await run28hse();
    if (source === "propertyhk" || source === "all") await runPropertyhk();
    if (source === "propertyhk" || source === "all") await runBranchManager();
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        mode: fromPayload ? "sync-payload" : "source-fetch",
        written,
        skipped,
        withdrawn,
        goneCount: gone.length,
        gone: gone.slice(0, 20),
        failures: failures.slice(0, 20),
        failureCount: failures.length,
      },
      null,
      1,
    ),
  );
  if (failures.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
