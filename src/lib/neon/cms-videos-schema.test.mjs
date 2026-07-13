import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { isMissingCmsVideosTableError } from "./cms-videos-schema.ts";

test("recognizes PostgreSQL undefined-table errors for cms_videos", () => {
  assert.equal(
    isMissingCmsVideosTableError(
      Object.assign(new Error('relation "cms_videos" does not exist'), { code: "42P01" }),
    ),
    true,
  );
  assert.equal(
    isMissingCmsVideosTableError(new Error('relation "cms_videos" does not exist')),
    true,
  );
});

test("does not hide unrelated database failures", () => {
  assert.equal(
    isMissingCmsVideosTableError(
      Object.assign(new Error('relation "articles" does not exist'), { code: "42P01" }),
    ),
    false,
  );
  assert.equal(
    isMissingCmsVideosTableError(
      Object.assign(new Error('column "published" does not exist'), { code: "42703" }),
    ),
    false,
  );
});

test("admin video reads and writes degrade only when cms_videos is unavailable", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/neon/admin-data.server.ts"), "utf8");
  const readFunction = source.match(
    /export async function fetchAdminCmsVideos\(\)[\s\S]*?\r?\n}\r?\n\r?\nexport async function saveAdminCmsVideo/,
  )?.[0];
  const saveFunction = source.match(
    /export async function saveAdminCmsVideo[\s\S]*?\r?\n}\r?\n\r?\nexport async function saveAdminEstate/,
  )?.[0];

  assert.match(readFunction ?? "", /isMissingCmsVideosTableError/);
  assert.match(readFunction ?? "", /return \[\]/);
  assert.match(saveFunction ?? "", /isMissingCmsVideosTableError/);
  assert.match(saveFunction ?? "", /影片資料表尚未建立/);
});
