import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

export const PINNED_IMAGE =
  "pgvector/pgvector@sha256:d2ef61f42ef767baa5a1475393303cc235bcd92febd9d7014eddb48b41f3bad0";
const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const idPattern = /^[a-f0-9]{64}$/;
const imageIdPattern = /^sha256:[a-f0-9]{64}$/;

export function validateLocalEndpoint(endpoint) {
  assert.equal(typeof endpoint, "string");
  assert.ok(!/[\r\n\0]/.test(endpoint), "INVALID_LOCAL_DOCKER_ENDPOINT");
  assert.ok(
    /^unix:\/\/\/[^\0]+$/.test(endpoint) ||
      /^npipe:\/\/\/\/\.\/pipe\/(?:docker_engine|dockerDesktopLinuxEngine)$/.test(endpoint),
    "LOCAL_DOCKER_SOCKET_REQUIRED",
  );
  return endpoint;
}

export function validatePlatform(platform) {
  assert.match(platform.context, /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
  validateLocalEndpoint(platform.endpoint);
  assert.equal(typeof platform.daemon, "string");
  assert.match(platform.daemon, /^[a-zA-Z0-9][a-zA-Z0-9:_.-]{0,255}$/);
  assert.equal(platform.image, PINNED_IMAGE);
  assert.match(platform.imageId, imageIdPattern);
}

export function validateOwnership(expected) {
  validatePlatform(expected);
  assert.match(expected.runId, new RegExp("^named-publication-" + uuid + "$"));
  assert.match(expected.name, new RegExp("^earnest-remediation-qa-" + uuid + "$"));
  if (expected.id != null) assert.match(expected.id, idPattern);
  return expected;
}

/** Pass only an OS allowlist as env. No shell, registry login, pull or retries. */
export function dockerCommand(env) {
  return (...args) => {
    const result = spawnSync("docker", args, {
      env,
      encoding: "utf8",
      timeout: 30000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      const error = new Error(result.error?.message ?? result.stderr.trim(), {
        cause: result.error,
      });
      error.code = result.error?.code ?? "NAMED_PUBLICATION_DOCKER_ERROR";
      error.stderr = result.stderr ?? "";
      throw error;
    }
    return result.stdout.trim();
  };
}

export const inContext =
  (raw, context) =>
  (...args) =>
    raw("--context", context, ...args);

/** A digest reference selects the image; the local image config ID is a separate identity. */
export function captureLocalPlatform(raw) {
  const context = raw("context", "show");
  assert.match(context, /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
  const docker = inContext(raw, context);
  const endpoint = validateLocalEndpoint(
    JSON.parse(
      docker("context", "inspect", context, "--format", "{{json .Endpoints.docker.Host}}"),
    ),
  );
  const daemon = JSON.parse(docker("info", "--format", "{{json .ID}}"));
  const image = JSON.parse(docker("image", "inspect", PINNED_IMAGE, "--format", "{{json .}}"));
  assert.ok(image.RepoDigests?.includes(PINNED_IMAGE), "PINNED_LOCAL_IMAGE_REQUIRED_NO_PULL");
  const platform = {
    context,
    endpoint,
    daemon,
    image: PINNED_IMAGE,
    imageId: image.Id,
  };
  validatePlatform(platform);
  return platform;
}

export function verifyPlatform(expected, docker) {
  validatePlatform(expected);
  const endpoint = JSON.parse(
    docker("context", "inspect", expected.context, "--format", "{{json .Endpoints.docker.Host}}"),
  );
  assert.equal(validateLocalEndpoint(endpoint), expected.endpoint, "DOCKER_ENDPOINT_CHANGED");
  assert.equal(
    JSON.parse(docker("info", "--format", "{{json .ID}}")),
    expected.daemon,
    "DOCKER_DAEMON_CHANGED",
  );
}

/** Ownership is sufficient for cleanup even when a resource admission gate failed. */
export function verifyContainerOwnership(metadata, expected) {
  validateOwnership(expected);
  assert.match(metadata.Id, idPattern);
  if (expected.id != null) assert.equal(metadata.Id, expected.id);
  assert.equal(metadata.Name, "/" + expected.name);
  assert.equal(metadata.Config.Image, PINNED_IMAGE);
  assert.equal(metadata.Image, expected.imageId);
  assert.equal(metadata.Config.Labels?.["earnest.named-publication.run"], expected.runId);
  assert.equal(
    metadata.Config.Labels?.["earnest.named-publication.scope"],
    "single-target-publisher",
  );
  return { id: metadata.Id, name: metadata.Name, ownershipVerified: true };
}

export function verifyContainerAdmission(metadata, expected) {
  const owner = verifyContainerOwnership(metadata, expected);
  assert.equal(metadata.State.Running, true);
  assert.equal(metadata.HostConfig.Memory, 512 * 1024 * 1024);
  assert.equal(metadata.HostConfig.MemorySwap, 512 * 1024 * 1024);
  assert.equal(metadata.HostConfig.NetworkMode, "bridge");
  assert.ok(!metadata.HostConfig.Binds?.length);
  assert.ok(!metadata.HostConfig.VolumesFrom?.length);
  // Image-declared VOLUME metadata is harmless when the actual mount is tmpfs.
  assert.ok(metadata.Mounts.every((mount) => mount.Type === "tmpfs"));
  assert.ok(Object.hasOwn(metadata.HostConfig.Tmpfs, "/var/lib/postgresql/data"));
  const ports = metadata.NetworkSettings.Ports["5432/tcp"];
  assert.equal(ports.length, 1);
  assert.equal(ports[0].HostIp, "127.0.0.1");
  const port = Number(ports[0].HostPort);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
  assert.deepEqual(Object.keys(metadata.NetworkSettings.Ports), ["5432/tcp"]);
  return {
    ...owner,
    host: "127.0.0.1",
    port,
    image: expected.image,
    imageId: expected.imageId,
  };
}

export function containerArguments(expected) {
  validateOwnership(expected);
  // Deliberately no --rm: the surviving parent owns removal and absence readback.
  return [
    "run",
    "--pull",
    "never",
    "--detach",
    "--name",
    expected.name,
    "--label",
    "earnest.named-publication.run=" + expected.runId,
    "--label",
    "earnest.named-publication.scope=single-target-publisher",
    "--memory",
    "512m",
    "--memory-swap",
    "512m",
    "--cpus",
    "1",
    "--network",
    "bridge",
    "--tmpfs",
    "/var/lib/postgresql/data:rw,nosuid,noexec,size=268435456",
    "--env",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "--publish",
    "127.0.0.1::5432",
    PINNED_IMAGE,
    "postgres",
    "-c",
    "cluster_name=" + expected.runId,
  ];
}

function absenceAcknowledged(error, identifier) {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const message = String(error.stderr || error.message).trim();
  return new RegExp(
    "^(?:(?:Error response from daemon|Error):\\s*)?No such (?:object|container):\\s*" +
      escaped +
      "$",
    "i",
  ).test(message);
}

/** One exact-ID rm at most. Ambiguous ACKs require exact-ID absence, never a retry. */
export function cleanupOwnedLaunch(expected, docker) {
  if (!expected) return { status: "NO_OWNERSHIP_HANDOFF", removed: false, existed: false };
  validateOwnership(expected);
  verifyPlatform(expected, docker);
  const identifier = expected.id ?? expected.name;
  let metadata;
  try {
    metadata = JSON.parse(docker("inspect", identifier))[0];
  } catch (error) {
    if (absenceAcknowledged(error, identifier))
      return {
        status: "ALREADY_ABSENT",
        removed: true,
        existed: false,
        id: expected.id ?? null,
      };
    throw error;
  }
  const owner = verifyContainerOwnership(metadata, expected);
  let removalError;
  try {
    docker("rm", "--force", owner.id);
  } catch (error) {
    removalError = error;
  }
  try {
    docker("inspect", owner.id);
  } catch (error) {
    if (absenceAcknowledged(error, owner.id))
      return {
        ...owner,
        status: "REMOVED_OWNED_RESOURCE",
        removed: true,
        existed: true,
        removalAcknowledgementLost: Boolean(removalError),
        removalError: removalError?.message ?? null,
      };
    if (removalError) error.removalError = removalError;
    throw error;
  }
  throw new Error("OWNED_CONTAINER_STILL_EXISTS", { cause: removalError });
}
