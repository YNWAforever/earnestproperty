import assert from "node:assert/strict";
import test from "node:test";

import { formatDriftReport, resolveDatabaseUrl } from "./check-migration-drift.mjs";

test("a fully migrated database passes", () => {
  const report = formatDriftReport([]);
  assert.equal(report.ok, true);
  assert.match(report.message, /up to date/i);
});

// The message is the entire product of a failed CI run: whoever opens the
// notification sees this and nothing else. It has to name the files and say what
// to do, or it is just a red tick that gets muted.
test("pending migrations are named in the failure message", () => {
  const report = formatDriftReport([
    "20260817130000_youtube_channel_sync.sql",
    "20260818090000_something_else.sql",
  ]);
  assert.equal(report.ok, false);
  assert.match(report.message, /20260817130000_youtube_channel_sync\.sql/);
  assert.match(report.message, /20260818090000_something_else\.sql/);
  assert.match(report.message, /neon:migrate/, "the message must say how to apply them");
});

// DATABASE_URL_UNPOOLED wins, matching apply-migrations.mjs. If the two
// disagreed, the drift check could pass against one database while migrations
// were applied to another.
test("resolveDatabaseUrl matches apply-migrations.mjs precedence", () => {
  assert.equal(
    resolveDatabaseUrl({
      DATABASE_URL_UNPOOLED: "postgres://direct",
      DATABASE_URL: "postgres://pooled",
    }),
    "postgres://direct",
  );
  assert.equal(resolveDatabaseUrl({ DATABASE_URL: "postgres://pooled" }), "postgres://pooled");
});

// Both of these cost real debugging time on 2026-08-19. An exported-but-empty
// variable overrides the file value in apply-migrations.mjs's env merge, and a
// setup placeholder reaches neon() as a literal string, which fails with
// "not a valid URL" and sends you looking at the connection instead of the file.
test("empty and placeholder values are treated as unset, not as a connection string", () => {
  assert.equal(
    resolveDatabaseUrl({ DATABASE_URL_UNPOOLED: "", DATABASE_URL: "postgres://real" }),
    "postgres://real",
  );
  assert.equal(
    resolveDatabaseUrl({ DATABASE_URL_UNPOOLED: "   ", DATABASE_URL: "postgres://real" }),
    "postgres://real",
  );
  assert.equal(
    resolveDatabaseUrl({
      DATABASE_URL_UNPOOLED: "<paste neon direct connection string>",
      DATABASE_URL: "postgres://real",
    }),
    "postgres://real",
  );
  assert.equal(resolveDatabaseUrl({}), null);
});
