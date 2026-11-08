import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveCompanyChannel } from "./company-channel.mjs";

test("--channel wins over every env name", () => {
  const resolved = resolveCompanyChannel({
    argv: ["--apply", "--channel", "flag-channel"],
    env: { EP_WA_COMPANY_CHANNEL_ID: "env-channel", WOZTELL_CHANNEL_ID: "woztell-channel" },
  });
  assert.deepEqual(resolved, { channelId: "flag-channel", source: "--channel" });
});

test("--channel without a value fails instead of silently falling back", () => {
  assert.throws(
    () => resolveCompanyChannel({ argv: ["--channel"] }),
    /WA_CHANNEL_FLAG_VALUE_REQUIRED/,
  );
  assert.throws(
    () => resolveCompanyChannel({ argv: ["--channel", "--apply"] }),
    /WA_CHANNEL_FLAG_VALUE_REQUIRED/,
  );
});

test("EP_WA_COMPANY_CHANNEL_ID is the production name", () => {
  const resolved = resolveCompanyChannel({
    env: { EP_WA_COMPANY_CHANNEL_ID: "env-channel", EP_WA_ENQUIRY_MODE: "active" },
  });
  assert.deepEqual(resolved, { channelId: "env-channel", source: "EP_WA_COMPANY_CHANNEL_ID" });
});

test("EP_WA_COMPANY_CHANNEL_ID wins over WOZTELL_CHANNEL_ID, exactly like the site", () => {
  const resolved = resolveCompanyChannel({
    env: {
      EP_WA_COMPANY_CHANNEL_ID: "env-channel",
      WOZTELL_CHANNEL_ID: "woztell-channel",
      EP_WA_ENQUIRY_MODE: "active",
    },
  });
  assert.equal(resolved.channelId, "env-channel");
});

test("WOZTELL_CHANNEL_ID only applies in observe/active mode", () => {
  assert.deepEqual(
    resolveCompanyChannel({
      env: { WOZTELL_CHANNEL_ID: "woztell", EP_WA_ENQUIRY_MODE: "observe" },
    }),
    { channelId: "woztell", source: "WOZTELL_CHANNEL_ID" },
  );
  assert.deepEqual(
    resolveCompanyChannel({ env: { WOZTELL_CHANNEL_ID: "woztell", EP_WA_ENQUIRY_MODE: "active" } }),
    { channelId: "woztell", source: "WOZTELL_CHANNEL_ID" },
  );
  assert.throws(
    () => resolveCompanyChannel({ env: { WOZTELL_CHANNEL_ID: "woztell" } }),
    /WA_COMPANY_CHANNEL_REQUIRED/,
  );
  assert.throws(
    () =>
      resolveCompanyChannel({ env: { WOZTELL_CHANNEL_ID: "woztell", EP_WA_ENQUIRY_MODE: "off" } }),
    /WA_COMPANY_CHANNEL_REQUIRED/,
  );
});

test("nothing configured fails loudly rather than minting links for a guessed channel", () => {
  assert.throws(() => resolveCompanyChannel({}), /WA_COMPANY_CHANNEL_REQUIRED/);
  assert.throws(
    () => resolveCompanyChannel({ env: { EP_WA_COMPANY_CHANNEL_ID: "" } }),
    /WA_COMPANY_CHANNEL_REQUIRED/,
  );
});
