import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const dataUrl = (source) => "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const contact = dataUrl(transpile(readFileSync(join(root, "src/lib/contact-links.ts"), "utf8")));
const source = transpile(
  readFileSync(join(root, "src/lib/whatsapp-enquiries/public-context.ts"), "utf8"),
).replace('from "../contact-links.ts"', 'from "' + contact + '"');
const { buildPublicWhatsappMessage, resolvePublicWaAction, resolveWebsiteActions } = await import(
  dataUrl(source)
);
const offer = {
  propertyId: "00000000-0000-4000-8000-000000000001",
  publicListingNo: "A074714",
  dealType: "rent",
  title: "青山公路海景單位",
};

test("public WhatsApp actions preserve identity across tracked and fallback paths", () => {
  assert.equal(
    buildPublicWhatsappMessage(offer),
    "您好，我想查詢樓盤 A074714（出租）：青山公路海景單位。",
  );
  const tracked = resolvePublicWaAction(offer, "/w/reference-code", "85291234567");
  assert.deepEqual(tracked, {
    href: "/w/reference-code",
    mode: "tracked",
    publicListingNo: "A074714",
    dealType: "rent",
  });
  const fallback = resolvePublicWaAction(offer, null, "85291234567");
  assert.equal(fallback.mode, "untracked");
  assert.match(decodeURIComponent(fallback.href), /A074714（出租）：青山公路海景單位/);
  assert.doesNotMatch(fallback.href, /EPWA|00000000-0000-4000-8000/);
  assert.deepEqual(resolvePublicWaAction(offer, null, ""), {
    href: "/contact",
    mode: "contact",
    publicListingNo: "A074714",
    dealType: "rent",
  });
  assert.equal(
    resolvePublicWaAction(
      { ...offer, publicListingNo: "SYNC-abc" },
      "/w/reference-code",
      "85291234567",
    ).href,
    "/contact",
  );
});
import { resolveTrackingLinks } from "../neon/whatsapp-enquiries.server.ts";

test("resolver batches tracked and missing offers without provisioning", async () => {
  const before = {
    enabled: process.env.EP_WA_TRACKED_LINKS_ENABLED,
    channel: process.env.EP_WA_COMPANY_CHANNEL_ID,
    phone: process.env.EP_WA_COMPANY_PHONE,
    sitePhone: process.env.VITE_CONTACT_WHATSAPP_PHONE,
  };
  const warn = console.warn;
  const calls = [];
  try {
    process.env.EP_WA_TRACKED_LINKS_ENABLED = "true";
    process.env.EP_WA_COMPANY_CHANNEL_ID = "company-fixture";
    delete process.env.EP_WA_COMPANY_PHONE;
    process.env.VITE_CONTACT_WHATSAPP_PHONE = "85291234567";
    console.warn = () => {};
    const other = {
      ...offer,
      propertyId: "00000000-0000-4000-8000-000000000002",
      dealType: "sale",
    };
    const result = await resolveTrackingLinks([offer, other], async (sql, params) => {
      calls.push({ sql, params });
      return [{ propertyId: offer.propertyId, candidateCount: 1, code: "tracked-code" }];
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /^WITH wanted AS/);
    assert.equal(result.actions[0].href, "/w/tracked-code");
    assert.equal(result.actions[0].mode, "tracked");
    assert.equal(result.actions[1].mode, "untracked");
    assert.match(decodeURIComponent(result.actions[1].href), /A074714（出售）：青山公路海景單位/);
    assert.equal(result.links[1].href, null);
    process.env.EP_WA_TRACKED_LINKS_ENABLED = "false";
    const disabled = await resolveTrackingLinks([offer], async () => {
      throw new Error("disabled tracking must not read the database");
    });
    assert.equal(disabled.actions[0].mode, "untracked");
  } finally {
    console.warn = warn;
    for (const [key, value] of Object.entries({
      EP_WA_TRACKED_LINKS_ENABLED: before.enabled,
      EP_WA_COMPANY_CHANNEL_ID: before.channel,
      EP_WA_COMPANY_PHONE: before.phone,
      VITE_CONTACT_WHATSAPP_PHONE: before.sitePhone,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("ambiguous website links never select an arbitrary code", () => {
  const resolved = resolveWebsiteActions(
    [offer],
    [{ propertyId: offer.propertyId, candidateCount: 2, code: "arbitrary" }],
    "85291234567",
  );
  assert.equal(resolved.links[0].href, null);
  assert.equal(resolved.actions[0].mode, "untracked");
  assert.match(decodeURIComponent(resolved.actions[0].href), /A074714（出租）/);
});
