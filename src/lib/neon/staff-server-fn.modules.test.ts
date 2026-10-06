import { beforeEach, expect, mock, test } from "bun:test";
import { ServerFnResponseError } from "./server-fn-response";

type StubOptions = { data?: unknown; headers?: Headers };
type Stub = (options: StubOptions) => unknown;
const fixture = globalThis as typeof globalThis & { __fx10aStub: Stub };

// createServerFn() → builder; inputValidator() returns the builder; handler() returns the
// client-side callable, which forwards to whatever the current test installs.
mock.module("@tanstack/react-start", () => {
  const builder = {
    inputValidator: () => builder,
    handler: () => (opts: StubOptions) => fixture.__fx10aStub(opts),
  };
  return { createServerFn: () => builder };
});
mock.module("@tanstack/react-start/server", () => ({
  getRequest: () => new Request("https://fixture"),
}));
mock.module("@/auth", () => ({
  withStaffAuthHeaders: async (o: Record<string, unknown> = {}) => ({
    ...o,
    headers: new Headers({ authorization: "Bearer fx10a" }),
  }),
}));

const uuid = "00000000-0000-4000-8000-000000000001";
const row = {
  rowKey: uuid,
  placementId: "website:1",
  input: { placementSource: "website", entryPointType: "reception", enabled: true },
};

type Call = (...args: unknown[]) => Promise<unknown>;
const load = async (path: string) => (await import(path)) as Record<string, Call>;
const modules = {
  management: await load("./whatsapp-link-management"),
  selection: await load("./whatsapp-link-selection"),
  import: await load("./whatsapp-link-import"),
  coverage: await load("./whatsapp-coverage"),
  batches: await load("./whatsapp-link-batches"),
  exportApi: await load("../admin/whatsapp-link-export-api"),
};

const table: [string, Call, unknown[]][] = [
  [
    "whatsapp-link-management getWhatsappTrackingLinksPage",
    modules.management.getWhatsappTrackingLinksPage,
    [{}],
  ],
  [
    "whatsapp-link-selection snapshotWhatsappLinkOffers",
    modules.selection.snapshotWhatsappLinkOffers,
    [{}],
  ],
  [
    "whatsapp-link-import resolveWhatsappLinkImport",
    modules.import.resolveWhatsappLinkImport,
    [{ offers: [], references: [] }],
  ],
  [
    "whatsapp-coverage getWebsiteTrackingCoverage",
    modules.coverage.getWebsiteTrackingCoverage,
    [{}],
  ],
  ["whatsapp-coverage previewCoverageBackfill", modules.coverage.previewCoverageBackfill, [[uuid]]],
  [
    "whatsapp-link-batches previewWhatsappLinkBatch",
    modules.batches.previewWhatsappLinkBatch,
    [{ batchId: uuid, rows: [row] }],
  ],
  [
    "whatsapp-link-batches commitWhatsappLinkChunk",
    modules.batches.commitWhatsappLinkChunk,
    [{ batchId: uuid, chunkId: uuid, previewToken: uuid, rows: [row] }],
  ],
  [
    "whatsapp-link-batches getWhatsappLinkBatchResult",
    modules.batches.getWhatsappLinkBatchResult,
    [uuid],
  ],
  [
    "whatsapp-link-export-api prepareWhatsappLinkExport",
    modules.exportApi.prepareWhatsappLinkExport,
    [{ scope: "all", filter: {} }],
  ],
  [
    "whatsapp-link-export-api getWhatsappLinkExportPage",
    modules.exportApi.getWhatsappLinkExportPage,
    [{ snapshotId: uuid, offset: 0 }],
  ],
];

let seen: StubOptions[] = [];
beforeEach(() => {
  seen = [];
});

test("every link-area staff wrapper rejects a resolved 401, 403 and 409 Response", async () => {
  for (const [name, call, args] of table) {
    expect(typeof call).toBe("function");
    for (const status of [401, 403, 409]) {
      seen = [];
      fixture.__fx10aStub = async (options) => {
        seen.push(options);
        return new Response("X", { status });
      };
      let error: unknown;
      try {
        await call(...args);
      } catch (cause) {
        error = cause;
      }
      expect({ name, status, rejected: error instanceof ServerFnResponseError }).toEqual({
        name,
        status,
        rejected: true,
      });
      expect((error as ServerFnResponseError).status).toBe(status);
      expect(seen).toHaveLength(1);
      expect(seen[0].headers?.get("authorization")).toBe("Bearer fx10a");
    }
  }
});

test("every link-area staff wrapper passes a genuine result through", async () => {
  for (const [name, call, args] of table) {
    fixture.__fx10aStub = async () => ({ ok: true });
    expect({ name, result: await call(...args) }).toEqual({ name, result: { ok: true } });
  }
});

test("a denied chunk commit is not recorded as completed and the batch does not advance", async () => {
  const { runWhatsappLinkBatch } = await import("../admin/whatsapp-link-batch-client");
  for (const status of [403, 409]) {
    fixture.__fx10aStub = async () => new Response("Forbidden", { status });
    const saved: { nextChunk: number; completed: unknown[]; uncertain: boolean }[] = [];
    let error: unknown;
    try {
      await runWhatsappLinkBatch(
        {
          batchId: uuid,
          rows: [row as never],
          chunkIds: [uuid],
          completed: [],
          nextChunk: 0,
          uncertain: false,
          preview: {
            batchId: uuid,
            previewToken: uuid,
            expiresAt: new Date(Date.now() + 60000).toISOString(),
            rows: [],
            counts: { create: 1, reuse: 0, blocked: 0 },
          },
        },
        {
          preview: (input) => modules.batches.previewWhatsappLinkBatch(input) as never,
          commit: (input) => modules.batches.commitWhatsappLinkChunk(input) as never,
          read: (batchId) => modules.batches.getWhatsappLinkBatchResult(batchId) as never,
        },
        (progress) => saved.push(progress),
      );
    } catch (cause) {
      error = cause;
    }
    expect((error as ServerFnResponseError).status).toBe(status);
    const last = saved.at(-1);
    expect(last?.nextChunk).toBe(0);
    expect(last?.completed).toEqual([]);
    expect(last?.uncertain).toBe(true);
  }
});
