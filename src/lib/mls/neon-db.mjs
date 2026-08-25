import { neon } from "@neondatabase/serverless";

/**
 * Minimum share of the currently-active inventory a discovery pass must have
 * seen before it is allowed to deactivate what it did not see. 0.7 leaves room
 * for a genuinely large delisting round while still catching a discovery pass
 * that collapsed to a single page.
 */
const MIN_DEACTIVATION_COVERAGE = 0.7;

export function createNeonSqlFromEnv() {
  const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED is required for Neon MLS sync.");
  }
  return neon(databaseUrl);
}

function rowValues(row) {
  return [
    row.listing_no,
    row.title_zh,
    row.title_en,
    row.deal_type,
    row.estate_id,
    row.district_slug,
    row.address,
    row.price,
    row.rent,
    row.saleable_area,
    row.gross_area,
    row.bedrooms,
    row.bathrooms,
    row.floor,
    row.orientation,
    row.features,
    row.description,
    row.images,
    row.status,
    row.featured,
    row.legacy_detail_id,
    row.legacy_property_no,
    row.legacy_url,
    row.legacy_source_indexes ?? [],
    row.source_site,
    row.source_url,
    row.source_updated_at,
    row.last_seen_at,
    row.last_scraped_at,
  ];
}

function latestSyncRunFromRow(row) {
  if (row == null || typeof row !== "object" || Array.isArray(row)) {
    throw new TypeError("listing_sync_runs returned a malformed latest-run row");
  }
  if (row.mode !== "shadow" && row.mode !== "publish") {
    throw new TypeError("listing_sync_runs returned an unsupported run mode");
  }
  return {
    id: row.id,
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? null,
    mode: row.mode,
    status: row.status,
    sourceStatus: row.source_status,
    counts: row.counts,
    failureCode: row.failure_code ?? null,
    failureSummary: row.failure_summary ?? null,
  };
}

