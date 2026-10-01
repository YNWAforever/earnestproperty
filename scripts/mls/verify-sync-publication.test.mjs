import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
const path = new URL("./verify-sync-publication.mjs", import.meta.url);
async function module() {
  assert.ok(existsSync(path), "publication verifier missing");
  return import(path.href);
}
test("verification requires a public alias and successful genuine pages", async () => {
  const m = await module();
  let urls = [];
  const fetch = async (u) => {
    urls.push(String(u));
    return new Response("晉誠地產 A000001", { headers: { "content-type": "text/html" } });
  };
  const result = await m.verifyPublicReport(
    { published: [{ publicListingNo: "A000001" }] },
    { fetch },
  );
  assert.equal(result.detailsVerified, 1);
  assert.equal(urls[1], "https://earnestproperty.com/property/A000001");
  await assert.rejects(
    () => m.verifyPublicReport({ published: [{ propertyNo: "A000001" }] }, { fetch }),
    /PUBLIC_ALIAS_REQUIRED/,
  );
  await assert.rejects(
    () =>
      m.verifyPublicReport(
        { published: [] },
        { fetch: async () => new Response("login", { status: 403 }) },
      ),
    /PUBLIC_PAGE_UNVERIFIED/,
  );
});
test("only verified first-party canonical redirect is followed", async () => {
  const m = await module();
  const urls = [];
  const fetch = async (u) => {
    urls.push(u);
    return urls.length === 1
      ? new Response("", { status: 308, headers: { location: "https://www.earnestproperty.com/" } })
      : new Response("晉誠地產", { headers: { "content-type": "text/html" } });
  };
  assert.equal((await m.verifyPublicReport({ published: [] }, { fetch })).homepageVerified, true);
  assert.equal(urls[1], "https://www.earnestproperty.com/");
  for (const location of [
    "https://evil.example/",
    "http://www.earnestproperty.com/",
    "https://www.earnestproperty.com/admin",
    "https://user:secret@www.earnestproperty.com/",
  ])
    await assert.rejects(
      m.verifyPublicReport(
        { published: [] },
        { fetch: async () => new Response("", { status: 308, headers: { location } }) },
      ),
      /PUBLIC_PAGE_UNVERIFIED/,
    );
});
