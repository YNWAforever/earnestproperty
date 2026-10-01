import test from "node:test";
import assert from "node:assert/strict";
import { orderPublicationQueue, publicationBacklog } from "./publication-queue.mjs";
const candidate = (id, last, created = "2026-10-01T01:00:00Z") => ({
  record: { externalId: id, dealType: "sale" },
  property: { created_at: created, last_media_attempt_at: last },
  item: { sourceId: id },
});
test("never attempted first, oldest attempt next, identity tie break independent of request order", () => {
  const rows = [
    candidate("3", "2026-10-01T02:00:00Z"),
    candidate("2", null),
    candidate("1", null),
    candidate("4", "2026-09-30T02:00:00Z"),
  ];
  assert.deepEqual(
    orderPublicationQueue(rows).map((x) => x.record.externalId),
    ["1", "2", "4", "3"],
  );
  assert.deepEqual(
    orderPublicationQueue(rows.toReversed()).map((x) => x.record.externalId),
    ["1", "2", "4", "3"],
  );
});
test("failed media attempt yields to never attempted backlog on next run", () => {
  const rows = Array.from({ length: 26 }, (_, i) =>
    candidate(String(i + 1).padStart(2, "0"), i < 20 ? "2026-10-01T02:00:00Z" : null),
  );
  assert.deepEqual(
    orderPublicationQueue(rows)
      .slice(0, 6)
      .map((x) => x.record.externalId),
    ["21", "22", "23", "24", "25", "26"],
  );
});
test("backlog includes held media, excludes successful publications, keeps original wait date", () => {
  const rows = [candidate("1", null, "2026-09-28T01:00:00Z"), candidate("2", null)];
  assert.deepEqual(publicationBacklog(rows, [{ sourceId: "2" }]), {
    eligibleBacklog: 1,
    oldestWaitingAt: "2026-09-28T01:00:00.000Z",
  });
  assert.deepEqual(
    publicationBacklog(
      rows,
      rows.map((x) => x.item),
    ),
    { eligibleBacklog: 0, oldestWaitingAt: null },
  );
});
