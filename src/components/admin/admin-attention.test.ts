import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ATTENTION_POLL_MS,
  adminAttentionIdentity,
  attentionBadge,
  attentionBadges,
  badgeText,
  createAdminAttentionStore,
  inboxBadgeDescription,
  leadsBadgeDescription,
  useAdminAttention,
  withAttentionTitle,
} from "./admin-attention";
import { withTimeout } from "@/lib/admin/with-timeout";
import type { AdminAttentionCounts } from "@/lib/neon/admin-data.types";

function counts(
  unansweredConversations: number,
  unassignedLeads: number,
  staleNewLeads: number,
  leadsNeedingAttention = unassignedLeads + staleNewLeads,
): AdminAttentionCounts {
  return { unansweredConversations, unassignedLeads, staleNewLeads, leadsNeedingAttention };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

type Deferred = ReturnType<typeof deferred<AdminAttentionCounts>>;

const EMPTY_SNAPSHOT = { identity: null, counts: null, checkedAt: null };

/** A fetcher whose every read stays pending until the test settles it. */
function pendingReads() {
  const reads: Deferred[] = [];
  const fetcher = () => {
    const read = deferred<AdminAttentionCounts>();
    reads.push(read);
    return read.promise;
  };
  return { reads, fetcher };
}

describe("attention badges and copy", () => {
  test("badges: leads counts distinct leads needing attention, inbox is unanswered, total sums the two; null is zero", () => {
    expect(ATTENTION_POLL_MS).toBe(60_000);
    // One lead is both unassigned and stale, so it is counted once (2 + 2 would double-count).
    expect(attentionBadges(counts(3, 2, 2, 3))).toEqual({ leads: 3, inbox: 3, total: 6 });
    expect(attentionBadges(null)).toEqual({ leads: 0, inbox: 0, total: 0 });

    expect(attentionBadge("inbox", counts(2, 0, 0))).toEqual({
      count: 2,
      description: "2 個對話待回覆",
    });
    expect(attentionBadge("leads", counts(2, 1, 2, 2))).toEqual({
      count: 2,
      description: "未指派 1 宗；逾 2 小時未跟進的新查詢 2 宗",
    });
    // A count of 0 shows no badge and no description.
    expect(attentionBadge("leads", counts(2, 0, 0))).toBeNull();
    expect(attentionBadge("inbox", null)).toBeNull();
  });

  test("title prefix is added, replaced and removed without stacking; above 99 shows 99+", () => {
    expect(withAttentionTitle("WhatsApp Inbox｜Earnest Admin", 3)).toBe(
      "(3) WhatsApp Inbox｜Earnest Admin",
    );
    expect(withAttentionTitle("(3) X", 5)).toBe("(5) X");
    expect(withAttentionTitle("(5) X", 0)).toBe("X");
    expect(withAttentionTitle("X", 120)).toBe("(99+) X");
    expect(withAttentionTitle("(99+) X", 4)).toBe("(4) X");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(100)).toBe("99+");
  });

  test("badge descriptions are the exact zh-HK copy", () => {
    expect(inboxBadgeDescription(counts(4, 0, 0))).toBe("4 個對話待回覆");
    expect(leadsBadgeDescription(counts(0, 1, 2, 2))).toBe(
      "未指派 1 宗；逾 2 小時未跟進的新查詢 2 宗",
    );
  });
});

describe("adminAttentionIdentity", () => {
  const ok = (roles: ("admin" | "manager" | "agent" | "viewer")[]) =>
    ({ status: "ok", staffId: "staff-1", email: null, name: null, roles }) as const;

  test("names the user, staff record and sorted roles of staff who read the counts", () => {
    expect(adminAttentionIdentity("user-1", ok(["manager", "agent"]))).toBe(
      JSON.stringify(["user-1", "staff-1", ["agent", "manager"]]),
    );
    expect(adminAttentionIdentity("user-1", ok(["viewer", "agent"]))).toBe(
      JSON.stringify(["user-1", "staff-1", ["agent", "viewer"]]),
    );
  });

  test("is null for a viewer, a denied or unknown session", () => {
    expect(adminAttentionIdentity("user-1", ok(["viewer"]))).toBeNull();
    expect(adminAttentionIdentity("user-1", ok([]))).toBeNull();
    expect(adminAttentionIdentity("user-1", { status: "denied", reason: "forbidden" })).toBeNull();
    expect(adminAttentionIdentity("user-1", null)).toBeNull();
  });
});

