import assert from "node:assert/strict";
import test from "node:test";

import { environmentChecks } from "./health.server.ts";

// FX-10a (C-07): WhatsApp intake answers 503 without WOZTELL_APP_ID, so health
// must not report woztell as healthy when it is missing.

const WOZTELL_VARS = [
  "WOZTELL_ENABLED",
  "WOZTELL_APP_ID",
  "WOZTELL_CHANNEL_ID",
  "WOZTELL_CHANNEL_SECRET",
  "WOZTELL_BOT_ACCESS_TOKEN",
];
const COMPLETE = {
  WOZTELL_ENABLED: "true",
  WOZTELL_APP_ID: "fixture-app",
  WOZTELL_CHANNEL_ID: "fixture-channel",
  WOZTELL_CHANNEL_SECRET: "fixture-secret",
  WOZTELL_BOT_ACCESS_TOKEN: "fixture-token",
};

function woztellWith(env) {
  const old = { ...process.env };
  try {
    for (const name of WOZTELL_VARS) delete process.env[name];
    Object.assign(process.env, env);
    return environmentChecks().find((check) => check.key === "woztell");
  } finally {
    process.env = old;
  }
}

test("woztell health fails when enabled without WOZTELL_APP_ID", () => {
  const { WOZTELL_APP_ID: _omit, ...rest } = COMPLETE;
  const row = woztellWith(rest);
  assert.equal(row.status, "failed");
  assert.equal(row.details.appId, false);
});

test("woztell health is healthy only with app id, channel id, secret and token", () => {
  const row = woztellWith(COMPLETE);
  assert.equal(row.status, "healthy");
  assert.equal(row.details.appId, true);
  for (const name of WOZTELL_VARS.filter((n) => n !== "WOZTELL_ENABLED")) {
    const env = { ...COMPLETE };
    delete env[name];
    assert.equal(woztellWith(env).status, "failed", `${name} missing`);
  }
});

test("disabled woztell stays degraded", () => {
  assert.equal(woztellWith({}).status, "degraded");
  const { WOZTELL_ENABLED: _omit, ...rest } = COMPLETE;
  assert.equal(woztellWith(rest).status, "degraded");
});
