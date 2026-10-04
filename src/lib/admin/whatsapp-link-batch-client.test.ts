import { expect, test } from "bun:test";
import {
  reconcileLinkBatch,
  runWhatsappLinkBatch,
  batchResultCsv,
  knownFailedBatchRows,
  type LinkBatchProgress,
} from "./whatsapp-link-batch-client.ts";
import type { BatchRowDraft } from "../whatsapp-enquiries/link-batch-policy.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rows: BatchRowDraft[] = Array.from({ length: 60 }, (_, index) => ({
  rowKey: id(index + 1),
  placementId: `website:${index}`,
  input: {
    placementSource: "website",
    entryPointType: "reception",
    enabled: true,
    placementVerified: true,
  },
}));
const initial = (): LinkBatchProgress => ({
  batchId: id(100),
  rows,
  chunkIds: [id(101), id(102)],
  completed: [],
  nextChunk: 0,
  uncertain: false,
  preview: {
    batchId: id(100),
    previewToken: id(103),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    rows: [],
    counts: { create: 60, reuse: 0, blocked: 0 },
  },
});

test("60 rows submit in durable 50+10 chunks", async () => {
  const sizes: number[] = [];
  const result = await runWhatsappLinkBatch(
    initial(),
    {
      preview: async () => initial().preview,
      commit: async (input) => {
        sizes.push(input.rows.length);
        return { batchId: input.batchId, chunkId: input.chunkId, state: "committed", rows: [] };
      },
      read: async () => ({ operations: [] }),
    },
    () => {},
  );
  expect(sizes).toEqual([50, 10]);
  expect(result.nextChunk).toBe(2);
});

test("lost second response is reconciled without submitting it again", async () => {
  let calls = 0;
  const progress = await runWhatsappLinkBatch(
    initial(),
    {
      preview: async () => initial().preview,
      commit: async (input) => {
        calls++;
        if (calls === 2) throw new Error("network lost");
        return { batchId: input.batchId, chunkId: input.chunkId, state: "committed", rows: [] };
      },
      read: async () => ({
        operations: [101, 102].map((n) => ({
          batchId: id(100),
          chunkId: id(n),
          state: "committed" as const,
          rows: [],
        })),
      }),
    },
    () => {},
  );
  expect(progress.nextChunk).toBe(2);
  expect(calls).toBe(2);
});

test("recovery stops at first missing operation", () => {
  const progress = reconcileLinkBatch(initial(), [
    {
      batchId: id(100),
      chunkId: id(101),
      state: "committed",
      rows: [],
    },
  ]);
  expect(progress.nextChunk).toBe(1);
});

test("second chunk failure resumes with the same durable chunk ID", async () => {
  const seen: string[] = [];
  let saved = initial();
  const api = {
    preview: async () => initial().preview,
    commit: async (input: { batchId: string; chunkId: string; rows: BatchRowDraft[] }) => {
      seen.push(input.chunkId);
      if (input.chunkId === id(102) && seen.filter((value) => value === id(102)).length === 1)
        throw new Error("temporary failure");
      return {
        batchId: input.batchId,
        chunkId: input.chunkId,
        state: "committed" as const,
        rows: [],
      };
    },
    read: async () => ({
      operations: [{ batchId: id(100), chunkId: id(101), state: "committed" as const, rows: [] }],
    }),
  };
  await expect(
    runWhatsappLinkBatch(saved, api, (value) => {
      saved = value;
    }),
  ).rejects.toThrow("temporary failure");
  expect(saved.uncertain).toBe(true);
  const recovered = reconcileLinkBatch(saved, (await api.read()).operations);
  const result = await runWhatsappLinkBatch(recovered, api, (value) => {
    saved = value;
  });
  expect(result.nextChunk).toBe(2);
  expect(seen).toEqual([id(101), id(102), id(102)]);
});