describe("admin attention store", () => {
  // A failed read logs one constant tag and the error's name. Record the warnings so the test
  // output stays clean and each failure test can check exactly what was logged.
  const realWarn = console.warn;
  let warnings: unknown[][] = [];
  beforeEach(() => {
    warnings = [];
    console.warn = (...args: unknown[]) => void warnings.push(args);
  });
  afterEach(() => {
    console.warn = realWarn;
  });

  test("concurrent refreshes share one request", async () => {
    let calls = 0;
    const read = deferred<AdminAttentionCounts>();
    const store = createAdminAttentionStore(() => {
      calls += 1;
      return read.promise;
    });

    const first = store.refresh("id-1");
    const second = store.refresh("id-1");
    expect(calls).toBe(1);

    read.resolve(counts(1, 2, 3));
    await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(store.getSnapshot().counts).toEqual(counts(1, 2, 3));
  });

  test("a failed refresh keeps the last counts for the same identity", async () => {
    let fail = false;
    const store = createAdminAttentionStore(async () => {
      if (fail) throw new Error("合成讀取失敗");
      return counts(1, 2, 3);
    });

    await store.refresh("id-1");
    const before = store.getSnapshot();
    fail = true;
    await expect(store.refresh("id-1")).resolves.toBeUndefined();

    expect(store.getSnapshot().identity).toBe("id-1");
    expect(store.getSnapshot().counts).toEqual(counts(1, 2, 3));
    expect(store.getSnapshot().checkedAt).toBe(before.checkedAt);
    // Logged once, by tag and error name only: never the message, a response body or counts.
    expect(warnings).toEqual([["ADMIN_ATTENTION_READ_FAILED", "Error"]]);
  });

  test("a hung read times out like any failure: last counts kept, the next refresh asks again", async () => {
    let calls = 0;
    let hang = false;
    const store = createAdminAttentionStore(() => {
      calls += 1;
      return withTimeout(
        hang
          ? new Promise<AdminAttentionCounts>(() => undefined)
          : Promise.resolve(counts(2, 0, 0)),
        5,
      );
    });

    await store.refresh("id-1");
    hang = true;
    await expect(store.refresh("id-1")).resolves.toBeUndefined();
    expect(store.getSnapshot().counts).toEqual(counts(2, 0, 0));

    hang = false;
    await store.refresh("id-1");
    expect(calls).toBe(3);
    expect(warnings).toEqual([["ADMIN_ATTENTION_READ_FAILED", "TimeoutError"]]);
  });

  test("counts never cross identities", async () => {
    const reads = new Map<string, ReturnType<typeof deferred<AdminAttentionCounts>>>();
    let next = "A";
    const store = createAdminAttentionStore(() => {
      const read = deferred<AdminAttentionCounts>();
      reads.set(next, read);
      return read.promise;
    });

    const a = store.refresh("A");
    next = "B";
    const b = store.refresh("B");
    // The new identity's snapshot starts empty at once.
    expect(store.getSnapshot()).toEqual({ identity: "B", counts: null, checkedAt: null });

    reads.get("B")!.resolve(counts(0, 1, 0));
    await b;
    reads.get("A")!.resolve(counts(9, 9, 9));
    await a;
    expect(store.getSnapshot().identity).toBe("B");
    expect(store.getSnapshot().counts).toEqual(counts(0, 1, 0));

    // A failed first read for a new identity shows nothing, never the previous identity's counts.
    next = "C";
    const c = store.refresh("C");
    reads.get("C")!.reject(new Error("合成讀取失敗"));
    await c;
    expect(store.getSnapshot()).toEqual({ identity: "C", counts: null, checkedAt: null });
    expect(warnings).toEqual([["ADMIN_ATTENTION_READ_FAILED", "Error"]]);
  });

  test("identity flapping A → B → A: A's first read answering last never overwrites the newer A counts", async () => {
    let time = 0;
    const { reads, fetcher } = pendingReads();
    const store = createAdminAttentionStore(fetcher, () => time);

    const firstA = store.refresh("A");
    const b = store.refresh("B");
    const secondA = store.refresh("A");
    expect(reads).toHaveLength(3);

    time = 1_000;
    reads[2].resolve(counts(5, 0, 0));
    await secondA;
    const newest = { identity: "A", counts: counts(5, 0, 0), checkedAt: 1_000 };
    expect(store.getSnapshot()).toEqual(newest);

    // The overtaken reads answer late: B's belongs to another identity, A's first is older.
    time = 2_000;
    reads[1].resolve(counts(7, 7, 7));
    reads[0].resolve(counts(1, 1, 1));
    await Promise.all([firstA, b]);
    expect(store.getSnapshot()).toEqual(newest);
    expect(warnings).toEqual([]);
  });

  test("a read pending across reset() publishes nothing", async () => {
    const { reads, fetcher } = pendingReads();
    const store = createAdminAttentionStore(fetcher);

    const abandoned = store.refresh("A");
    store.reset();
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    reads[0].resolve(counts(3, 0, 0));
    await abandoned;
    expect(store.getSnapshot()).toEqual(EMPTY_SNAPSHOT);
    expect(notified).toBe(0);

    // The same identity returning while its abandoned read is still pending gets a read of its
    // own instead of joining one that can no longer publish.
    const abandonedAgain = store.refresh("A");
    store.reset();
    const fresh = store.refresh("A");
    expect(reads).toHaveLength(3);
    reads[1].resolve(counts(8, 0, 0));
    await abandonedAgain;
    expect(store.getSnapshot()).toEqual({ identity: "A", counts: null, checkedAt: null });
    reads[2].resolve(counts(4, 0, 0));
    await fresh;
    expect(store.getSnapshot().counts).toEqual(counts(4, 0, 0));
  });

  test("refreshIfStale reuses counts younger than 60 s", async () => {
    let time = 0;
    let calls = 0;
    const store = createAdminAttentionStore(
      async () => {
        calls += 1;
        return counts(1, 0, 0);
      },
      () => time,
    );

    await store.refreshIfStale("id-1");
    expect(calls).toBe(1);
    time = 59_999;
    await store.refreshIfStale("id-1");
    expect(calls).toBe(1);
    time = 60_000;
    await store.refreshIfStale("id-1");
    expect(calls).toBe(2);
    await store.refreshIfStale("id-2");
    expect(calls).toBe(3);
  });

  test("reset clears the counts at once", async () => {
    const store = createAdminAttentionStore(async () => counts(1, 0, 0));
    await store.refresh("id-1");
    store.reset();
    expect(store.getSnapshot()).toEqual({ identity: null, counts: null, checkedAt: null });
  });
});

describe("useAdminAttention", () => {
  test("renders on the server with no counts and no read", () => {
    function Probe() {
      const attention = useAdminAttention("id-1");
      return createElement("p", null, attention === null ? "none" : "some");
    }
    expect(renderToStaticMarkup(createElement(Probe))).toBe("<p>none</p>");
  });
});
