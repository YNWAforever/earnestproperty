import { Client } from "@neondatabase/serverless";

const LOCK_NAME = "earnestproperty:mls-sync";

function createNeonClient(config) {
  return new Client(config);
}

function requireFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} must be a function`);
  }
}

function attachCleanupErrors(primary, cleanupErrors) {
  if (cleanupErrors.length === 0) return primary;
  try {
    Object.defineProperty(primary, "cleanupErrors", {
      configurable: true,
      enumerable: false,
      value: Object.freeze([...cleanupErrors]),
      writable: true,
    });
    return primary;
  } catch {
    return new AggregateError([primary, ...cleanupErrors], primary.message, { cause: primary });
  }
}

function readBooleanResult(result, key, label) {
  if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
    throw new Error(`${label} result must contain exactly one row`);
  }
  const value = result.rows[0]?.[key];
  if (value !== true && value !== false) {
    throw new Error(`${label} result must contain a boolean ${key}`);
  }
  return value;
}

export async function withMlsAdvisoryLock(options = {}) {
  const {
    connectionString,
    WebSocketImpl = globalThis.WebSocket,
    createClient = createNeonClient,
    work,
  } = options;
  if (typeof connectionString !== "string" || !connectionString.trim()) {
    throw new Error("DATABASE_URL_UNPOOLED is required");
  }
  if (typeof WebSocketImpl !== "function") {
    throw new Error("Node 22.15+ global WebSocket support is required");
  }
  requireFunction(createClient, "createClient");
  requireFunction(work, "work");

  const client = createClient(
    {
      connectionString,
      connectionTimeoutMillis: 15_000,
      query_timeout: 30_000,
    },
    Object.freeze({ WebSocketImpl }),
  );
  let connected = false;
  let acquired = false;
  let value;
  let primaryError;
  const cleanupErrors = [];

  try {
    if (
      !client ||
      typeof client.connect !== "function" ||
      typeof client.query !== "function" ||
      typeof client.end !== "function"
    ) {
      throw new TypeError("createClient must return a connect/query/end client");
    }
    if (!client.neonConfig || typeof client.neonConfig !== "object") {
      throw new TypeError("client.neonConfig is required for scoped WebSocket configuration");
    }
    client.neonConfig.webSocketConstructor = WebSocketImpl;
    await client.connect();
    connected = true;
    const lockResult = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS acquired", [
      LOCK_NAME,
    ]);
    acquired = readBooleanResult(lockResult, "acquired", "Advisory lock");
    if (!acquired) value = { kind: "lock_unavailable" };
    else value = await work(client);
  } catch (error) {
    primaryError = error;
  }

  if (connected && acquired) {
    try {
      const unlockResult = await client.query(
        "SELECT pg_advisory_unlock(hashtext($1)) AS released",
        [LOCK_NAME],
      );
      if (!readBooleanResult(unlockResult, "released", "Advisory unlock")) {
        throw new Error("Advisory unlock result reported that the lock was not held");
      }
    } catch (error) {
      if (primaryError) cleanupErrors.push(error);
      else primaryError = error;
    }
  }

  if (client && typeof client.end === "function") {
    try {
      await client.end();
    } catch (error) {
      if (primaryError) cleanupErrors.push(error);
      else primaryError = error;
    }
  }

  if (primaryError) throw attachCleanupErrors(primaryError, cleanupErrors);
  return value;
}
