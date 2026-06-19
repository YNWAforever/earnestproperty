import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("redirect generator emits one static rule per imported alias", () => {
  const runDir = mkdtempSync(join(tmpdir(), "old-site-redirects-"));
  writeFileSync(
    join(runDir, "redirect-aliases.json"),
    JSON.stringify([
      { legacyDetailId: "6470722", listingNo: "B059390" },
      { legacyDetailId: "6638262", listingNo: "B059390" },
      { legacyDetailId: "9999999", listingNo: "OLD-9999999" },
    ]),
  );

  const result = spawnSync("node", ["scripts/old-site-migration/redirects.mjs", runDir], {
    encoding: "utf8",
  });
  const redirects = JSON.parse(readFileSync("src/generated/old-site-redirects.json", "utf8"));
  writeFileSync("src/generated/old-site-redirects.json", "[]\n");
  rmSync(runDir, { recursive: true, force: true });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(redirects.length, 3);
  assert.equal(
    redirects.some((redirect) => redirect.source.startsWith("/eng/")),
    false,
  );
  assert.deepEqual(redirects[0], {
    source: "/property-detail/6470722.html",
    destination: "/property/B059390",
    permanent: true,
  });
  assert.deepEqual(redirects[1], {
    source: "/property-detail/6638262.html",
    destination: "/property/B059390",
    permanent: true,
  });
  assert.deepEqual(redirects[2], {
    source: "/property-detail/9999999.html",
    destination: "/property/OLD-9999999",
    permanent: true,
  });
});
