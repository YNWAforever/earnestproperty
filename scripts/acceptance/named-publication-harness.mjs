import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PINNED_IMAGE,
  dockerCommand,
  inContext,
  validateOwnership,
  verifyContainerAdmission,
  verifyPlatform,
} from "./named-publication-cleanup.mjs";
import { installNetworkFence, sanitizeEnvironment } from "./named-publication-isolation.mjs";

export const repoRoot = new URL("../../", import.meta.url);

export function atomicSave(directory, name, value) {
  assert.match(name, /^[a-z0-9][a-z0-9.-]*\.json$/);
  const target = path.join(directory, name);
  const temporary = target + "." + randomUUID() + ".tmp";
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  renameSync(temporary, target);
}

export function readRecord(directory, name) {
  const file = path.join(directory, name);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function validateHelperRun(args) {
  const name = args[6];
  assert.match(name, /^earnest-remediation-qa-[a-f0-9-]{36}$/);
  assert.deepEqual(
    args,
    [
      "run",
      "--rm",
      "--pull",
      "never",
      "--detach",
      "--name",
      name,
      "--env",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "--publish",
      "127.0.0.1::5432",
      PINNED_IMAGE,
    ],
    "UNEXPECTED_OWNED_HELPER_LAUNCH_CONTRACT",
  );
  return name;
}

const identitySql = `SELECT current_database() AS database,current_user AS role,
  current_setting('cluster_name') AS cluster_name,current_setting('data_directory') AS data_directory,
  current_setting('server_version_num')::int AS version,inet_server_port() AS server_port,
  pg_postmaster_start_time() AS started_at,
  (SELECT system_identifier::text FROM pg_control_system()) AS system_identifier`;

export function verifyServerIdentity(server, runId, controlData) {
  assert.equal(server.database, "postgres");
  assert.equal(server.role, "postgres");
  assert.equal(server.cluster_name, runId);
  assert.match(runId, /^named-publication-[a-f0-9-]{36}$/);
  assert.equal(server.data_directory, "/var/lib/postgresql/data");
  assert.equal(server.server_port, 5432);
  assert.ok(server.version >= 170000 && server.version < 180000);
  assert.match(server.system_identifier, /^[0-9]+$/);
  const identifiers = [...controlData.matchAll(/^Database system identifier:\s*([0-9]+)\s*$/gm)];
  assert.equal(identifiers.length, 1, "EXACT_CONTROL_DATA_SYSTEM_IDENTIFIER_REQUIRED");
  assert.equal(identifiers[0][1], server.system_identifier, "SERVER_FILESYSTEM_IDENTITY_MISMATCH");
}

/** No query/connect reaches migrations or fixtures before actual server identity. */
export function guardOwnedPool(
  pool,
  { runId, controlData, onVerified = () => {}, onFailure = () => {} },
) {
  const query = pool.query.bind(pool);
  const connect = pool.connect.bind(pool);
  let verified = false;
  let verifying;
  const gate = async () => {
    if (verified) return;
    // Failed readiness probes may be retried by withOwnedPostgres; identity must
    // pass on a real SQL connection before the first caller query is delegated.
    if (!verifying)
      verifying = (async () => {
        const server = (await query(identitySql)).rows[0];
        try {
          verifyServerIdentity(server, runId, controlData());
        } catch (error) {
          onFailure(error);
          throw error;
        }
        await onVerified(server);
        verified = true;
      })().finally(() => {
        verifying = undefined;
      });
    return verifying;
  };
  const guardedQuery = async (...args) => {
    await gate();
    try {
      return await query(...args);
    } catch (error) {
      if (args[0] !== "SELECT 1") onFailure(error);
      throw error;
    }
  };
  const guardedConnect = async (...args) => {
    await gate();
    let client;
    try {
      client = await connect(...args);
    } catch (error) {
      onFailure(error);
      throw error;
    }
    return new Proxy(client, {
      get(target, key) {
        if (key === "query")
          return async (...queryArgs) => {
            try {
              return await target.query(...queryArgs);
            } catch (error) {
              onFailure(error);
              throw error;
            }
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  // Do not replace methods on the real pool: pg.Pool.query calls this.connect.
  return new Proxy(pool, {
    get(target, key) {
      if (key === "query") return guardedQuery;
      if (key === "connect") return guardedConnect;
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function waitForContainer(directory) {
  const deadline = Date.now() + 90000;
  const wait = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    const response = readRecord(directory, "container.json");
    if (response) {
      if (response.error)
        throw Object.assign(new Error(response.error.message), {
          code: response.error.code,
        });
      assert.match(response.id, /^[a-f0-9]{64}$/);
      return response.id;
    }
    if (Date.now() >= deadline) throw Error("PARENT_CONTAINER_ACK_TIMEOUT");
    Atomics.wait(wait, 0, 0, 25);
  }
}

export async function withNamedPublicationDatabase(test, { directory, launch, fence }) {
  const save = (name, value) => atomicSave(directory, name, value);
  const docker = inContext(dockerCommand(sanitizeEnvironment()), launch.context);
  verifyPlatform(launch, docker);
  let expected,
    target,
    primaryError,
    fixturesStarted = false;
  const remember = (error) => {
    primaryError ??= error;
  };
  const inspect = (identifier) => {
    verifyPlatform(launch, docker);
    return JSON.parse(docker("inspect", identifier))[0];
  };
  const helperDocker = (...args) => {
    if (args[0] === "run") {
      try {
        const name = validateHelperRun(args);
        assert.equal(expected, undefined, "ONLY_ONE_CONTAINER_REQUEST");
        expected = validateOwnership({ ...launch, name, id: null });
        // The parent alone runs Docker creation. It survives worker termination
        // during the run/ID-ack window and performs exactly one cleanup attempt.
        save("ownership.json", expected);
        expected = { ...expected, id: waitForContainer(directory) };
        target = verifyContainerAdmission(inspect(expected.id), expected);
        save("container-before-client.json", target);
        return expected.id;
      } catch (error) {
        remember(error);
        throw error;
      }
    }
    if (args[0] === "inspect") {
      try {
        assert.ok(expected && [expected.id, expected.name].includes(args[1]));
        const metadata = inspect(args[1]);
        verifyContainerAdmission(metadata, expected);
        return JSON.stringify([metadata]);
      } catch (error) {
        remember(error);
        throw error;
      }
    }
    if (args[0] === "stop" || args[0] === "rm") {
      assert.ok(expected && args.some((arg) => arg === expected.id || arg === expected.name));
      // withOwnedPostgres still ends its pool; resource cleanup belongs to the
      // parent so a finally error or timeout cannot cause a second rm attempt.
      return expected.id ?? expected.name;
    }
    throw Error("UNSUPPORTED_OWNED_HELPER_DOCKER_OPERATION");
  };
  // These imports must stay dynamic: the shared helper imports pg at top level.
  const { withOwnedPostgres } = await import("./owned-postgres-test.mjs");
  const { default: pg } = await import("pg");
  try {
    await withOwnedPostgres(
      async (ports) => {
        try {
          fixturesStarted = true;
          const { MIGRATION_VERSIONS } =
            await import("../../src/lib/control-plane/migration-versions.js");
          const applied = (
            await ports.query("SELECT version FROM app_migrations ORDER BY version")
          ).map((row) => row.version);
          assert.deepEqual(
            applied,
            [...MIGRATION_VERSIONS].sort(),
            "ALL_CURRENT_MIGRATIONS_REQUIRED",
          );
          save("migrations.json", { versions: applied, count: applied.length });
          await test({ ...ports, target, save });
        } catch (error) {
          remember(error);
          throw error;
        }
      },
      {
        docker: helperDocker,
        createPool(config) {
          try {
            target = verifyContainerAdmission(inspect(expected.id), expected);
            assert.equal(config.host, "127.0.0.1");
            assert.equal(Number(config.port), target.port);
            assert.equal(config.user, "postgres");
            assert.equal(config.database, "postgres");
            assert.equal(config.connectionString, undefined);
            fence.allowPort(target.port);
            const pool = new pg.Pool({
              ...config,
              max: 5,
              application_name: launch.runId,
            });
            return guardOwnedPool(pool, {
              runId: launch.runId,
              controlData: () => {
                verifyContainerAdmission(inspect(expected.id), expected);
                return docker("exec", expected.id, "pg_controldata", "/var/lib/postgresql/data");
              },
              // Expected synthetic constraint/timeout errors inside a regression
              // are handled by that regression. Preserve only escaping callback
              // errors and migration errors when a helper finally also fails.
              onFailure: (error) => {
                if (!fixturesStarted) remember(error);
              },
              async onVerified(server) {
                save("server-identity-before-migrations.json", {
                  ...server,
                  containerId: expected.id,
                  filesystemSystemIdentifierMatched: true,
                });
                if (launch.timeoutProof) {
                  save("ready.json", {
                    id: expected.id,
                    runId: launch.runId,
                    serverVerified: true,
                  });
                  // Keep the worker alive until the parent's post-readiness kill.
                  await new Promise(() => {
                    setInterval(() => {}, 1000);
                  });
                }
              },
            });
          } catch (error) {
            remember(error);
            throw error;
          }
        },
      },
    );
  } catch (error) {
    if (primaryError && primaryError !== error) {
      primaryError.cleanupError = error;
      throw primaryError;
    }
    throw error;
  }
}

export async function runWorker() {
  assert.equal(process.argv.length, 2, "UNSUPPORTED_WORKER_OPTION");
  const directory = process.env.NAMED_PUBLICATION_LAUNCH_DIR;
  assert.ok(directory && path.isAbsolute(directory), "PARENT_LAUNCH_REQUIRED");
  assert.ok(!lstatSync(directory).isSymbolicLink());
  const canonical = realpathSync(directory);
  assert.equal(path.dirname(canonical), realpathSync(tmpdir()), "OWNED_OS_TEMP_DIRECTORY_REQUIRED");
  assert.ok(path.basename(canonical).startsWith("named-publication-"));
  sanitizeEnvironment();
  const fence = installNetworkFence();
  const launch = readRecord(canonical, "launch.json");
  assert.ok(launch, "PARENT_LAUNCH_REQUIRED");
  try {
    await withNamedPublicationDatabase(
      async (ports) => {
        const { runNamedPublicationRegression } =
          await import("../../src/lib/mls/named-publication.owned.mjs");
        await runNamedPublicationRegression(ports);
      },
      { directory: canonical, launch, fence },
    );
  } catch (error) {
    atomicSave(canonical, "worker-error.json", {
      message: error.message,
      code: error.code ?? null,
      cause: error.cause?.message ?? null,
      cleanupError: error.cleanupError?.message ?? null,
    });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWorker().catch((error) => {
    console.error(
      JSON.stringify({
        status: "FAIL_ISOLATED",
        message: error.message,
        code: error.code ?? null,
      }),
    );
    process.exitCode = 1;
  });
}
