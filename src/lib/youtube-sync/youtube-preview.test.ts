import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "bun:test";

import {
  previewYouTubeBackfill,
  type YouTubeInventoryRow,
  type YouTubePreviewInput,
} from "./youtube-preview";
import type { YouTubeVideo } from "./youtube-sync.types";

const CHANNEL = "UCTwcj9hcQoKVpKEZY-ZgnwA";
const CAPTURED = "2026-10-16T04:00:00.000Z";
const A = "AAAAAAAAAAA";
const B = "BBBBBBBBBBB";
const C = "CCCCCCCCCCC";

function upload(videoId = A, publishedAt = "2026-10-10T00:00:00.000Z"): YouTubeVideo {
  return {
    videoId,
    title: `Provider ${videoId}`,
    description: "Provider description",
    publishedAt,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function row(videoId = A, overrides: Partial<YouTubeInventoryRow> = {}): YouTubeInventoryRow {
  return {
    id: `cms-${videoId}`,
    title: `Provider ${videoId}`,
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    description: "Staff description",
    publishedAt: "2026-10-10T00:00:00.000Z",
    published: false,
    managed: true,
    available: true,
    sortOrder: 7,
    ...overrides,
  };
}

function input(
  uploads: YouTubeVideo[] = [upload()],
  rows: YouTubeInventoryRow[] = [],
): YouTubePreviewInput {
  return {
    channel: { id: CHANNEL, verified: true, capturedAt: CAPTURED, complete: true, synthetic: true },
    uploads,
    inventory: { rows, capturedAt: CAPTURED, scope: "full_db", complete: true, synthetic: true },
    boundaryVideoId: null,
  };
}

test("offline preview exposes insert evidence and conditional publication without write claims", () => {
  const result = previewYouTubeBackfill(input());
  assert.equal(result.mode, "additive_preview");
  assert.equal(result.offline, true);
  assert.equal(result.synthetic, true);
  assert.equal(result.exactWriteCounts, null);
  assert.deepEqual(result.counts, {
    insert: 1,
    adoption: 0,
    changed: 0,
    unchanged: 0,
    unresolved: 0,
  });
  const [entry] = result.entries;
  assert.equal(entry.classification, "insert");
  assert.equal(entry.existingEvidence, null);
  assert.deepEqual(entry.candidateEvidence, upload());
  assert.deepEqual(entry.expectedPublication, {
    published: true,
    available: true,
    publiclyVisible: true,
  });
  assert.equal(entry.proposed.sortOrder, 1000);
});

test("manual Shorts adoption preserves blank staff description, hidden publication and sort", () => {
  const existing = row(A, {
    managed: false,
    videoUrl: `https://www.youtube.com/shorts/${A}?feature=share`,
    description: "",
    available: false,
  });
  const original = input([upload()], [existing]);
  const before = structuredClone(original);
  const [entry] = previewYouTubeBackfill(original).entries;
  assert.equal(entry.classification, "adoption");
  assert.deepEqual(entry.existingEvidence, existing);
  assert.equal(entry.proposed.description, "");
  assert.equal(entry.proposed.videoUrl, `https://www.youtube.com/watch?v=${A}`);
  assert.equal(entry.proposed.published, false);
  assert.equal(entry.proposed.sortOrder, 7);
  assert.equal(entry.expectedPublication.publiclyVisible, false);
  assert.deepEqual(original, before);
});

test("adoption fills only null descriptions; managed rows preserve even null descriptions", () => {
  const adopted = previewYouTubeBackfill(
    input([upload()], [row(A, { managed: false, description: null })]),
  );
  assert.equal(adopted.entries[0].proposed.description, "Provider description");
  const managed = previewYouTubeBackfill(input([upload()], [row(A, { description: null })]));
  assert.equal(managed.entries[0].proposed.description, null);
  assert.equal(managed.entries[0].classification, "unchanged");
});

test("managed changes compare provider fields while preserving staff fields and raw evidence", () => {
  const existing = row(A, { title: "Old", videoUrl: `https://youtu.be/${A}`, available: false });
  const [entry] = previewYouTubeBackfill(input([upload()], [existing])).entries;
  assert.equal(entry.classification, "changed");
  assert.deepEqual(entry.changeFields, ["title", "videoUrl", "available"]);
  assert.equal(entry.proposed.description, "Staff description");
  assert.equal(entry.proposed.published, false);
  assert.equal(entry.proposed.sortOrder, 7);
  assert.deepEqual(entry.existingEvidence, existing);
});

test("staff description differences alone remain unchanged and equivalent timestamp offsets match", () => {
  const [entry] = previewYouTubeBackfill(
    input([upload()], [row(A, { publishedAt: "2026-10-10T08:00:00+08:00" })]),
  ).entries;
  assert.equal(entry.classification, "unchanged");
  assert.deepEqual(entry.changeFields, []);
});

test("older holes past the saved boundary are compared by ID and included in targeted backfill", () => {
  const data = input(
    [upload(C, "2026-09-01T00:00:00Z"), upload(A), upload(B, "2026-10-01T00:00:00Z")],
    [row(B, { publishedAt: "2026-10-01T00:00:00Z" })],
  );
  data.boundaryVideoId = B;
  const result = previewYouTubeBackfill(data);
  assert.equal(result.boundary.found, true);
  assert.deepEqual(result.boundary.olderMissingIds, [C]);
  assert.deepEqual(result.targetedBackfillIds, [C, A]);
});

test("missing boundary leaves age unresolved and unmatched inventory never becomes a delete", () => {
  const data = input([upload()], [row(C)]);
  data.boundaryVideoId = B;
  const result = previewYouTubeBackfill(data);
  assert.equal(result.boundary.found, false);
  assert.equal(result.entries[0].olderThanBoundary, null);
  assert.deepEqual(result.boundary.olderMissingIds, []);
  assert.deepEqual(result.targetedBackfillIds, [A]);
  assert.deepEqual(result.unmatchedInventoryRowIds, [`cms-${C}`]);
  assert.match(result.warnings.join(" "), /boundary.*not observed/i);
  assert.match(result.warnings.join(" "), /never.*delet/i);
});

for (const scope of ["public_only", "unknown"] as const) {
  test(`${scope} inventory cannot establish inserts or expected publication for unseen IDs`, () => {
    const data = input();
    data.inventory.scope = scope;
    const result = previewYouTubeBackfill(data);
    assert.equal(result.inventoryIsComplete, false);
    assert.equal(result.entries[0].classification, "unresolved");
    assert.equal(result.entries[0].proposed.published, null);
    assert.equal(result.entries[0].proposed.description, null);
    assert.equal(result.entries[0].proposed.sortOrder, null);
    assert.equal(result.entries[0].expectedPublication.publiclyVisible, null);
    assert.equal(result.counts.insert, 0);
    assert.match(result.warnings.join(" "), /incomplete.*inventory/i);
  });
}

test("incomplete full DB inventory and unknown row management cannot assert exact adoption", () => {
  const data = input([upload()], [row(A, { managed: null, published: null, available: null })]);
  data.inventory.complete = false;
  const [entry] = previewYouTubeBackfill(data).entries;
  assert.equal(entry.classification, "unresolved");
  assert.equal(entry.expectedPublication.published, null);
  assert.equal(entry.expectedPublication.publiclyVisible, null);
});

test("partial channel evidence remains additive even with complete inventory", () => {
  const data = input([], [row()]);
  data.channel.complete = false;
  const result = previewYouTubeBackfill(data);
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.targetedBackfillIds, []);
  assert.match(result.warnings.join(" "), /incomplete.*channel/i);
  assert.equal(result.evidence.channel.complete, false);
});

const invalidCases: [string, (data: YouTubePreviewInput) => void, RegExp][] = [
  [
    "wrong channel",
    (data) => {
      data.channel.id = "UCwrong";
    },
    /channel/i,
  ],
  [
    "unverified channel",
    (data) => {
      data.channel.verified = false;
    },
    /verified/i,
  ],
  [
    "duplicate uploads",
    (data) => {
      data.uploads = [upload(), upload()];
    },
    /duplicate/i,
  ],
  [
    "invalid ID",
    (data) => {
      data.uploads = [upload("short")];
    },
    /video.*id/i,
  ],
  [
    "invalid timestamp",
    (data) => {
      data.uploads[0].publishedAt = "not-a-date";
    },
    /timestamp/i,
  ],
  [
    "rollover date",
    (data) => {
      data.uploads[0].publishedAt = "2026-02-30T00:00:00Z";
    },
    /timestamp/i,
  ],
  [
    "date without zone",
    (data) => {
      data.uploads[0].publishedAt = "2026-10-10T00:00:00";
    },
    /timestamp/i,
  ],
  [
    "future upload evidence",
    (data) => {
      data.uploads[0].publishedAt = "2026-10-17T00:00:00Z";
    },
    /capture/i,
  ],
  [
    "invalid capture",
    (data) => {
      data.inventory.capturedAt = "yesterday";
    },
    /timestamp/i,
  ],
  [
    "wrong URL identity",
    (data) => {
      data.uploads[0].canonicalUrl = `https://youtu.be/${B}`;
    },
    /identity/i,
  ],
  [
    "non-YouTube URL",
    (data) => {
      data.inventory.rows = [row(A, { videoUrl: `https://evil.test/watch?v=${A}` })];
    },
    /url/i,
  ],
  [
    "credential-bearing URL",
    (data) => {
      data.uploads[0].canonicalUrl = `https://user:secret@youtube.com/watch?v=${A}`;
    },
    /url/i,
  ],
  [
    "malformed URL path",
    (data) => {
      data.uploads[0].canonicalUrl = `https://youtube.com/shorts/${A}/extra`;
    },
    /url/i,
  ],
  [
    "duplicate row ID",
    (data) => {
      data.inventory.rows = [row(), row(B, { id: `cms-${A}` })];
    },
    /duplicate.*row/i,
  ],
  [
    "Shorts identity conflict",
    (data) => {
      data.inventory.rows = [
        row(),
        row(A, { id: "other", managed: false, videoUrl: `https://youtube.com/shorts/${A}` }),
      ];
    },
    /duplicate.*identity/i,
  ],
  [
    "managed ID/URL conflict",
    (data) => {
      data.inventory.rows = [row(A, { youtubeVideoId: B })];
    },
    /identity/i,
  ],
  [
    "manual row with managed identity",
    (data) => {
      data.inventory.rows = [row(A, { managed: false, youtubeVideoId: A })];
    },
    /identity/i,
  ],
  [
    "bad boundary",
    (data) => {
      data.boundaryVideoId = "bad";
    },
    /boundary/i,
  ],
];

for (const [name, mutate, expected] of invalidCases) {
  test(`rejects ${name} before producing any preview`, () => {
    const data = input();
    mutate(data);
    assert.throws(() => previewYouTubeBackfill(data), expected);
  });
}

test("Shorts uploads normalize identity while preserving raw candidate evidence", () => {
  const candidate = upload();
  candidate.canonicalUrl = `https://youtube.com/shorts/${A}`;
  const [entry] = previewYouTubeBackfill(input([candidate])).entries;
  assert.equal(entry.candidateEvidence.canonicalUrl, `https://youtube.com/shorts/${A}`);
  assert.equal(entry.proposed.videoUrl, `https://www.youtube.com/watch?v=${A}`);
});

test("row bounds and malformed JSON shapes fail closed", () => {
  assert.throws(() => previewYouTubeBackfill(null), /input/i);
  const data = input();
  data.uploads = Array.from({ length: 10_001 }, () => upload());
  assert.throws(() => previewYouTubeBackfill(data), /limit/i);
  assert.throws(() => previewYouTubeBackfill({ ...input(), inventory: null }), /inventory/i);
});

test("raw provider title evidence is preserved without whitespace transformations", () => {
  const candidate = { ...upload(), title: "  Original provider title  " };
  const result = previewYouTubeBackfill(input([candidate]));
  assert.equal(result.entries[0].candidateEvidence.title, "  Original provider title  ");
});

test("boundary with equal timestamps has unknown ordering for another missing ID", () => {
  const data = input([upload(A), upload(B)], [row(B)]);
  data.boundaryVideoId = B;
  const result = previewYouTubeBackfill(data);
  assert.equal(result.entries[0].olderThanBoundary, null);
  assert.deepEqual(result.targetedBackfillIds, [A]);
  assert.match(result.entries[0].uncertainties.join(" "), /same.*timestamp/i);
});

test("unknown provider descriptions remain null and cannot establish an insert", () => {
  const candidate = { ...upload(), description: null };
  const result = previewYouTubeBackfill({ ...input(), uploads: [candidate] });
  assert.equal(result.entries[0].classification, "unresolved");
  assert.equal(result.entries[0].candidateEvidence.description, null);
  assert.equal(result.entries[0].proposed.description, null);
  assert.equal(result.entries[0].expectedPublication.published, null);
  assert.match(result.entries[0].uncertainties.join(" "), /provider description.*unknown/i);
  assert.equal(result.counts.insert, 0);
});

test("unknown provider description is never borrowed from the public inventory", () => {
  const data = input([upload()], [row()]);
  data.inventory.scope = "public_only";
  const result = previewYouTubeBackfill({
    ...data,
    uploads: [{ ...upload(), description: null }],
  });
  assert.equal(result.entries[0].classification, "unresolved");
  assert.equal(result.entries[0].candidateEvidence.description, null);
  assert.equal(result.entries[0].existingEvidence?.description, "Staff description");
});

test("unknown source description blocks null-description adoption but preserves known staff text", () => {
  const candidate = { ...upload(), description: null };
  const blocked = previewYouTubeBackfill({
    ...input([], [row(A, { managed: false, description: null })]),
    uploads: [candidate],
  });
  assert.equal(blocked.entries[0].classification, "unresolved");
  assert.equal(blocked.entries[0].proposed.description, null);
  const known = previewYouTubeBackfill({
    ...input([], [row(A, { managed: false })]),
    uploads: [candidate],
  });
  assert.equal(known.entries[0].classification, "adoption");
  assert.equal(known.entries[0].proposed.description, "Staff description");
});

test("an unspecified saved boundary is explicitly reported as unknown", () => {
  const result = previewYouTubeBackfill(input());
  assert.equal(result.boundary.videoId, null);
  assert.equal(result.entries[0].olderThanBoundary, null);
  assert.match(result.warnings.join(" "), /boundary.*not supplied/i);
});

const cliPath = fileURLToPath(new URL("../../../scripts/youtube-sync-preview.ts", import.meta.url));

function withCli(run: (directory: string, args: string[]) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "youtube-offline-preview-"));
  const data = input(
    [upload(A), upload(B, "2026-10-01T00:00:00Z"), upload(C, "2026-09-01T00:00:00Z")],
    [row(B, { publishedAt: "2026-10-01T00:00:00Z" })],
  );
  data.boundaryVideoId = B;
  const uploadsPath = join(directory, "uploads.json");
  const inventoryPath = join(directory, "inventory.json");
  writeFileSync(
    uploadsPath,
    JSON.stringify({
      channel: data.channel,
      uploads: data.uploads,
      boundaryVideoId: data.boundaryVideoId,
    }),
  );
  writeFileSync(inventoryPath, JSON.stringify(data.inventory));
  const args = [
    "--uploads",
    uploadsPath,
    "--inventory",
    inventoryPath,
    "--json",
    join(directory, "preview.json"),
    "--markdown",
    join(directory, "preview.md"),
  ];
  try {
    run(directory, args);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function cli(args: string[], cwd: string) {
  return spawnSync(process.execPath, ["--no-env-file", cliPath, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
    env: {},
  });
}

test("CLI consumes only explicit JSON files and writes reviewable JSON plus Markdown", () => {
  withCli((directory, args) => {
    writeFileSync(join(directory, ".env"), "this must never be parsed as input\n");
    const result = cli(args, directory);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(join(directory, "preview.json"), "utf8"));
    assert.deepEqual(report.boundary.olderMissingIds, [C]);
    assert.equal(report.synthetic, true);
    const markdown = readFileSync(join(directory, "preview.md"), "utf8");
    assert.match(markdown, /SYNTHETIC/);
    assert.match(markdown, /full_db/);
    assert.match(markdown, /2026-10-16T04:00:00.000Z/);
    assert.match(markdown, /Existing evidence/);
    assert.match(markdown, /Candidate evidence/);
    assert.match(markdown, /Expected publication/);
    assert.match(markdown, /CCCCCCCCCCC/);
    assert.equal(readFileSync(args[1], "utf8").includes(CHANNEL), true);
  });
});

