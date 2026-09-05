import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const routeSource = () => readFileSync("src/routes/api.admin.media.upload.ts", "utf8");

test("admin media upload preserves staff authorization and the public response contract", () => {
  const source = routeSource();

  assert.match(source, /requireStaffAccess\(request, \["admin", "manager", "agent"\]\)/);
  assert.match(source, /\{ ok: false, error: "file is required" \}/);
  assert.match(source, /\{ ok: false, error: "EMPTY_FILE" \}/);
  assert.match(source, /\{ ok: false, error: "FILE_TOO_LARGE", maxBytes: MAX_UPLOAD_BYTES \}/);
  assert.match(source, /Response.json\(result/);
});

test("admin media upload retains its MIME, size, owner, and database boundaries", () => {
  const source = routeSource();

  assert.match(source, /5 \* 1024 \* 1024/);
  for (const contentType of ["image/jpeg", "image/png", "image/webp", "image/avif"]) {
    assert.match(source, new RegExp(`"${contentType}"`));
  }
  for (const ownerType of ["property", "estate", "article", "agent", "cms"]) {
    assert.match(source, new RegExp(`"${ownerType}"`));
  }
  const repository = readFileSync("src/lib/media/media-upload-repository.server.ts", "utf8");
  assert.match(repository, /INSERT INTO media_assets/);
  assert.match(repository, /owner_type,created_by/);
  assert.match(source, /staff\.staffId/);
});

test("admin media upload delegates only object storage to the shared Vercel adapter", () => {
  const source = routeSource();

  assert.match(source, /import \{ createVercelBlobStore \} from "@\/lib\/media\/vercel-blob\.mjs"/);
  assert.match(source, /createVercelBlobStore\(\{/);
  assert.match(source, /put: blobStore\.put/);
  assert.doesNotMatch(source, /async function putPublicBlob/);
  assert.doesNotMatch(source, /\bfetch\(/);
});
