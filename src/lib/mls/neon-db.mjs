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
    row.canonical_property_no,
    row.unit_no ?? null,
    row.year_completed ?? null,
    row.lease_expiry_year ?? null,
    row.property_use ?? null,
    row.remarks ?? null,
    row.source_payload ?? null,
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

    async listEstates() {
      return sql.query("SELECT id, slug, name_zh, name_en, aliases, district_slug FROM estates");
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
      // `properties.listing_no` is unique across every source, and the
      // Property.hk branch feed generates the same `<canonical>-<detailId>-<S|R>`
      // id for the same underlying listing. Those rows are already live under
      // `source_site='propertyhk'`; inserting them again would violate the
      // unique key (aborting the middle of the batch) and create a second public
      // identity for the same unit. Skip + report them instead: the existing
      // row keeps serving the listing, exactly like the 28hse duplicate policy.
      const listingNos = rows.map((row) => row.listing_no);
      const existingRows = listingNos.length
        ? await sql.query(
            `
            SELECT listing_no, source_site, legacy_detail_id, deal_type::text AS deal_type,
                   ingestion_owner
            FROM properties
            WHERE listing_no = ANY($1::text[])
            `,
            [listingNos],
          )
        : [];
      const existingByListingNo = new Map(
        existingRows.map((existing) => [existing.listing_no, existing]),
      );
      const conflicts = [];
      let count = 0;
      for (const row of rows) {
        const existing = existingByListingNo.get(row.listing_no);
        // `ingestion_owner='no-hermes-v2'` rows are fenced by the DB trigger
        // (aaa_mls_ingestion_owner_fence) against the legacy writer; the v2
        // feed owns their facts, so the legacy sync must not touch them.
        const sameOwner =
          !existing ||
          (existing.source_site === row.source_site &&
            String(existing.legacy_detail_id ?? "") === String(row.legacy_detail_id ?? "") &&
            existing.deal_type === row.deal_type &&
            (existing.ingestion_owner ?? "legacy") === "legacy");
        if (!sameOwner) {
          conflicts.push({
            listing_no: row.listing_no,
            canonical_property_no: row.canonical_property_no ?? null,
            deal_type: row.deal_type,
            existing_source_site: existing.source_site ?? null,
            existing_legacy_detail_id: existing.legacy_detail_id ?? null,
            existing_deal_type: existing.deal_type ?? null,
            existing_ingestion_owner: existing.ingestion_owner ?? null,
          });
          continue;
        }
        await sql.query(
          `
          INSERT INTO properties (
            listing_no, title_zh, title_en, deal_type, estate_id, district_slug, address,
            price, rent, saleable_area, gross_area, bedrooms, bathrooms, floor, orientation,
            features, description, images, status, featured, legacy_detail_id,
            legacy_property_no, legacy_url, legacy_source_indexes, source_site, source_url,
            source_updated_at, last_seen_at, last_scraped_at, canonical_property_no,
            unit_no, year_completed, lease_expiry_year, property_use, remarks, source_payload
          )
          VALUES (
            $1, $2, $3, $4::deal_type, $5, $6, $7,
            $8, $9, $10, $11, $12, $13, $14, $15,
            $16, $17, $18, $19::property_status, $20, $21,
            $22, $23, $24, $25, $26, $27, $28, $29, $30,
            $31, $32, $33, $34, $35, $36
          )
          ON CONFLICT (legacy_detail_id, deal_type) DO UPDATE SET
            listing_no = EXCLUDED.listing_no,
            canonical_property_no = EXCLUDED.canonical_property_no,
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
            unit_no = EXCLUDED.unit_no,
            orientation = EXCLUDED.orientation,
            year_completed = EXCLUDED.year_completed,
            lease_expiry_year = EXCLUDED.lease_expiry_year,
            property_use = EXCLUDED.property_use,
            remarks = EXCLUDED.remarks,
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
            source_payload = EXCLUDED.source_payload,
            updated_at = now()
          `,
          rowValues(row),
        );
        count += 1;
      }
      return { count, conflicts };
    },

    async deactivateMissing({
      sourceSite,
      seenLegacyIds,
      seenPairs,
      protectedLegacyIds,
      nowIso,
      allowLowCoverage = false,
    }) {
      if (!Array.isArray(seenLegacyIds) || !seenLegacyIds.length) {
        return { count: 0, skipped: "NO_DISCOVERED_IDS" };
      }
      const pairAwareSweep = Array.isArray(seenPairs);
      if (pairAwareSweep && !seenPairs.length) {
        // An empty pair set would make the NOT EXISTS predicate match every
        // active row and deactivate the whole source. Refuse even after the
        // coverage guard.
        return { count: 0, skipped: "NO_SEEN_PAIRS" };
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

      if (coverage < MIN_DEACTIVATION_COVERAGE && !allowLowCoverage) {
        return {
          count: 0,
          skipped: "DISCOVERY_COVERAGE_TOO_LOW",
          coverage,
          activeCount,
          seenCount,
          discovered: seenLegacyIds.length,
        };
      }
      const coverageOverride = coverage < MIN_DEACTIVATION_COVERAGE;

      if (pairAwareSweep) {
        // Pair-aware sweep: a listing can be valid for one deal type while the
        // other deal-type row is genuinely gone (sale kept, rent removed), so
        // only exact (legacy_detail_id, deal_type) pairs keep a row active.
        // `protectedLegacyIds` are the discovered ids this run did not upsert
        // (partial runs, failed details) and must never be swept.
        const pairIds = seenPairs.map(([id]) => String(id));
        const pairTypes = seenPairs.map(([, dealType]) => String(dealType));
        const protectedIds = Array.isArray(protectedLegacyIds)
          ? protectedLegacyIds.map(String)
          : [];
        const rows = await sql.query(
          `
          UPDATE properties
          SET status = 'inactive', updated_at = $5
          WHERE source_site = $1
            AND legacy_detail_id IS NOT NULL
            AND status <> 'inactive'
            AND ingestion_owner = 'legacy'
            AND legacy_detail_id <> ALL($4::text[])
            AND NOT EXISTS (
              SELECT 1
              FROM unnest($2::text[], $3::text[]) AS p(id, deal_type)
              WHERE p.id = properties.legacy_detail_id
                AND p.deal_type = properties.deal_type::text
            )
          RETURNING id
          `,
          [sourceSite, pairIds, pairTypes, protectedIds, nowIso],
        );
        return { count: rows.length, coverage, coverageOverride };
      }

      const rows = await sql.query(
        `
        UPDATE properties
        SET status = 'inactive', updated_at = $3
        WHERE source_site = $1
          AND legacy_detail_id IS NOT NULL
          AND ingestion_owner = 'legacy'
          AND legacy_detail_id <> ALL($2::text[])
        RETURNING id
        `,
        [sourceSite, seenLegacyIds, nowIso],
      );
      return { count: rows.length, coverage, coverageOverride };
    },
  };
}