test("CLI labels public-only inventory and leaves hidden publication unresolved in both outputs", () => {
  withCli((directory, args) => {
    const data = input().inventory;
    data.scope = "public_only";
    data.complete = false;
    writeFileSync(args[3], JSON.stringify(data));
    const result = cli(args, directory);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(args[5], "utf8"));
    assert.equal(report.counts.insert, 0);
    assert.equal(report.entries[0].expectedPublication.published, null);
    assert.match(readFileSync(args[7], "utf8"), /Incomplete public_only inventory/);
  });
});

for (const flag of ["--online", "--api-key", "--full_snapshot"]) {
  test(`CLI rejects unsupported ${flag} before writing outputs`, () => {
    withCli((directory, args) => {
      const result = cli([...args, flag, "forbidden"], directory);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /unsupported.*option/i);
      assert.deepEqual(readdirSync(directory).sort(), ["inventory.json", "uploads.json"]);
    });
  });
}

test("CLI never overwrites input files or existing output evidence", () => {
  withCli((directory, args) => {
    writeFileSync(args[7], "previous evidence");
    const result = cli(args, directory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /output.*exists/i);
    assert.equal(readFileSync(args[7], "utf8"), "previous evidence");
    assert.equal(readdirSync(directory).includes("preview.json"), false);
    args[5] = args[1];
    const again = cli(args, directory);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /output.*exists/i);
    assert.equal(JSON.parse(readFileSync(args[1], "utf8")).channel.id, CHANNEL);
  });
});

