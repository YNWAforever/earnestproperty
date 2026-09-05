import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(path, dependencies, extra = {}) {
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (name) => {
        if (!(name in dependencies)) throw new Error(name);
        return dependencies[name];
      },
      Request,
      Response,
      File,
      FormData,
      Headers,
      Blob,
      Buffer,
      crypto,
      Uint8Array,
      ...extra,
    },
  );
  return module.exports;
}
function route({ allowed = true, token = "test_blob_token_store" } = {}) {
  let provider = 0;
  let authRequest;
  const { Route } = load(
    "src/routes/api.admin.media.upload.ts",
    {
      "@tanstack/react-start/server-only": {},
      "@tanstack/react-router": { createFileRoute: () => (value) => value },
      "@/lib/neon/auth.server": {
        requireStaffAccess: async (request, roles) => {
          authRequest = request;
          assert.deepEqual(Array.from(roles), ["admin", "manager", "agent"]);
          if (!allowed) throw new Error("FORBIDDEN");
          return { staffId: "actor" };
        },
      },
      "@/lib/media/vercel-blob.mjs": {
        createVercelBlobStore: () => ({
          put: async () => {
            provider++;
          },
        }),
      },
      "@/lib/media/media-upload-repository.server": { mediaUploadRepository: {} },
      "@/lib/media/media-upload-service": {
        createMediaUploadService:
          ({ put }) =>
          async () => {
            await put();
            return { ok: true, url: "https://blob.test/a", pathname: "a" };
          },
      },
    },
    { process: { env: { BLOB_READ_WRITE_TOKEN: token } } },
  );
  return {
    post: (request) => Route.server.handlers.POST({ request }),
    get provider() {
      return provider;
    },
    get authRequest() {
      return authRequest;
    },
  };
}
function request(file = new File(["ok"], "a.png", { type: "image/png" }), headers = {}) {
  const body = new FormData();
  body.set("file", file);
  body.set("uploadId", "22222222-2222-4222-8222-222222222222");
  return new Request("https://app.test/api/admin/media/upload", { method: "POST", body, headers });
}
test("route preserves bearer and cookie requests through server staff boundary", async () => {
  for (const headers of [
    { authorization: "Bearer fake-session" },
    { cookie: "session=fake-session" },
  ]) {
    const f = route();
    const req = request(undefined, headers);
    assert.equal((await f.post(req)).status, 200);
    assert.equal(f.authRequest, req);
    assert.equal(f.provider, 1);
  }
});
test("revoked and non-staff cannot reach body parser or provider", async () => {
  for (const identity of ["revoked", "non-staff"]) {
    const f = route({ allowed: false });
    await assert.rejects(
      f.post(new Request("https://app.test", { method: "POST", body: identity })),
      /FORBIDDEN/,
    );
    assert.equal(f.provider, 0);
  }
});
test("unsupported, oversized, empty, malformed bodies and missing credentials never dispatch", async () => {
  for (const [file, status] of [
    [new File(["x"], "x.html", { type: "text/html" }), 415],
    [new File([], "x.png", { type: "image/png" }), 400],
    [new File([new Uint8Array(5242881)], "x.png", { type: "image/png" }), 413],
  ]) {
    const f = route();
    assert.equal((await f.post(request(file))).status, status);
    assert.equal(f.provider, 0);
  }
  const f = route();
  assert.equal(
    (await f.post(new Request("https://app.test", { method: "POST", body: "bad" }))).status,
    400,
  );
  const missing = route({ token: "" });
  assert.equal((await missing.post(request())).status, 503);
  assert.equal(missing.provider, 0);
});
test("client preserves retry identity and signed receipt across calls and passes auth headers", async () => {
  const store = new Map();
  const requests = [];
  const { uploadAdminMedia } = load(
    "src/lib/admin/media-upload.ts",
    {
      "@/auth": {
        withStaffUploadIdentity: async () => ({
          actorId: "staff-a",
          headers: new Headers({ authorization: "Bearer fake" }),
        }),
      },
    },
    {
      sessionStorage: {
        getItem: (key) => store.get(key) || null,
        setItem: (key, value) => store.set(key, value),
      },
      fetch: async (url, init) => {
        requests.push(init);
        return requests.length === 1
          ? Response.json(
              { ok: false, error: "UPLOAD_METADATA_PENDING", receipt: "signed" },
              { status: 503 },
            )
          : Response.json({ ok: true, url: "https://blob.test/a", pathname: "a" });
      },
    },
  );
  const file = new File(["x"], "a.png", { type: "image/png" });
  await assert.rejects(uploadAdminMedia(file, "cms"));
  await uploadAdminMedia(file, "cms");
  assert.equal(requests[0].headers.get("authorization"), "Bearer fake");
  assert.equal(requests[0].credentials, "same-origin");
  assert.equal(requests[0].body.get("uploadId"), requests[1].body.get("uploadId"));
  assert.equal(requests[1].body.get("receipt"), "signed");
});
test("both upload callers use the authenticated recovery helper", () => {
  for (const path of ["src/routes/admin.cms.tsx", "src/components/dashboard/ImageUploader.tsx"]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /uploadAdminMedia\(file,/);
    assert.doesNotMatch(source, /fetch\("\/api\/admin\/media\/upload"/);
  }
});

test("actual multipart bytes are capped even without Content-Length", async () => {
  const f = route();
  const body = new FormData();
  body.set("file", new File(["x"], "x.png", { type: "image/png" }));
  body.set("padding", "x".repeat(5 * 1024 * 1024 + 65536));
  const req = new Request("https://app.test", { method: "POST", body });
  assert.equal(req.headers.get("content-length"), null);
  assert.equal((await f.post(req)).status, 413);
  assert.equal(f.provider, 0);
});

test("upload recovery is isolated by account and survives same-account token rotation", async () => {
  const store = new Map();
  const requests = [];
  let actor = "staff-a";
  let token = "one";
  const { uploadAdminMedia } = load(
    "src/lib/admin/media-upload.ts",
    {
      "@/auth": {
        withStaffAuthHeaders: async () => ({ headers: new Headers({ authorization: token }) }),
        withStaffUploadIdentity: async () => ({
          actorId: actor,
          headers: new Headers({ authorization: token }),
        }),
      },
    },
    {
      sessionStorage: {
        getItem: (key) => store.get(key) || null,
        setItem: (key, value) => store.set(key, value),
      },
      fetch: async (url, init) => {
        requests.push(init);
        return Response.json({ ok: true, url: "https://blob.test/a", pathname: "a" });
      },
    },
  );
  const file = new File(["same"], "a.png", { type: "image/png" });
  await uploadAdminMedia(file, "cms");
  token = "two";
  await uploadAdminMedia(file, "cms");
  actor = "staff-b";
  await uploadAdminMedia(file, "cms");
  actor = "staff-a";
  await uploadAdminMedia(file, "cms");
  const ids = requests.map((r) => r.body.get("uploadId"));
  assert.equal(ids[0], ids[1]);
  assert.notEqual(ids[0], ids[2]);
  assert.equal(ids[0], ids[3]);
});

test("upload session identity supports cookie and bearer envelopes and rejects absent identity", async () => {
  const source = readFileSync("src/auth.ts", "utf8").replace(
    'import.meta.env.VITE_NEON_AUTH_URL ?? ""',
    '""',
  );
  const module = { exports: {} };
  let value;
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      module,
      exports: module.exports,
      Headers,
      require: (name) =>
        name.endsWith("/react/adapters")
          ? { BetterAuthReactAdapter: () => ({}) }
          : { createAuthClient: () => ({ getSession: async () => value }) },
    },
  );
  value = { data: { user: { id: "staff-a" }, session: { token: "one" } } };
  const first = await module.exports.withStaffUploadIdentity();
  assert.equal(first.actorId, "staff-a");
  assert.equal(first.headers.get("authorization"), "Bearer one");
  value = { user: { id: "staff-b" }, session: {} };
  const cookie = await module.exports.withStaffUploadIdentity();
  assert.equal(cookie.actorId, "staff-b");
  assert.equal(cookie.headers.has("authorization"), false);
  value = null;
  await assert.rejects(module.exports.withStaffUploadIdentity(), /重新登入/);
});
