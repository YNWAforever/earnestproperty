/** Production writes are reachable only through authenticated, one-shot session construction. */
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { checkServerIdentity, TLSSocket } from "node:tls";
import type { PeerCertificate } from "node:tls";
import { readReleaseInputs } from "../../src/lib/neon/blog-release-packet";
import type { ReleaseInputs } from "../../src/lib/neon/blog-release-packet";
import type {
  BlogSnapshotIdentity,
  BlogSqlSession,
} from "../../src/lib/neon/blog-import-transaction";
import { runBlogRelease } from "../../src/lib/neon/blog-release-transaction";
import {
  loadCurrentFence,
  loadProductionAuthority,
  loadProductionCredential,
} from "./production-authority";
import { authenticateProductionRequest, parseProductionRequest } from "./production-evidence";
import { PRODUCTION_IDENTITY } from "./production-target";

type Client = BlogSqlSession & {
  connect(): Promise<void>;
  end(): Promise<void>;
  on(event: "error", listener: () => void): void;
  connection: { stream: unknown };
};
type Proof = ReturnType<typeof authenticateProductionRequest>;
type Capability = Readonly<{ identity: string }>;
const capabilities = new WeakMap<
  Capability,
  {
    client: Client;
    identity: BlogSnapshotIdentity;
    proof: Proof;
    inputs: ReleaseInputs;
    backendPid: number;
  }
>();

function assertCleanProcess() {
  if (
    Object.entries(process.env).some(
      ([key, value]) =>
        value &&
        /^(?:PG[A-Z0-9_]*|(?:DATABASE_URL(?:_UNPOOLED)?|(?:TEST|CMS_TEST|ASTRA_TEST)_DATABASE_URL)|NODE_(?:OPTIONS|TLS_REJECT_UNAUTHORIZED|EXTRA_CA_CERTS))$/i.test(
          key,
        ),
    )
  )
    throw new Error("PRODUCTION_REFUSES_CONNECTION_ENV");
  if (
    process.execArgv.some((arg) => /^--env-file(?:-if-exists)?(?:=|$)/.test(arg)) ||
    readdirSync(new URL("../../", import.meta.url)).some(
      (name) => /^\.env(?:\.|$)/i.test(name) && name !== ".env.example",
    )
  )
    throw new Error("PRODUCTION_REFUSES_DOTENV");
}

function tlsError(host: string, certificate: PeerCertificate, proof: Proof) {
  if (
    host !== proof.target.host ||
    !Buffer.isBuffer(certificate?.raw) ||
    checkServerIdentity(host, certificate) ||
    createHash("sha256").update(certificate.raw).digest("hex") !== proof.certificateSha256
  )
    return new Error("PRODUCTION_TLS");
  return undefined;
}

function assertTransport(client: Client, proof: Proof) {
  const stream = client.connection.stream;
  if (
    !(stream instanceof TLSSocket) ||
    !stream.encrypted ||
    !stream.authorized ||
    tlsError(proof.target.host, stream.getPeerCertificate() as PeerCertificate, proof)
  )
    throw new Error("PRODUCTION_TLS");
}

async function checkSession(client: Client, proof: Proof, pinnedPid?: number) {
  assertTransport(client, proof);
  let row;
  try {
    const result = await client.query(`SELECT pg_catalog.current_database() AS database,
      current_user AS "currentRole", session_user AS "sessionRole",
      system_identifier::text AS "systemIdentifier",
      pg_catalog.current_setting('server_version_num')::int AS "serverVersion",
      pg_catalog.pg_backend_pid() AS "backendPid",
      (SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid = pg_catalog.pg_backend_pid()) AS tls,
      pg_catalog.pg_is_in_recovery() AS "inRecovery"
      FROM pg_catalog.pg_control_system()`);
    if (result.rows.length !== 1) throw new Error();
    row = result.rows[0];
  } catch {
    throw new Error("RELEASE_SESSION");
  }
  const { target } = proof;
  const backendPid = row.backendPid;
  if (
    row.database !== target.database ||
    row.currentRole !== target.role ||
    row.sessionRole !== target.role ||
    row.systemIdentifier !== target.systemIdentifier ||
    row.serverVersion !== target.serverVersion ||
    row.tls !== true ||
    row.inRecovery !== false ||
    typeof backendPid !== "number" ||
    !Number.isInteger(backendPid) ||
    backendPid <= 0 ||
    (pinnedPid !== undefined && backendPid !== pinnedPid)
  )
    throw new Error("RELEASE_SESSION");
  return backendPid;
}