export function createNeonMlsDb(sql) {
  return {
    async listEstateIdsBySlug() {
      const rows = await sql.query("SELECT id, slug FROM estates");
      return new Map(rows.map((row) => [row.slug, row.id]));
    },

    async getLatestSyncRun() {
      const rows = await sql.query(`
        SELECT
          id,
          scheduled_for::text AS scheduled_for,
          to_char(
            started_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ) AS started_at,
          CASE
            WHEN finished_at IS NULL THEN NULL
            ELSE to_char(
              finished_at AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            )
          END AS finished_at,
          mode,
          status,
          source_status,
          counts,
          failure_code,
          failure_summary
        FROM listing_sync_runs
        ORDER BY started_at DESC
        LIMIT 1
      `);
      return rows.length === 0 ? null : latestSyncRunFromRow(rows[0]);
    },

    async upsertProperties(rows) {
      for (const row of rows) {
        await sql.query(
          `
          INSERT INTO properties (
            listing_no, title_zh, title_en, deal_type, estate_id, district_slug, address,
            price, rent, saleable_area, gross_area, bedrooms, bathrooms, floor, orientation,
            features, description, images, status, featured, legacy_detail_id,
            legacy_property_no, legacy_url, legacy_source_indexes, source_site, source_url,
            source_updated_at, last_seen_at, last_scraped_at
          )
          VALUES (
            $1, $2, $3, $4::deal_type, $5, $6, $7,
            $8, $9, $10, $11, $12, $13, $14, $15,
            $16, $17, $18, $19::property_status, $20, $21,
            $22, $23, $24, $25, $26, $27, $28, $29
          )
          ON CONFLICT (legacy_detail_id, deal_type) DO UPDATE SET
            listing_no = EXCLUDED.listing_no,
            title_zh = EXCLUDED.title_zh,
            title_en = EXCLUDED.title_en,
            estate_id = EXCLUDED.estate_id,
            district_slug = EXCLUDED.district_slug,
            address = EXCLUDED.address,
            price = EXCLUDED.price,
            rent = EXCLUDED.rent,
            saleable_area = EXCLUDED.saleable_area,
            gross_area = EXCLUDED.gross_area,
            bedrooms = EXCLUDED.bedrooms,
            bathrooms = EXCLUDED.bathrooms,
            floor = EXCLUDED.floor,
            orientation = EXCLUDED.orientation,
            features = EXCLUDED.features,
            description = EXCLUDED.description,
            images = EXCLUDED.images,
            status = EXCLUDED.status,
            featured = EXCLUDED.featured,
            legacy_property_no = EXCLUDED.legacy_property_no,
            legacy_url = EXCLUDED.legacy_url,
            legacy_source_indexes = EXCLUDED.legacy_source_indexes,
            source_site = EXCLUDED.source_site,
            source_url = EXCLUDED.source_url,
            source_updated_at = EXCLUDED.source_updated_at,
            last_seen_at = EXCLUDED.last_seen_at,
            last_scraped_at = EXCLUDED.last_scraped_at,
            updated_at = now()
          `,
          rowValues(row),
        );
      }
      return { count: rows.length };
    },

    async deactivateMissing({ sourceSite, seenLegacyIds, nowIso }) {
      if (!seenLegacyIds.length) {
        return { count: 0, skipped: "NO_DISCOVERED_IDS" };
      }

      // A "full sync" is only as trustworthy as its discovery pass, and this
      // one degrades silently: parseMaxListingPage falls back to page 1 when the
      // pager markup changes, and the cron's page cap already truncates a source
      // with ~102 pages. Without this guard a single bad discovery run marked
      // every listing it failed to see as inactive -- taking the public site's
      // inventory down -- and still reported ok:true.
      //
      // So: refuse to sweep when the discovered set covers less of the current
      // active inventory than a real delisting round plausibly would. The caller
      // surfaces the refusal as an error rather than swallowing it, so a genuine
      // bulk delisting can be re-run deliberately.
      // Measure real OVERLAP, not set sizes. Dividing seenLegacyIds.length by
      // the active count compares two unrelated sets: a discovery pass that
      // returned a large number of ids none of which match the live inventory
      // would sail past the guard and then deactivate everything. This asks the
      // only question that matters -- how many currently-active listings did
      // this pass actually see?
      //
      // status = 'active' exactly, not `<> 'inactive'`: draft/sold/rented rows
      // are not live and are not expected in the discovery set, so counting them
      // deflated coverage and would have blocked healthy runs.
      //
      // count(DISTINCT legacy_detail_id) because one listing can produce more
      // than one properties row, and legacy_detail_id is the unit the sweep's
      // own `legacy_detail_id <> ALL($2)` predicate works in.
      const coverageRows = await sql.query(
        `
        SELECT
          count(DISTINCT legacy_detail_id)::int AS active_count,
          count(DISTINCT legacy_detail_id)
            FILTER (WHERE legacy_detail_id = ANY($2::text[]))::int AS seen_count
        FROM properties
        WHERE source_site = $1
          AND legacy_detail_id IS NOT NULL
          AND status = 'active'
        `,
        [sourceSite, seenLegacyIds],
      );
      const activeCount = Number(coverageRows[0]?.active_count ?? 0);
      const seenCount = Number(coverageRows[0]?.seen_count ?? 0);
      // No active inventory yet (first import) => nothing to protect.
      const coverage = activeCount === 0 ? 1 : seenCount / activeCount;

      if (coverage < MIN_DEACTIVATION_COVERAGE) {
        return {
          count: 0,
          skipped: "DISCOVERY_COVERAGE_TOO_LOW",
          coverage,
          activeCount,
          seenCount,
          discovered: seenLegacyIds.length,
        };
      }

      const rows = await sql.query(
        `
        UPDATE properties
        SET status = 'inactive', updated_at = $3
        WHERE source_site = $1
          AND legacy_detail_id IS NOT NULL
          AND legacy_detail_id <> ALL($2::text[])
        RETURNING id
        `,
        [sourceSite, seenLegacyIds, nowIso],
      );
      return { count: rows.length };
    },
  };
}
