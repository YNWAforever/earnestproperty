import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { verifySourceAuthorityFacts, canPreserveNewerCache } from "./incremental-daily.mjs";
import { hashPayload } from "../../src/lib/mls/ingestion-contract.mjs";
import { incrementalBatch } from "../../src/lib/mls/incremental-test-fixtures.mjs";

const PREFIX = "ep-authority-wrapper-";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fixture(t) {
  const base = resolve(tmpdir());
  const root = await mkdtemp(join(base, PREFIX));
  t.after(async () => {
    const target = resolve(root);
    assert.equal(target, root);
    assert.equal(dirname(target), base);
    assert.ok(basename(target).startsWith(PREFIX));
    await rm(target, { recursive: true, force: true });
  });
  await mkdir(join(root, "bundle"));
  const payload = incrementalBatch();
  payload.listings[0].title = "離線驗證測試";
  const evidence = { errors: [], requests: [], provider_requests: [], selected_candidates: [] };
  const requestBytes = Buffer.from(JSON.stringify(payload, null, 2) + "\n");
  const evidenceBytes = Buffer.from(JSON.stringify(evidence) + "\n");
  const paths = {
    request: join(root, "bundle/request.json"),
    evidence: join(root, "bundle/evidence.json"),
    proof: join(root, "source-authority-facts.json"),
  };
  await writeFile(paths.request, requestBytes);
  await writeFile(paths.evidence, evidenceBytes);
  return { root, payload, evidence, requestBytes, evidenceBytes, paths };
}
function proofFor(f) {
  return {
    version: "28hse-authority-semantic-v1",
    status: "verified",
    request_sha256: sha256(f.requestBytes),
    evidence_sha256: sha256(f.evidenceBytes),
    parser_version: f.payload.meta.parser_version,
    record_count: f.payload.listings.length,
  };
}
function runner(f, { proof = proofFor(f), afterWrite = async () => {}, inspect = () => {} } = {}) {
  return async (file, args, options) => {
    inspect(file, args, options);
    assert.equal(args[0], resolve("scripts/property-sync/source_authority_verify.py"));
    assert.deepEqual(args.slice(1), [
      "--request",
      f.paths.request,
      "--evidence",
      f.paths.evidence,
      "--output",
      f.paths.proof,
    ]);
    await writeFile(f.paths.proof, JSON.stringify(proof));
    await afterWrite();
  };
}
async function withEnv(patch, work) {
  const saved = Object.fromEntries(Object.keys(patch).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await work();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("semantic wrapper binds exact UTF-8 input bytes and returns the canonical payload identity", async (t) => {
  const f = await fixture(t);
  const before = structuredClone(f.payload);
  const proof = proofFor(f);
  const result = await verifySourceAuthorityFacts(f.root, f.payload, { run: runner(f) });
  assert.deepEqual(result, {
    payloadHash: hashPayload(f.payload),
    parserVersion: f.payload.meta.parser_version,
    semanticProof: proof,
  });
  assert.deepEqual(f.payload, before);
  assert.deepEqual(await readFile(f.paths.request), f.requestBytes);
  assert.deepEqual(await readFile(f.paths.evidence), f.evidenceBytes);
  assert.notEqual(proof.request_sha256, sha256(Buffer.from(JSON.stringify(f.payload))));
});

test("subprocess receives only runtime environment and forced UTF-8, without database or service credentials", async (t) => {
  const f = await fixture(t);
  const secrets = [
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "NEON_API_KEY",
    "BLOB_READ_WRITE_TOKEN",
    "SOURCE_AUTHORITY_BLOB_TOKEN",
    "FIRECRAWL_API_KEY",
    "FIRECRAWL_API_KEYS",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "OPENAI_API_KEY",
    "UNRELATED_SECRET",
    "APP_TOKEN",
  ];
  const patch = Object.fromEntries(secrets.map((key) => [key, "offline-secret-value"]));
  Object.assign(patch, {
    PATH: "offline-runtime-path",
    PYTHONUTF8: "0",
    PROPERTY_SYNC_PYTHON: "offline-verifier-python",
  });
  await withEnv(patch, async () => {
    let calls = 0;
    const run = runner(f, {
      inspect: (file, _args, options) => {
        calls++;
        assert.equal(file, "offline-verifier-python");
        assert.equal(
          Object.entries(options.env).find(([key]) => /^PATH$/i.test(key))?.[1],
          "offline-runtime-path",
        );
        assert.equal(options.env.PYTHONUTF8, "1");
        for (const key of secrets) assert.equal(options.env[key], undefined, key);
        assert.equal(options.env.PROPERTY_SYNC_PYTHON, undefined);
        assert.ok(
          Object.keys(options.env).every((key) =>
            /^(PATH|SystemRoot|WINDIR|TEMP|TMP|LANG|LC_ALL|VIRTUAL_ENV|PYTHONPATH|PYTHONUTF8)$/i.test(
              key,
            ),
          ),
        );
      },
    });
    await verifySourceAuthorityFacts(f.root, f.payload, { run });
    assert.equal(calls, 1);
    assert.equal(process.env.DATABASE_URL, "offline-secret-value");
    assert.equal(process.env.PYTHONUTF8, "0");
  });
});

for (const [field, value] of [
  ["version", "other-version"],
  ["status", "rejected"],
  ["request_sha256", "a".repeat(64)],
  ["evidence_sha256", "b".repeat(64)],
  ["parser_version", "future-parser"],
  ["record_count", 0],
  ["record_count", "1"],
])
  test("semantic wrapper rejects proof mismatch: " + field + "=" + String(value), async (t) => {
    const f = await fixture(t);
    const proof = { ...proofFor(f), [field]: value };
    await assert.rejects(
      verifySourceAuthorityFacts(f.root, f.payload, { run: runner(f, { proof }) }),
      /SOURCE_AUTHORITY_FACT_PROOF_MISMATCH/,
    );
  });

test("mismatched in-memory payload is rejected before starting the verifier", async (t) => {
  const f = await fixture(t);
  f.payload.listings[0].price = "1";
  let calls = 0;
  await assert.rejects(
    verifySourceAuthorityFacts(f.root, f.payload, {
      run: async () => {
        calls++;
      },
    }),
    /SOURCE_AUTHORITY_REQUEST_CHANGED/,
  );
  assert.equal(calls, 0);
});

test("formatting-equivalent request bytes still require the exact request-byte digest", async (t) => {
  const f = await fixture(t);
  const proof = proofFor(f);
  await writeFile(f.paths.request, JSON.stringify(f.payload));
  await assert.rejects(
    verifySourceAuthorityFacts(f.root, f.payload, { run: runner(f, { proof }) }),
    /SOURCE_AUTHORITY_FACT_PROOF_MISMATCH/,
  );
});

for (const field of ["request", "evidence"])
  test("input file mutation during verifier execution is rejected: " + field, async (t) => {
    const f = await fixture(t);
    const run = runner(f, { afterWrite: () => writeFile(f.paths[field], "{}\n") });
    await assert.rejects(
      verifySourceAuthorityFacts(f.root, f.payload, { run }),
      /SOURCE_AUTHORITY_FACT_PROOF_MISMATCH/,
    );
  });

test("payload mutation during asynchronous verifier execution cannot obtain a proof for new facts", async (t) => {
  const f = await fixture(t);
  const run = runner(f, {
    afterWrite: async () => {
      f.payload.listings[0].price = "1";
    },
  });
  await assert.rejects(
    verifySourceAuthorityFacts(f.root, f.payload, { run }),
    /SOURCE_AUTHORITY_(REQUEST_CHANGED|FACT_PROOF_MISMATCH)/,
  );
});

test("verifier subprocess failure is propagated even if a previous successful proof file exists", async (t) => {
  const f = await fixture(t);
  await writeFile(f.paths.proof, JSON.stringify(proofFor(f)));
  const failure = Error("OFFLINE_VERIFIER_REJECTED");
  await assert.rejects(
    verifySourceAuthorityFacts(f.root, f.payload, {
      run: async () => {
        throw failure;
      },
    }),
    (error) => error === failure,
  );
});

test("missing or malformed proof output cannot authorize publication", async (t) => {
  const f = await fixture(t);
  await assert.rejects(verifySourceAuthorityFacts(f.root, f.payload, { run: async () => {} }));
  await assert.rejects(
    verifySourceAuthorityFacts(f.root, f.payload, {
      run: async () => writeFile(f.paths.proof, "{"),
    }),
    SyntaxError,
  );
});

test("empty fresh-detail deltas bind a zero-count proof without manufacturing records", async (t) => {
  const f = await fixture(t);
  f.payload.listings = [];
  f.requestBytes = Buffer.from(JSON.stringify(f.payload));
  await writeFile(f.paths.request, f.requestBytes);
  const result = await verifySourceAuthorityFacts(f.root, f.payload, { run: runner(f) });
  assert.equal(result.semanticProof.record_count, 0);
  assert.equal(result.payloadHash, hashPayload(f.payload));
});

test("reviewed reconciliation preserves a newer accepted cache without accepting the old capture again", () => {
  const receipt = {
    receipt_id: "accepted-old",
    success: true,
    incremental: true,
    full_snapshot: false,
    scraped_at: "2026-11-14T02:34:48.720771Z",
  };
  const report = {
    authority: "28hse-authority-v1",
    receiptId: receipt.receipt_id,
    held: [],
    unknown: [],
  };
  const authority = {
    incremental_receipt_id: "accepted-new",
    last_incremental_scraped_at: "2026-11-14T03:34:48.720771Z",
  };
  const prepared = { replay: true };
  assert.equal(canPreserveNewerCache(report, receipt, authority, prepared), true);
  const cases = [
    [{ ...report, authority: "other" }, receipt, authority, prepared],
    [{ ...report, receiptId: "other" }, receipt, authority, prepared],
    [{ ...report, held: [{}] }, receipt, authority, prepared],
    [{ ...report, unknown: [{}] }, receipt, authority, prepared],
    [report, { ...receipt, full_snapshot: true }, authority, prepared],
    [report, { ...receipt, success: false }, authority, prepared],
    [report, { ...receipt, scraped_at: "bad" }, authority, prepared],
    [report, receipt, { ...authority, incremental_receipt_id: receipt.receipt_id }, prepared],
    [
      report,
      receipt,
      { ...authority, last_incremental_scraped_at: "2026-11-13T00:00:00Z" },
      prepared,
    ],
    [report, receipt, { ...authority, last_incremental_scraped_at: "bad" }, prepared],
    [report, receipt, authority, { replay: false }],
  ];
  for (const args of cases) assert.equal(canPreserveNewerCache(...args), false);
});
