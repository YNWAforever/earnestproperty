import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PropertySyncWorkspace } from "./PropertySyncWorkspace";
import type { SyncHistoryRow, SyncWorkspace } from "@/lib/neon/admin-property-sync.types";

const row: SyncHistoryRow = {
  id: "20000000-0000-0000-0000-000000000001",
  source: "28hse_agent_540",
  scope_id: "agent:540",
  operation: "collect",
  workflow_run_id: "123",
  git_sha: "a".repeat(40),
  request_asset: null,
  request_hash: null,
  receipt_id: null,
  branches: {},
  counts: {},
  dispatch_status: "not_requested",
  error_code: null,
  started_at: "2026-10-14T23:16:43Z",
  finished_at: "2026-10-14T23:17:34Z",
  stages: {
    collection: {
      status: "failed",
      errorCode: "SOURCE_ROBOTS_HTTP_403",
      pagesRead: 0,
      pagesFailed: 2,
    },
    ingestion: { status: "pending" },
    publication: { status: "pending" },
    verification: { status: "pending" },
  },
};
function render(history: SyncHistoryRow[]) {
  const initialData: SyncWorkspace = { cards: [], history, nextCursor: null, asOf: row.started_at };
  return renderToStaticMarkup(
    <PropertySyncWorkspace
      roles={["admin"]}
      initialData={initialData}
      load={async () => initialData}
      request={async () => {
        throw Error("unexpected write");
      }}
    />,
  );
}
describe("collection failure guidance", () => {
  test("robots rejection explains access failure without promising evidence replay", () => {
    const html = render([row]);
    expect(html).toContain("HTTP 403");
    expect(html).toContain("來源拒絕存取");
    expect(html).toContain("SOURCE_ROBOTS_HTTP_403");
    expect(html).toContain("未有可重試匯入的完整證據");
    expect(html).not.toContain("沿用原採集證據");
    expect(html).not.toMatch(/<button[^>]*>重試匯入<\/button>/);
    expect(html).not.toMatch(/<button[^>]*>重試上架<\/button>/);
  });
  test("historical generic failures disclose missing evidence without inventing a 403", () => {
    const html = render([
      { ...row, stages: { collection: { status: "failed", errorCode: "WORKFLOW_FAILED" } } },
    ]);
    expect(html).toContain("未有可重試匯入的完整證據");
    expect(html).not.toContain("HTTP 403");
    expect(html).not.toContain("沿用原採集證據");
  });
  test("post-crawl handoff failure preserves read evidence without recommending another crawl", () => {
    const html = render([
      {
        ...row,
        stages: {
          collection: {
            status: "failed",
            errorCode: "WORKFLOW_FAILED",
            pagesRead: 4,
            pagesFailed: 0,
          },
        },
      },
    ]);
    expect(html).toContain("已讀 4 頁；失敗 0 頁");
    expect(html).toContain("未有可重試匯入的完整證據");
    expect(html).toContain("保留原採集資料");
    expect(html).toContain("核對採集、證據凍結及上傳紀錄");
    expect(html).not.toContain("採集未完成");
    expect(html).not.toContain("再安排完整採集");
    expect(html).not.toContain("沿用原採集證據");
    expect(html).not.toMatch(/<button[^>]*>重試匯入<\/button>/);
    expect(html).not.toMatch(/<button[^>]*>重試上架<\/button>/);
  });
  test("failed downstream stages retain frozen request replay guidance", () => {
    const html = render([
      {
        ...row,
        request_asset: "request-123-1.json",
        stages: { collection: { status: "succeeded" }, ingestion: { status: "failed" } },
      },
    ]);
    expect(html).toContain("沿用原採集證據");
    expect(html).toMatch(/<button[^>]*>重試匯入<\/button>/);
    expect(html).toMatch(/<button[^>]*>重試上架<\/button>/);
    expect(html).not.toContain("未有可重試匯入的完整證據");
  });
});

test("rate limits explain waiting rather than requesting source access permission", () => {
  const html = render([
    {
      ...row,
      stages: {
        collection: { status: "failed", errorCode: "SOURCE_ROBOTS_HTTP_429" },
      },
    },
  ]);
  expect(html).toContain("HTTP 429");
  expect(html).toContain("限制請求頻率");
  expect(html).not.toContain("存取許可");
});

test("provider errors do not blame source access or offer ingestion replay", () => {
  for (const errorCode of ["PROVIDER_HTTP_401", "PROVIDER_HTTP_429", "PROVIDER_KEY_REQUIRED"]) {
    const html = render([
      {
        ...row,
        stages: { collection: { status: "failed", errorCode, pagesRead: 0, pagesFailed: 2 } },
      },
    ]);
    expect(html).toContain(errorCode);
    expect(html).toContain("未有可重試匯入的完整證據");
    expect(html).not.toContain("來源拒絕存取");
    expect(html).not.toContain("來源限制請求頻率");
    expect(html).not.toMatch(/<button[^>]*>重試匯入<\/button>/);
  }
});