async function close(client: Client) {
  // The transaction result (or ambiguous COMMIT) takes priority over teardown errors.
  try {
    await client.end();
  } catch {
    /* closed/discarded, never returned to a pool */
  }
}

async function construct(untrusted: unknown): Promise<Capability> {
  assertCleanProcess();
  const request = parseProductionRequest(untrusted);
  const proof = authenticateProductionRequest(request, loadProductionAuthority());
  const identity = Object.freeze({
    identity: PRODUCTION_IDENTITY,
    systemIdentifier: proof.target.systemIdentifier,
  });
  proof.assertFresh(Date.now(), 95_000);
  const inputs = readReleaseInputs(
    identity,
    request.packetBytes,
    proof.packetSha256,
    request.sourceBytes,
  );
  proof.assertCurrentFence(loadCurrentFence());
  proof.assertFresh(Date.now(), 95_000);
  const password = loadProductionCredential(proof.target);
  const pg = createRequire(import.meta.url)("pg") as { Client: new (config: object) => Client };
  const client = new pg.Client({
    host: proof.target.host,
    port: proof.target.port,
    database: proof.target.database,
    user: proof.target.role,
    password,
    application_name: "earnest-blog-release",
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
    query_timeout: 35000,
    ssl: {
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      servername: proof.target.host,
      checkServerIdentity: (host: string, certificate: PeerCertificate) =>
        tlsError(host, certificate, proof),
    },
  });
  client.on("error", () => {
    /* Query/session checks surface a disconnected client. */
  });
  try {
    try {
      await client.connect();
    } catch (error) {
      throw new Error(
        error instanceof Error && error.message === "PRODUCTION_TLS"
          ? "PRODUCTION_TLS"
          : "PRODUCTION_CONNECT",
      );
    }
    const backendPid = await checkSession(client, proof);
    const capability = Object.freeze({ identity: PRODUCTION_IDENTITY });
    capabilities.set(capability, { client, identity, proof, inputs, backendPid });
    return capability;
  } catch (error) {
    await close(client);
    throw error;
  }
}

async function consume(capability: Capability) {
  const state = capabilities.get(capability);
  if (!state) throw new Error("PRODUCTION_CAPABILITY");
  capabilities.delete(capability);
  const { client, identity, proof, inputs, backendPid } = state;
  let began = false;
  let committing = false;
  try {
    proof.assertFresh(Date.now(), 90_000);
    await client.query("BEGIN");
    began = true;
    await client.query(`SET LOCAL search_path TO public, pg_temp;
      SET LOCAL TIME ZONE 'UTC';
      SET LOCAL DateStyle TO 'ISO, YMD';
      SET LOCAL row_security TO off;
      SET LOCAL lock_timeout TO '2s';
      SET LOCAL statement_timeout TO '30s';
      SET LOCAL idle_in_transaction_session_timeout TO '10s';
      SET LOCAL transaction_timeout TO '90s'`);
    await checkSession(client, proof, backendPid);
    proof.assertCurrentFence(loadCurrentFence());
    proof.assertFresh(Date.now());
    const result = await runBlogRelease(client, identity, inputs);
    await checkSession(client, proof, backendPid);
    proof.assertCurrentFence(loadCurrentFence());
    proof.assertFresh(Date.now());
    committing = true;
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (committing) throw new Error("PRODUCTION_COMMIT_UNKNOWN");
    if (began) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* disconnection rolls back server-side */
      }
    }
    if (error instanceof Error && /^(?:PRODUCTION|RELEASE|IMPORT)_[A-Z0-9_]+$/.test(error.message))
      throw error;
    throw new Error("PRODUCTION_TRANSACTION_FAILED");
  } finally {
    await close(client);
  }
}

/** The request is data only. The authority, credentials, clock and SQL driver are operator-owned. */
export async function executeProductionRelease(request: unknown) {
  return consume(await construct(request));
}
