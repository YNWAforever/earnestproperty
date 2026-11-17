import assert from "node:assert/strict";
import test from "node:test";
import {
  CHANNEL_ARCHIVE_PROOF_LIVE_DELIVERY,
  channelArchiveProof,
  channelArchiveVerified,
} from "./channel-archive-proof.js";

const ref = "audit:00000000-0000-4000-8000-000000000002";

test("strict mode declares no proof", () => {
  assert.equal(channelArchiveProof({}), null);
  assert.equal(channelArchiveProof({ EP_WA_CHANNEL_ARCHIVE_PROOF: "true" }), null);
  assert.equal(channelArchiveProof({ EP_WA_CHANNEL_ARCHIVE_PROOF: liveDelivery() }), null);
});

function liveDelivery() {
  return CHANNEL_ARCHIVE_PROOF_LIVE_DELIVERY;
}

test("live delivery needs a recorded reference", () => {
  assert.equal(
    channelArchiveProof({ EP_WA_CHANNEL_ARCHIVE_PROOF: "live_delivery" }),
    null,
    "a declaration without an audit reference proves nothing",
  );
  const proof = channelArchiveProof({
    EP_WA_CHANNEL_ARCHIVE_PROOF: " LIVE_DELIVERY ",
    EP_WA_CHANNEL_ARCHIVE_PROOF_REF: ` ${ref} `,
  });
  assert.deepEqual(proof, { mode: "live_delivery", reference: ref });
});

test("verification prefers the provider field and falls back to the declared proof", () => {
  assert.equal(channelArchiveVerified({ archived: false }), true);
  assert.equal(channelArchiveVerified({ archived: true, archiveProof: { reference: ref } }), false);
  assert.equal(channelArchiveVerified({ archived: null }), false);
  assert.equal(
    channelArchiveVerified({
      archived: null,
      archiveProof: { mode: "live_delivery", reference: ref },
    }),
    true,
  );
});
