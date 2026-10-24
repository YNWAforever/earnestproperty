import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import dgram from "node:dgram";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";

export function cleanEnvironment(source = process.env) {
  const env = { NO_COLOR: "1" };
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
    "ComSpec",
    "PATHEXT",
    "HOME",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "APPDATA",
    "XDG_RUNTIME_DIR",
    "XDG_CONFIG_HOME",
  ])
    if (source[key] !== undefined) env[key] = source[key];
  return env;
}

export function sanitizeEnvironment() {
  const clean = cleanEnvironment();
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, clean);
  return clean;
}

export function validateSocketTarget(args, allowedPort) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const config = first && typeof first === "object" ? first : { port: first, host: args[1] };
  assert.ok(Number.isInteger(allowedPort) && allowedPort > 0, "NO_SOCKET_BEFORE_METADATA_GATE");
  assert.ok(!config.path, "UNIX_SOCKET_FORBIDDEN");
  assert.equal(config.host, "127.0.0.1", "OWNED_LOOPBACK_REQUIRED");
  assert.equal(Number(config.port), allowedPort, "INSPECTED_PORT_REQUIRED");
}

/** Install only in the dedicated worker, before importing pg or repo code. */
export function installNetworkFence() {
  let allowedPort = null;
  const deny = () => {
    throw Error("NAMED_PUBLICATION_EXTERNAL_NETWORK_FORBIDDEN");
  };
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    validateSocketTarget(args, allowedPort);
    return connect.apply(this, args);
  };
  globalThis.fetch = deny;
  globalThis.WebSocket = class {
    constructor() {
      deny();
    }
  };
  http.get = http.request = https.get = https.request = http2.connect = deny;
  dgram.createSocket = deny;
  for (const key of ["lookup", "resolve", "resolve4", "resolve6", "reverse"]) {
    dns[key] = deny;
    dns.promises[key] = deny;
  }
  syncBuiltinESMExports();
  return {
    allowPort(port) {
      assert.equal(allowedPort, null, "ONLY_ONE_OWNED_PORT_PER_WORKER");
      assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
      allowedPort = port;
    },
  };
}
