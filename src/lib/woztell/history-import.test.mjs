import assert from "node:assert/strict";
import test from "node:test";
import { runHistoryImportPage } from "./history-import.server.ts";
const payload = {
  importId: "fake-import",
  cursor: "after-20000",
  channelId: "fake-channel",
  mode: "forward",
};
function ports(overrides = {}) {
  return {
    load: async () => ({ cursor: payload.cursor, completed: false }),
    fetchPage: async (p) => ({
      nodes: [
        {
          memberId: "synthetic",
          from: "MEMBER",
          messageEvent: { messageId: "one", type: "TEXT", data: { text: "fixture" } },
        },
      ],
      cursor: "after-20100",
      hasMore: true,
      totalCount: 30000,
    }),
    ingest: async () => {},
    advance: async () => {},
    ...overrides,
  };
}
test("interrupted history beyond 20000 resumes the persisted cursor and advances after ingestion", async () => {
  const order = [];
  await runHistoryImportPage(
    payload,
    async () => {},
    ports({
      fetchPage: async (p) => {
        assert.equal(p.cursor, "after-20000");
        return { nodes: [{}], cursor: "after-20100", hasMore: true };
      },
      ingest: async () => {
        order.push("ingest");
      },
      advance: async (p, page) => {
        order.push("advance");
        assert.equal(page.cursor, "after-20100");
      },
    }),
  );
  assert.deepEqual(order, ["ingest", "advance"]);
});
test("partial page failure retains cursor so retry can deduplicate already ingested messages", async () => {
  let advances = 0;
  await assert.rejects(
    runHistoryImportPage(
      payload,
      async () => {},
      ports({
        ingest: async () => {
          throw Error("db failed");
        },
        advance: async () => {
          advances++;
        },
      }),
    ),
    /db failed/,
  );
  assert.equal(advances, 0);
});
test("stale job cannot move a newer persisted cursor backwards", async () => {
  let fetches = 0;
  await runHistoryImportPage(
    payload,
    async () => {},
    ports({
      load: async () => ({ cursor: "later", completed: false }),
      fetchPage: async () => {
        fetches++;
      },
    }),
  );
  assert.equal(fetches, 0);
});
test("stalled cursor fails visibly without marking import completed", async () => {
  await assert.rejects(
    runHistoryImportPage(
      payload,
      async () => {},
      ports({ fetchPage: async () => ({ nodes: [], cursor: payload.cursor, hasMore: true }) }),
    ),
    /CURSOR_STALLED/,
  );
});
test("empty forward page uses backward mode and persists the selected direction", async () => {
  const modes = [];
  await runHistoryImportPage(
    { ...payload, cursor: null },
    async () => {},
    ports({
      load: async () => ({ cursor: null, completed: false }),
      fetchPage: async (p) => {
        modes.push(p.mode);
        return { nodes: [], cursor: null, hasMore: false };
      },
      advance: async (p) => {
        assert.equal(p.mode, "backward");
      },
    }),
  );
  assert.deepEqual(modes, ["forward", "backward"]);
});