test("CLI rejects invalid JSON, duplicate arguments and URL inputs without output artifacts", () => {
  withCli((directory, args) => {
    const duplicate = cli([...args, "--json", join(directory, "second.json")], directory);
    assert.equal(duplicate.status, 1);
    assert.match(duplicate.stderr, /duplicate/i);
    const remoteArgs = [...args];
    remoteArgs[1] = "https://youtube.com/uploads.json";
    const remote = cli(remoteArgs, directory);
    assert.equal(remote.status, 1);
    assert.match(remote.stderr, /local/i);
    writeFileSync(args[1], "{invalid");
    const invalid = cli(args, directory);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /JSON/i);
    assert.deepEqual(readdirSync(directory).sort(), ["inventory.json", "uploads.json"]);
  });
});

test("CLI rejects oversized input files, identical outputs and non-JSON input paths", () => {
  withCli((directory, args) => {
    const identicalArgs = [...args];
    identicalArgs[7] = identicalArgs[5];
    assert.equal(cli(identicalArgs, directory).status, 1);
    const envArgs = [...args];
    envArgs[1] = join(directory, ".env");
    assert.match(cli(envArgs, directory).stderr, /JSON/i);
    writeFileSync(args[1], " ".repeat(16 * 1024 * 1024 + 1));
    assert.match(cli(args, directory).stderr, /limit/i);
    assert.deepEqual(readdirSync(directory).sort(), ["inventory.json", "uploads.json"]);
  });
});
