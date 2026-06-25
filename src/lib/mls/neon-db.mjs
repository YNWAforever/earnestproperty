import { neon } from "@neondatabase/serverless";

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

export function createNeonMlsDb(sql) {
  return {
    async listEstateIdsBySlug() {
      const rows = await sql.query("SELECT id, slug FROM estates");
      return new Map(rows.map((row) => [row.slug, row.id]));
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
      if (!seenLegacyIds.length) return { count: 0 };
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
