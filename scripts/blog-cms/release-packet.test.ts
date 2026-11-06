import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readReleaseInputs, releaseArtifacts } from "../../src/lib/neon/blog-release-packet";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const source = Buffer.from('{"fixture":"source bytes"}');
const artifacts = releaseArtifacts();
const target = { identity: "owned:fixture:postgres", systemIdentifier: "123456789" };
const packet = {
  format: "earnest-blog-release-v1",
  targetIdentity: target.identity,
  systemIdentifier: target.systemIdentifier,
  baselineSha256: "1".repeat(64),
  baselineSchemaSha256: "2".repeat(64),
  migratedSchemaSha256: "3".repeat(64),
  sourceSha256: sha256(source),
  ...artifacts,
};
const encode = (body: object) => Buffer.from(JSON.stringify(body));
const expected = sha256(encode(packet));

test("binds the exact release packet bytes and reviewed artifact list", () => {
  expect(readReleaseInputs(target, encode(packet), expected, source).packet).toEqual(packet);
  const rehashed = encode({ ...packet, baselineSha256: "4".repeat(64) });
  expect(() => readReleaseInputs(target, rehashed, expected, source)).toThrow("RELEASE_PACKET");
});

test("refuses source bytes changed only by whitespace", () => {
  const edited = Buffer.concat([source, Buffer.from(" ")]);
  expect(() => readReleaseInputs(target, encode(packet), expected, edited)).toThrow(
    "RELEASE_SOURCE",
  );
});

for (const [edits, error] of [
  [{ targetIdentity: "other" }, "RELEASE_TARGET"],
  [{ systemIdentifier: "other" }, "RELEASE_TARGET"],
  [{ migrationSha256: [...packet.migrationSha256].reverse() }, "RELEASE_MIGRATIONS"],
  [{ implementationSha256: "0".repeat(64) }, "RELEASE_IMPLEMENTATION"],
] as const) {
  test("rejects inconsistent rehashed " + Object.keys(edits)[0], () => {
    const bytes = encode({ ...packet, ...edits });
    expect(() => readReleaseInputs(target, bytes, sha256(bytes), source)).toThrow(error);
  });
}
