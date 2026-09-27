const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const WIDTHS = new Set([160, 320, 640, 960, 1280]);
const rowsOf = (value) => (Array.isArray(value) ? value : (value?.rows ?? []));
export async function findMediaVariantSet(query, assetId, sourceHash) {
  if (!UUID.test(assetId) || !HASH.test(sourceHash)) throw new TypeError("Invalid variant lookup");
  const rows = rowsOf(
    await query(
      `SELECT s.asset_id::text AS "assetId",s.source_hash AS "sourceHash",
      s.source_url AS "sourceUrl",s.status,s.variant_count AS "variantCount",
      COALESCE(jsonb_agg(jsonb_build_object('width',v.width,'url',v.url,'bytes',v.bytes,'format',v.format)
        ORDER BY v.width) FILTER (WHERE v.width IS NOT NULL),'[]'::jsonb) AS variants
      FROM media_variant_sets s JOIN media_assets a ON a.id=s.asset_id AND a.content_hash=s.source_hash
      LEFT JOIN media_asset_variants v ON v.asset_id=s.asset_id AND v.source_hash=s.source_hash
      WHERE s.asset_id=$1::uuid AND s.source_hash=$2
      GROUP BY s.asset_id,s.source_hash,s.source_url,s.status,s.variant_count`,
      [assetId, sourceHash],
    ),
  );
  const row = rows[0];
  if (!row) return null;
  const variants = typeof row.variants === "string" ? JSON.parse(row.variants) : row.variants;
  if (row.status !== "ready" || variants.length !== Number(row.variantCount)) return null;
  return {
    assetId: row.assetId,
    sourceHash: row.sourceHash,
    sourceUrl: row.sourceUrl,
    variants,
    status: "ready",
  };
}
export async function saveMediaVariantSet(query, set) {
  if (
    !UUID.test(set?.assetId) ||
    !HASH.test(set?.sourceHash) ||
    set?.status !== "ready" ||
    !Array.isArray(set.variants) ||
    set.variants.length < 1 ||
    set.variants.length > 5 ||
    set.variants.some(
      (v) =>
        !WIDTHS.has(v.width) ||
        !Number.isSafeInteger(v.bytes) ||
        v.bytes < 1 ||
        v.format !== "webp" ||
        typeof v.url !== "string",
    )
  )
    throw new TypeError("Invalid variant set");
  const rows = rowsOf(
    await query(
      `WITH owned AS (
       SELECT id FROM media_assets WHERE id=$1::uuid AND content_hash=$2 AND url=$3
     ), head AS (
       INSERT INTO media_variant_sets(asset_id,source_hash,source_url,status,variant_count)
       SELECT id,$2,$3,'ready',jsonb_array_length($4::jsonb) FROM owned
       ON CONFLICT(asset_id) DO UPDATE SET
         source_hash=EXCLUDED.source_hash,source_url=EXCLUDED.source_url,
         status='ready',variant_count=EXCLUDED.variant_count,updated_at=now()
       RETURNING asset_id
     )
     INSERT INTO media_asset_variants(asset_id,source_hash,width,url,bytes,format)
     SELECT head.asset_id,$2,v.width,v.url,v.bytes,v.format
     FROM head CROSS JOIN jsonb_to_recordset($4::jsonb)
       AS v(width integer,url text,bytes bigint,format text)
     ON CONFLICT(asset_id,source_hash,width) DO UPDATE SET
       url=EXCLUDED.url,bytes=EXCLUDED.bytes,format=EXCLUDED.format
     RETURNING width`,
      [set.assetId, set.sourceHash, set.sourceUrl, JSON.stringify(set.variants)],
    ),
  );
  if (rows.length !== set.variants.length) throw new Error("Owned media source changed");
  return set;
}
export async function lookupMediaVariantsForUrls(query, urls) {
  if (!Array.isArray(urls) || urls.length > 500 || urls.some((url) => typeof url !== "string"))
    throw new TypeError("Invalid media URL batch");
  if (!urls.length) return {};
  const rows = rowsOf(
    await query(
      `SELECT a.url AS "sourceUrl",s.source_hash AS "sourceHash",v.width,v.url,v.bytes,v.format
      FROM media_assets a JOIN media_variant_sets s ON s.asset_id=a.id
       AND s.source_hash=a.content_hash AND s.source_url=a.url AND s.status='ready'
      JOIN media_asset_variants v ON v.asset_id=a.id AND v.source_hash=s.source_hash
      WHERE a.url=ANY($1::text[]) ORDER BY a.url,v.width`,
      [[...new Set(urls)]],
    ),
  );
  const grouped = {};
  for (const row of rows) {
    const source = String(row.sourceUrl);
    const set = (grouped[source] ??= {
      sourceHash: String(row.sourceHash),
      status: "ready",
      variants: [],
    });
    set.variants.push({
      width: Number(row.width),
      url: String(row.url),
      bytes: Number(row.bytes),
      format: String(row.format),
    });
  }
  return grouped;
}
