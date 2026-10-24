import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, mkdtempSync, openSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureLocalPlatform,
  cleanupOwnedLaunch,
  containerArguments,
  dockerCommand,
  inContext,
  validateOwnership,
  verifyPlatform,
} from "./named-publication-cleanup.mjs";
import { atomicSave, readRecord, repoRoot } from "./named-publication-harness.mjs";
import { cleanEnvironment } from "./named-publication-isolation.mjs";

export function parseOptions(args) {
  if (args.length === 0) return { timeoutProof: false };
  if (args.length === 1 && args[0] === "--timeout-proof") return { timeoutProof: true };
  throw Error("UNSUPPORTED_LAUNCH_OPTION");
}

const errorRecord = (error) => ({
  message: error.message,
  code: error.code ?? null,
  cause: error.cause?.message ?? null,
  removalError: error.removalError?.message ?? null,
});

/** Dependency seams are for pure unit tests; production supplies only fixed CLI options. */
export function createLaunchController({ launch, docker, read, save, onReady }) {
  let owned = null,
    handled = false,
    ready = false,
    finished = false,
    launchError = null;
  return {
    poll() {
      assert.equal(finished, false);
      if (!handled) {
        const request = read("ownership.json");
        if (request) {
          validateOwnership(request);
          for (const key of ["context", "endpoint", "daemon", "image", "imageId", "runId"])
            assert.equal(request[key], launch[key], "OWNERSHIP_HANDOFF_CHANGED_" + key);
          assert.equal(request.id, null, "PRE_ID_OWNERSHIP_HANDOFF_REQUIRED");
          owned = { ...request };
          handled = true; // Never replay creation, even when its ACK is unknown.
          try {
            verifyPlatform(owned, docker);
            const id = docker(...containerArguments(owned));
            assert.match(id, /^[a-f0-9]{64}$/);
            owned = { ...owned, id };
            save("ownership.json", owned);
            save("container.json", { id });
          } catch (error) {
            launchError = error;
            save("container.json", { error: errorRecord(error) });
          }
        }
      }
      if (launch.timeoutProof && !ready) {
        const handshake = read("ready.json");
        if (handshake) {
          assert.ok(owned?.id && !launchError, "NO_READY_WITHOUT_CONTAINER_ACK");
          assert.equal(handshake.id, owned.id);
          assert.equal(handshake.runId, launch.runId);
          assert.equal(handshake.serverVerified, true);
          ready = true;
          onReady();
        }
      }
    },
    finish(child) {
      assert.equal(finished, false, "CLEANUP_MUST_NOT_BE_RETRIED");
      finished = true;
      let cleanup;
      try {
        cleanup = cleanupOwnedLaunch(owned, docker);
      } catch (error) {
        cleanup = {
          status: "CLEANUP_BLOCKED",
          removed: false,
          error: errorRecord(error),
        };
      }
      const proofPassed = Boolean(
        launch.timeoutProof &&
        ready &&
        child.proofKilled &&
        child.signal === "SIGKILL" &&
        !child.timedOut &&
        !child.error &&
        !launchError &&
        cleanup.status === "REMOVED_OWNED_RESOURCE" &&
        cleanup.ownershipVerified &&
        cleanup.existed &&
        cleanup.removed,
      );
      let summary = null;
      if (!launch.timeoutProof && child.code === 0) {
        try {
          summary = read("summary.json");
        } catch (error) {
          summary = { error: errorRecord(error) };
        }
      }
      const regressionPassed =
        summary?.status === "PASS_ISOLATED_SYNTHETIC" &&
        Number.isInteger(summary.tests) &&
        summary.tests >= 26 &&
        summary.passed === summary.tests &&
        summary.failed === 0 &&
        summary.skipped === 0;
      const normalPassed =
        !launch.timeoutProof &&
        child.code === 0 &&
        !child.error &&
        !child.timedOut &&
        !launchError &&
        regressionPassed &&
        owned &&
        cleanup.removed;
      const exitCode = launch.timeoutProof
        ? proofPassed
          ? 0
          : 1
        : normalPassed
          ? 0
          : child.code || 1;
      return {
        status: proofPassed
          ? "PASS_TIMEOUT_CLEANUP_PROOF"
          : normalPassed
            ? "PASS_ISOLATED_SYNTHETIC"
            : "FAIL_ISOLATED",
        exitCode,
        timeoutProof: launch.timeoutProof,
        proofPassed,
        childExitCode: child.code,
        childSignal: child.signal,
        timedOut: Boolean(child.timedOut),
        childError: child.error ? errorRecord(child.error) : null,
        launchError: launchError ? errorRecord(launchError) : null,
        cleanup,
        summary,
      };
    },
  };
}

export async function runLauncher(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  const directory = mkdtempSync(path.join(realpathSync(tmpdir()), "named-publication-"));
  chmodSync(directory, 0o700);
  const save = (name, value) => atomicSave(directory, name, value);
  const read = (name) => readRecord(directory, name);
  const env = cleanEnvironment();
  const rawDocker = dockerCommand(env);
  let platform;
  try {
    platform = captureLocalPlatform(rawDocker);
  } catch (error) {
    save("launcher-error.json", errorRecord(error));
    return {
      status: "FAIL_LOCAL_PLATFORM_GATE",
      exitCode: 1,
      error: errorRecord(error),
      outputDirectory: directory,
    };
  }
  const launch = {
    ...platform,
    ...options,
    runId: "named-publication-" + randomUUID(),
  };
  save("launch.json", launch);
  const docker = inContext(rawDocker, platform.context);
  const stdout = openSync(path.join(directory, "stdout.log"), "wx", 0o600);
  const stderr = openSync(path.join(directory, "stderr.log"), "wx", 0o600);
  let child;
  try {
    child = spawn(
      process.execPath,
      [fileURLToPath(new URL("./named-publication-harness.mjs", import.meta.url))],
      {
        cwd: fileURLToPath(repoRoot),
        env: { ...env, NAMED_PUBLICATION_LAUNCH_DIR: directory },
        stdio: ["ignore", stdout, stderr],
        windowsHide: true,
      },
    );
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
  let proofTimer,
    childError,
    supervisorError,
    timedOut = false,
    proofKilled = false;
  const controller = createLaunchController({
    launch,
    docker,
    read,
    save,
    onReady() {
      // Start the proof timeout only after real server identity was verified.
      proofTimer = setTimeout(() => {
        proofKilled = child.kill("SIGKILL");
      }, 100);
    },
  });
  const poll = setInterval(() => {
    try {
      controller.poll();
    } catch (error) {
      supervisorError ??= error;
      child.kill("SIGKILL");
    }
  }, 25);
  const deadline = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, 180000);
  const interrupt = () => {
    childError ??= Error("LAUNCH_INTERRUPTED");
    child.kill("SIGKILL");
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  let outcome;
  try {
    outcome = await new Promise((resolve) => {
      child.on("error", (error) => {
        childError = error;
      });
      child.on("close", (code, signal) => resolve({ code, signal }));
    });
  } finally {
    clearInterval(poll);
    clearTimeout(deadline);
    clearTimeout(proofTimer);
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
  const result = {
    ...controller.finish({
      ...outcome,
      proofKilled,
      timedOut,
      error: childError ?? supervisorError,
    }),
    runId: launch.runId,
    outputDirectory: directory,
  };
  save("result.json", result);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLauncher()
    .then((result) => {
      console.log(JSON.stringify(result));
      process.exitCode = result.exitCode;
    })
    .catch((error) => {
      console.error(JSON.stringify({ status: "FAIL_LAUNCHER", ...errorRecord(error) }));
      process.exitCode = 1;
    });
}
