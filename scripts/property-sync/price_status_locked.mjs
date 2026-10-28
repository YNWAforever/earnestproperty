import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { diffPriceStatus, parseArgs, saveReport, validate28Capture } from "./price_status_diff.mjs";

export { validate28Capture } from "./price_status_diff.mjs";

// Same lock key as all MLS writers. Waiting SELECT inside a READ ONLY transaction;
// no migration, importer, writer or DML is reachable here. Never invoked by tests on Neon.
export async function lockedReport(client, capture, work) {
  validate28Capture(capture);
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '10min'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('earnestproperty:mls-sync'))");
    const sql = await readFile(new URL("./price_status_export.sql", import.meta.url), "utf8");
    const { rows } = await client.query(sql, ["28hse_agent_540"]);
    const report = diffPriceStatus(capture, {
      exported_at: new Date().toISOString(),
      properties: rows,
    });
    await work(report);
    return report;
  } finally {
    try {
      await client.query("ROLLBACK");
    } finally {
      await client.end();
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2), ["capture", "out"]);
    if (!process.env.PRICE_STATUS_SYNC_READONLY_DATABASE_URL)
      throw Error("readonly_connection_required");
    const { Client } = await import("@neondatabase/serverless");
    const client = new Client({
      connectionString: process.env.PRICE_STATUS_SYNC_READONLY_DATABASE_URL,
      connectionTimeoutMillis: 15000,
      query_timeout: 660000,
    });
    client.neonConfig.webSocketConstructor = globalThis.WebSocket;
    await lockedReport(client, JSON.parse(await readFile(args.capture, "utf8")), (report) =>
      saveReport(report, args.out),
    );
  } catch {
    console.error("price_status_locked_report_failed");
    process.exitCode = 2;
  }
}
