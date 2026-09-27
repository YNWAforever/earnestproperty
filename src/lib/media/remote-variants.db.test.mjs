import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  findMediaVariantSet,
  lookupMediaVariantsForUrls,
  saveMediaVariantSet,
} from "./remote-variants-db.mjs";
const assetId = "00000000-0000-4000-8000-000000000001";
const sourceHash = "a".repeat(64);
const sourceUrl = "https://owned.public.blob.vercel-storage.com/mls/source.jpg";
test("owned source and hash gate atomic variant metadata and public lookup", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "CREATE TABLE media_assets(id uuid PRIMARY KEY,url text NOT NULL,content_hash text)",
    );
    await db.exec(readFileSync("neon/migrations/20260927172000_media_asset_variants.sql", "utf8"));
    const query = (sql, params) => db.query(sql, params);
    await db.query("INSERT INTO media_assets VALUES($1,$2,$3)", [assetId, sourceUrl, sourceHash]);
    const set = {
      assetId,
      sourceHash,
      sourceUrl,
      status: "ready",
      variants: [
        {
          width: 160,
          url: "https://owned.public.blob.vercel-storage.com/mls-variants/160.webp",
          bytes: 3600,
          format: "webp",
        },
      ],
    };
    await saveMediaVariantSet(query, set);
    assert.deepEqual(
      (await findMediaVariantSet(query, assetId, sourceHash)).variants,
      set.variants,
    );
    assert.equal(
      (await lookupMediaVariantsForUrls(query, [sourceUrl]))[sourceUrl].variants[0].width,
      160,
    );
    await saveMediaVariantSet(query, set);
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM media_asset_variants")).rows[0].n,
      1,
    );
    await assert.rejects(
      () => saveMediaVariantSet(query, { ...set, sourceUrl: "https://evil.example/image.jpg" }),
      /source changed/i,
    );
    await db.query("UPDATE media_assets SET content_hash=$2 WHERE id=$1", [
      assetId,
      "b".repeat(64),
    ]);
    assert.equal(await findMediaVariantSet(query, assetId, sourceHash), null);
    assert.deepEqual(await lookupMediaVariantsForUrls(query, [sourceUrl]), {});
  } finally {
    await db.close();
  }
});
