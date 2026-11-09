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
 *        --delay-ms=4500 (between source fetches; Firecrawl allows ~15-20/min).
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
  const pattern = /放盤聯絡人\s*([^<]{2,30})/g;
  for (const match of String(html ?? "").matchAll(pattern)) {
    const name = match[1].replace(/\s+/g, " ").trim();
    if (name) names.push(name);
  }
  return names;
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
    return String(body?.data?.rawHtml ?? "");
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const source = argValue(argv, "source", "all");
  const limit = Number(argValue(argv, "limit", "0")) || 0;
  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force");
  const delayMs = Number(argValue(argv, "delay-ms", "4500"));
  if (!["28hse", "propertyhk", "all"].includes(source)) throw new Error("bad --source");

  const env = loadEnv();
  const databaseUrl = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const apiKey = env.FIRECRAWL_API_KEY;
  if (!apiKey && source !== "propertyhk") throw new Error("FIRECRAWL_API_KEY is required");
  const sql = neon(databaseUrl);

  const staff = await sql`
    SELECT id, licence_no, public_slug, name_en, active, coalesce((to_jsonb(staff_users)->>'show_on_website')::boolean, false) AS show_on_website
    FROM staff_users WHERE active`;
  const byLicence = new Map();
  const bySlug = new Map();
  for (const row of staff) {
    const licence = normalizeLicence(row.licence_no);
    if (licence) byLicence.set(licence, row);
    if (row.public_slug) bySlug.set(row.public_slug, row);
  }
  console.log(`staff: ${staff.length} active, ${byLicence.size} with a licence`);

  let written = 0;
  let skipped = 0;
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
    const properties = await sql`
      SELECT DISTINCT p.id, p.listing_no, p.source_url,
        (SELECT count(*)::int FROM property_agents a WHERE a.property_id = p.id) AS agent_count
      FROM properties p
      JOIN mls_source_state s ON s.property_id = p.id AND s.source = '28hse_agent_540'
      WHERE p.source_url ~ '/(buy|rent)/[^/]+/property-[0-9]+/?$'
        AND p.status = 'active'
      ORDER BY p.listing_no`;
    const todo = force ? properties : properties.filter((row) => row.agent_count < 2);
    const limited = limit ? todo.slice(0, limit) : todo;
    console.log(
      `28hse: ${properties.length} properties, ${todo.length} to fill, running ${limited.length}`,
    );
    for (const [index, property] of limited.entries()) {
      try {
        const html = await fetchFirecrawl(property.source_url, apiKey);
        const licences = extract28hseAgentLicences(html);
        const names = extract28hseAgentNames(html);
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

  if (source === "28hse" || source === "all") await run28hse();
  if (source === "propertyhk" || source === "all") await runPropertyhk();

  console.log(
    JSON.stringify(
      { dryRun, written, skipped, failures: failures.slice(0, 20), failureCount: failures.length },
      null,
      1,
    ),
  );
  if (failures.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
