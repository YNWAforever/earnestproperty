import { expect, test } from "bun:test";
import { listDrafts, loadDraft, prepareEligibleSubset, saveDraft } from "./whatsapp-batch-draft.ts";
import type { BatchRowDraft } from "../whatsapp-enquiries/link-batch-policy.ts";
import type { BatchPreview } from "../neon/whatsapp-link-batches.types.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rows: BatchRowDraft[] = Array.from({ length: 60 }, (_, i) => ({
  rowKey: id(i + 1),
  placementId: `website:${i + 1}`,
  input: {
    placementSource: "website",
    entryPointType: "reception",
    enabled: true,
    placementVerified: true,
  },
}));
const preview: BatchPreview = {
  batchId: id(100),
  previewToken: id(101),
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  rows: rows.map((row, i) => ({
    rowKey: row.rowKey,
    decision: i === 59 ? "blocked" : "create",
    existingLinkId: null,
    reasons: i === 59 ? [{ code: "WA_LINK_STAFF_NOT_READY", message: "not ready" }] : [],
  })),
  counts: { create: 59, reuse: 0, blocked: 1 },
};

test("60 rows with one blocked produce a 59-row eligible subset without changing signed preview", () => {
  const before = JSON.stringify(preview);
  const result = prepareEligibleSubset(
    rows,
    preview,
    preview.rows.slice(0, 59).map((row) => row.rowKey),
  );
  expect(result.rows).toHaveLength(59);
  expect(result.excludedRowKeys).toEqual([rows[59].rowKey]);
  expect(JSON.stringify(preview)).toBe(before);
  expect(() => prepareEligibleSubset(rows, preview, [rows[59].rowKey])).toThrow(
    "BATCH_ROW_NOT_ELIGIBLE",
  );
  expect(() => prepareEligibleSubset(rows, preview, [id(999)])).toThrow("BATCH_ROW_NOT_ELIGIBLE");
});

test("local draft is versioned, actor scoped, and strips unexpected recipient and token fields", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  const contaminated = {
    ...rows[0],
    jwt: "secret",
    input: { ...rows[0].input, providerUserId: "provider", recipient: "+85212345678" },
  };
  saveDraft("actor-a", { draftId: id(200), rows: [contaminated] }, storage);
  expect(loadDraft("actor-b", id(200), storage)).toBeNull();
  const saved = loadDraft("actor-a", id(200), storage);
  expect(saved?.rows).toHaveLength(1);
  saveDraft("actor-a", { draftId: id(201), rows: [{ ...rows[0], placementId: "" }] }, storage);
  expect(loadDraft("actor-a", id(201), storage)?.rows[0].placementId).toBe("");
  expect(JSON.stringify([...data.values()])).not.toContain("secret");
  expect(JSON.stringify([...data.values()])).not.toContain("provider");
  expect(JSON.stringify([...data.values()])).not.toContain("+85212345678");
  const [key] = data.keys();
  data.set(key, JSON.stringify({ version: 0, rows }));
  expect(loadDraft("actor-a", id(200), storage)).toBeNull();
});

test("draft chooser lists only validated nonempty drafts for the exact actor", () => {
  const data = new Map<string, string>();
  const storage = {
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  saveDraft("actor:a", { draftId: id(300), rows: rows.slice(0, 5) }, storage);
  saveDraft("actor:a:other", { draftId: id(301), rows: rows.slice(0, 50) }, storage);
  saveDraft("actor:a", { draftId: id(302), rows: [] }, storage);
  saveDraft("actor:a", { draftId: id(303), rows: rows.slice(0, 3) }, storage);
  const corruptKey = [...data.keys()].find((key) => key.endsWith(id(303)))!;
  data.set(corruptKey, '{"version":1,"rows":"not-rows"}');
  data.set("earnest:whatsapp-link-draft:v1:actor%3Aa:not-a-uuid", "{}");
  expect(listDrafts("actor:a", storage).map((d) => [d.draftId, d.rows.length])).toEqual([
    [id(300), 5],
  ]);
  expect(listDrafts("actor:a:other", storage).map((d) => d.draftId)).toEqual([id(301)]);
  expect(listDrafts("", storage)).toEqual([]);
});
