import assert from "node:assert/strict";
import test from "node:test";
import { getEnquiryInfoInstallationEvidence } from "./enquiry-info-installation.server.ts";

const scope = { appId: "owned-app", channelId: "owned-channel" };
const components = {
  receiptAdmissionVersion: 1,
  neutralHoldVersion: 1,
  templateTransportVersion: 1,
};
const buildSha = "a".repeat(40);
const auditId = "11111111-2222-4333-8444-555555555555";

function ports(rows = [{ id: auditId, release_sha: buildSha }]) {
  const calls = [];
  return {
    calls,
    env: { VERCEL_GIT_COMMIT_SHA: buildSha },
    schemaAvailable: async () => true,
    query: async (sql, params) => {
      calls.push({ sql, params });
      assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE)\b/);
      return rows;
    },
  };
}

test("installation evidence binds real release-attestation lookup to the runtime build and current components", async () => {
  const p = ports();
  const evidence = await getEnquiryInfoInstallationEvidence(scope, components, p);
  assert.equal(evidence.purpose, "enq_forward_info");
  assert.equal(evidence.appId, scope.appId);
  assert.equal(evidence.channelId, scope.channelId);
  assert.equal(evidence.runtimeBuildSha, buildSha);
  assert.equal(evidence.verifiedBuildSha, buildSha);
  assert.equal(evidence.releaseAuditId, auditId);
  assert.equal(p.calls.length, 1);
  assert.deepEqual(p.calls[0].params, [buildSha]);
  assert.ok(!p.calls[0].sql.includes(buildSha));
  assert.match(p.calls[0].sql, /a\.action='whatsapp\.enquiry_forwarding\.check_requested'/);
  assert.match(p.calls[0].sql, /a\.actor_id IS NULL/);
  assert.match(p.calls[0].sql, /source'='approved_deployment_verification'/);
  assert.match(p.calls[0].sql, /j\.job_type='woztell\.enquiry\.forward\.readiness'/);
  assert.match(p.calls[0].sql, /j\.payload='\{\}'::jsonb/);
});

test("missing build, runtime component or provider scope cannot manufacture installation evidence", async () => {
  for (const changedComponents of [
    { ...components, receiptAdmissionVersion: 0 },
    { ...components, neutralHoldVersion: 0 },
    { ...components, templateTransportVersion: 0 },
  ]) {
    const p = ports();
    assert.equal(await getEnquiryInfoInstallationEvidence(scope, changedComponents, p), null);
    assert.equal(p.calls.length, 0);
  }
  for (const badBuild of [undefined, "not-a-build"]) {
    const p = ports();
    p.env = { VERCEL_GIT_COMMIT_SHA: badBuild };
    assert.equal(await getEnquiryInfoInstallationEvidence(scope, components, p), null);
    assert.equal(p.calls.length, 0);
  }
  const p = ports();
  assert.equal(
    await getEnquiryInfoInstallationEvidence({ ...scope, appId: "invalid scope" }, components, p),
    null,
  );
  assert.equal(p.calls.length, 0);
});

test("schema absence, missing release attestation and a mismatched release fail closed", async () => {
  const noSchema = ports();
  noSchema.schemaAvailable = async () => false;
  assert.equal(await getEnquiryInfoInstallationEvidence(scope, components, noSchema), null);
  assert.equal(noSchema.calls.length, 0);
  for (const rows of [
    [],
    [{ id: auditId, release_sha: "b".repeat(40) }],
    [{ id: "invalid", release_sha: buildSha }],
  ])
    assert.equal(await getEnquiryInfoInstallationEvidence(scope, components, ports(rows)), null);
});

test("database errors propagate rather than being reported as a missing installation", async () => {
  const p = ports();
  p.schemaAvailable = async () => {
    throw Error("OWNED_SCHEMA_QUERY_FAILED");
  };
  await assert.rejects(
    getEnquiryInfoInstallationEvidence(scope, components, p),
    /OWNED_SCHEMA_QUERY_FAILED/,
  );
});
