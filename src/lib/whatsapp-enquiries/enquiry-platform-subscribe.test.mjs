import assert from "node:assert/strict";
import test from "node:test";
import {
  PLATFORM_SUBSCRIBE_JOB_TYPE,
  channelEtag,
  channelState,
  platformSubscribeEnabled,
  platformSubscribePayload,
  subscribeInput,
  subscribeOutcome,
} from "./enquiry-platform-subscribe.js";

const channel = (patch = {}) => ({
  _id: "channel-one",
  etag: "etag-123",
  connected: true,
  archived: null,
  environments: [
    {
      envId: "env-secret",
      on: true,
      integrationInstalled: null,
      integration: { _id: "ai-secret", integrationId: "whatsapp-cloud" },
      info: { subscribed: false, appIntegrationId: "ai-secret" },
    },
  ],
  ...patch,
});
const body = (patch = {}) => ({ data: { apiViewer: { channel: channel(patch) } } });

test("the mutation input forwards a valid etag and omits an absent one", () => {
  assert.deepEqual(subscribeInput("channel-one", "etag-123"), {
    channelId: "channel-one",
    etag: "etag-123",
  });
  assert.deepEqual(subscribeInput("channel-one", null), { channelId: "channel-one" });
  assert.deepEqual(subscribeInput("channel-one", "not valid"), { channelId: "channel-one" });
  assert.deepEqual(subscribeInput("channel-one", undefined), { channelId: "channel-one" });
  assert.throws(() => subscribeInput("bad channel", "etag-123"), /Invalid subscribe channel/);
  for (const bad of [null, undefined, "", "a.b", 42])
    assert.throws(() => subscribeInput(bad, null), /Invalid subscribe channel/);
});

test("job type and payload are fixed to an empty server-owned shape", () => {
  assert.equal(PLATFORM_SUBSCRIBE_JOB_TYPE, "woztell.enquiry.platform.subscribe");
  assert.deepEqual(platformSubscribePayload({}), {});
  for (const bad of [null, undefined, [], "x", { channelId: "c" }, { etag: "e" }])
    assert.throws(() => platformSubscribePayload(bad), /Invalid platform subscribe job/);
});

test("enablement requires the exact server-only true value", () => {
  assert.equal(platformSubscribeEnabled({ EP_WA_PLATFORM_SUBSCRIBE_ENABLED: "true" }), true);
  for (const value of [undefined, "", "1", "TRUE", "yes", " true"])
    assert.equal(platformSubscribeEnabled({ EP_WA_PLATFORM_SUBSCRIBE_ENABLED: value }), false);
});

test("channel state is bounded and never exposes identifiers or values", () => {
  const state = channelState(body());
  assert.deepEqual(state, {
    observed: true,
    etagPresent: true,
    connected: true,
    archived: null,
    cloudEnvironmentCount: 1,
    subscribed: false,
    enabled: true,
    installed: null,
  });
  assert.equal(JSON.stringify(state).includes("etag-123"), false);
  assert.equal(JSON.stringify(state).includes("ai-secret"), false);
  assert.equal(JSON.stringify(state).includes("env-secret"), false);
  assert.equal(channelEtag(body()), "etag-123");
  assert.equal(channelEtag(body({ etag: "not a valid etag" })), null);
});

test("unknown channel shapes degrade to unknown instead of guessing", () => {
  assert.deepEqual(channelState(null), {
    observed: false,
    etagPresent: false,
    connected: null,
    archived: null,
    cloudEnvironmentCount: 0,
    subscribed: null,
    enabled: null,
    installed: null,
  });
  const twoCloud = channelState(
    body({
      environments: [
        { envId: "a", on: true, integration: { integrationId: "whatsapp-cloud" } },
        { envId: "b", on: true, integration: { integrationId: "whatsapp-cloud" } },
      ],
    }),
  );
  assert.equal(twoCloud.cloudEnvironmentCount, 0);
  assert.equal(twoCloud.subscribed, null);
  assert.equal(channelState(body({ environments: "not-an-array" })).cloudEnvironmentCount, 0);
});

test("mutation outcome distinguishes acceptance from refusal without free text", () => {
  const accepted = subscribeOutcome({ data: { subscribeChannel: { channel: channel() } } });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.responded, true);
  assert.equal(accepted.hasErrors, false);
  const refused = subscribeOutcome({
    data: {
      subscribeChannel: {
        clientMutationId: null,
        error: { code: "PERMISSION_DENIED", message: "private provider text", name: "Error" },
        channel: null,
      },
    },
  });
  assert.equal(refused.accepted, false);
  assert.deepEqual(refused.errorCodes, ["PERMISSION_DENIED"]);
  assert.equal(JSON.stringify(refused).includes("private provider text"), false);
  const graph = subscribeOutcome({
    errors: [{ message: "private graph error", extensions: { code: "UNAUTHENTICATED" } }],
  });
  assert.equal(graph.accepted, false);
  assert.equal(graph.hasErrors, true);
  assert.deepEqual(graph.errorCodes, ["UNAUTHENTICATED"]);
  assert.equal(JSON.stringify(graph).includes("private graph error"), false);
  assert.equal(subscribeOutcome(null).accepted, false);
  assert.equal(
    subscribeOutcome({ errors: [{ extensions: { code: "not a code!" } }] }).errorCodes.length,
    0,
  );
});