test("persist an uncertain marker before a request can commit and the tab can close", async () => {
  let persisted = initial();
  await runWhatsappLinkBatch(
    initial(),
    {
      preview: async () => initial().preview,
      commit: async (input) => {
        expect(persisted.uncertain).toBe(true);
        expect(persisted.chunkIds[persisted.nextChunk]).toBe(input.chunkId);
        return { batchId: input.batchId, chunkId: input.chunkId, state: "committed", rows: [] };
      },
      read: async () => ({ operations: [] }),
    },
    (value) => {
      persisted = value;
    },
  );
  expect(persisted.uncertain).toBe(false);
});

test("an empty lookup cannot clear an in-flight submission", () => {
  const pending = { ...initial(), uncertain: true };
  expect(reconcileLinkBatch(pending, []).uncertain).toBe(true);
});

test("results export only known successful links and failed-row repair excludes unknown work", () => {
  const progress = initial();
  progress.rows = [{ ...rows[0], placementId: "=unsafe" }, ...rows.slice(1)];
  progress.completed = [
    {
      batchId: progress.batchId,
      chunkId: progress.chunkIds[0],
      state: "rejected",
      rows: [
        {
          rowKey: rows[0].rowKey,
          outcome: "created",
          code: "=unsafe",
          linkId: id(300),
          version: 1,
          reasonCode: null,
        },
        {
          rowKey: rows[1].rowKey,
          outcome: "blocked",
          code: null,
          linkId: null,
          version: null,
          reasonCode: "WA_LINK_STAFF_NOT_READY",
        },
        {
          rowKey: rows[2].rowKey,
          outcome: "failed",
          code: null,
          linkId: null,
          version: null,
          reasonCode: "CHUNK_NOT_COMMITTED",
        },
      ],
    },
  ];
  progress.nextChunk = 1;
  expect(knownFailedBatchRows(progress).map((row) => row.rowKey)).toEqual([
    rows[1].rowKey,
    rows[2].rowKey,
  ]);
  expect(batchResultCsv(progress, "website")).toContain("'=unsafe");
  expect(batchResultCsv(progress, "youtube")).not.toContain("unsafe");
  expect(knownFailedBatchRows({ ...progress, uncertain: true })).toEqual([]);
});

test("fifty-row results export confirmed failures separately with reasons and safe cells", () => {
  const progress = initial();
  progress.rows = rows.slice(0, 50).map((row, index) => ({
    ...row,
    placementId: index === 49 ? "=unsafe" : `website:${index}`,
    input: { ...row.input, publicListingNo: `A${String(index + 1).padStart(6, "0")}` },
  }));
  progress.chunkIds = [id(101)];
  progress.nextChunk = 1;
  progress.completed = [
    {
      batchId: progress.batchId,
      chunkId: id(101),
      state: "committed",
      rows: progress.rows.map((row, index) => ({
        rowKey: row.rowKey,
        outcome: index < 40 ? "created" : index < 45 ? "reused" : index < 48 ? "blocked" : "failed",
        code: index < 45 ? `confirmed-${index}` : null,
        linkId: index < 45 ? id(index + 300) : null,
        version: index < 45 ? 1 : null,
        reasonCode: index < 45 ? null : index === 49 ? "@unsafe" : "WA_LINK_VERSION_STALE",
      })),
    },
  ];
  const successful = batchResultCsv(progress, "website").trim().split("\r\n");
  const failures = batchResultCsv(progress, "website", "failure").trim().split("\r\n");
  expect(successful).toHaveLength(46);
  expect(failures).toHaveLength(6);
  expect(failures[0]).toContain("reason_code");
  expect(failures[0]).toContain("row_key");
  for (let index = 45; index < 50; index++)
    expect(failures.join("\n")).toContain(progress.rows[index].rowKey);
  expect(failures.join("\n")).not.toContain("/w/");
  expect(failures.join("\n")).toContain("'=unsafe");
  expect(failures.join("\n")).toContain("'@unsafe");
  expect(batchResultCsv(progress, "youtube", "failure").trim().split("\r\n")).toHaveLength(1);
  // Unsubmitted/unknown rows are not failures. Only committed row results export.
  const unknown = { ...progress, completed: [], nextChunk: 0, uncertain: true };
  expect(batchResultCsv(unknown, "website", "failure").trim().split("\r\n")).toHaveLength(1);
});
