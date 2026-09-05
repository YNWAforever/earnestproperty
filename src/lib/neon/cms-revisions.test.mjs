import assert from "node:assert/strict";
import test from "node:test";

import { canPublishCmsRevision, makeRestoreDraft, nextCmsVersion } from "./cms-revisions.ts";

test("only admin and manager can publish or restore CMS revisions", () => {
  assert.equal(canPublishCmsRevision(["admin"]), true);
  assert.equal(canPublishCmsRevision(["manager"]), true);
  assert.equal(canPublishCmsRevision(["agent"]), false);
});

test("nextCmsVersion increments from the latest revision", () => {
  assert.equal(nextCmsVersion([]), 1);
  assert.equal(nextCmsVersion([{ version_number: 7 }]), 8);
});

test("restore creates a new draft without rewriting the source revision", () => {
  const revision = {
    id: "old",
    resource_type: "estate",
    resource_id: "estate-1",
    version_number: 4,
    payload: {
      name_zh: "Lido Garden",
      meta: { slug: "lido-garden" },
    },
  };
  const restored = makeRestoreDraft(revision, 9);

  assert.deepEqual(restored, {
    resourceType: "estate",
    resourceId: "estate-1",
    basePublishedVersion: 9,
    payload: {
      name_zh: "Lido Garden",
      meta: { slug: "lido-garden" },
    },
    restoredFromRevisionId: "old",
  });

  restored.payload.meta.slug = "royal-peninsula";
  restored.payload.name_zh = "Royal Peninsula";

  assert.deepEqual(revision.payload, {
    name_zh: "Lido Garden",
    meta: { slug: "lido-garden" },
  });
});
