import assert from "node:assert/strict";
import test from "node:test";
import { withOwnedPostgres } from "./owned-postgres-test.mjs";
import {
  isOwnedPostgresImage,
  PINNED_POSTGRES_17,
  PINNED_POSTGRES_18,
} from "../../src/lib/neon/owned-postgres-images.ts";

const pins = [PINNED_POSTGRES_17, PINNED_POSTGRES_18];
const rejected = [
  "pgvector/pgvector:pg18",
  "pgvector/pgvector:latest",
  "postgres:18",
  PINNED_POSTGRES_18.replace("pgvector/pgvector", "foreign/image"),
  "pgvector/pgvector@sha256:" + "a".repeat(64),
  PINNED_POSTGRES_18 + " ",
  "",
  null,
  {},
];

function fixture({ inspectImage, inspectName, id = "a".repeat(64), host = "127.0.0.1" } = {}) {
  const calls = [];
  let name,
    image,
    inspections = 0;
  const pool = {
    async query() {
      return { rows: [] };
    },
    async end() {
      calls.push(["end"]);
    },
  };
  return {
    calls,
    migrationVersions: [],
    createPool(config) {
      assert.equal(config.host, "127.0.0.1");
      assert.equal(config.database, "postgres");
      assert.equal(config.user, "postgres");
      assert.equal(config.port, 54329);
      calls.push(["pool"]);
      return pool;
    },
    docker(...args) {
      calls.push(args);
      if (args[0] === "run") {
        name = args[args.indexOf("--name") + 1];
        image = args.at(-1);
        return id;
      }
      if (args[0] === "inspect") {
        inspections++;
        return JSON.stringify([
          {
            Name: inspectName ?? "/" + name,
            Config: { Image: inspectImage?.(image, inspections) ?? image },
            NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: host, HostPort: "54329" }] } },
          },
        ]);
      }
      assert.equal(args[0], "stop");
      assert.equal(args[1], id);
      return "";
    },
  };
}

test("allowlist contains exactly the unchanged PG17 and explicit PG18 digests", () => {
  assert.equal(
    PINNED_POSTGRES_17,
    "pgvector/pgvector@sha256:d2ef61f42ef767baa5a1475393303cc235bcd92febd9d7014eddb48b41f3bad0",
  );
  assert.equal(
    PINNED_POSTGRES_18,
    "pgvector/pgvector@sha256:2547711f871f5d4c02b2dfc7ff86f3eddc438d00a23854cd449513f4ef1af79b",
  );
  for (const pin of pins) assert.equal(isOwnedPostgresImage(pin), true);
  for (const value of [...rejected, undefined]) assert.equal(isOwnedPostgresImage(value), false);
});

for (const image of [undefined, ...pins]) {
  test(`owned creation and cleanup accept ${image ?? "default PG17"}`, async () => {
    const f = fixture();
    let ran = false;
    await withOwnedPostgres(
      async ({ containerId }) => {
        ran = true;
        assert.equal(containerId, "a".repeat(64));
      },
      { ...f, image },
    );
    assert.equal(ran, true);
    const run = f.calls[0];
    assert.equal(run.at(-1), image ?? PINNED_POSTGRES_17);
    assert.equal(run[run.indexOf("--pull") + 1], "never");
    assert.equal(run[run.indexOf("--publish") + 1], "127.0.0.1::5432");
    assert.deepEqual(
      f.calls.map(([cmd]) => cmd),
      ["run", "inspect", "pool", "end", "inspect", "stop"],
    );
  });
}

test("bad tags, foreign images and invalid option values fail before any Docker or pool call", async () => {
  for (const image of rejected) {
    const f = fixture();
    await assert.rejects(
      withOwnedPostgres(() => assert.fail("must not run"), { ...f, image }),
      /OWNED_POSTGRES_IMAGE_NOT_ALLOWED/,
    );
    assert.deepEqual(f.calls, []);
  }
});

for (const image of pins) {
  for (const phase of ["creation", "cleanup"]) {
    test(`${phase} requires the selected pin even when another allowed pin is inspected: ${image}`, async () => {
      const other = pins.find((pin) => pin !== image);
      const f = fixture({
        inspectImage: (pin, count) => (phase === "creation" || count > 1 ? other : pin),
      });
      let ran = false;
      await assert.rejects(
        withOwnedPostgres(
          () => {
            ran = true;
          },
          { ...f, image },
        ),
        { code: "ERR_ASSERTION" },
      );
      assert.equal(ran, phase === "cleanup");
      assert.equal(
        f.calls.some(([cmd]) => cmd === "stop"),
        false,
      );
    });
  }
}

test("image environment variables cannot opt a default caller into PG18", async (t) => {
  for (const key of ["PG_IMAGE", "POSTGRES_IMAGE", "OWNED_POSTGRES_IMAGE", "DOCKER_IMAGE"]) {
    const previous = process.env[key];
    process.env[key] = PINNED_POSTGRES_18;
    t.after(() =>
      previous === undefined ? delete process.env[key] : (process.env[key] = previous),
    );
  }
  const f = fixture();
  await withOwnedPostgres(() => {}, f);
  assert.equal(f.calls[0].at(-1), PINNED_POSTGRES_17);
});

test("PG18 preserves full container id, exact name and loopback checks", async () => {
  for (const options of [
    { id: "a".repeat(12) },
    { inspectName: "/foreign" },
    { host: "0.0.0.0" },
  ]) {
    const f = fixture(options);
    await assert.rejects(
      withOwnedPostgres(() => assert.fail("must not run"), { ...f, image: PINNED_POSTGRES_18 }),
      { code: "ERR_ASSERTION" },
    );
    assert.equal(
      f.calls.some(([cmd]) => cmd === "pool"),
      false,
    );
  }
});
