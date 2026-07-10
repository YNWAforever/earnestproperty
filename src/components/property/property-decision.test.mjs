import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const moduleUrl = new URL("./property-decision.js", import.meta.url);

test("sale listings expose mortgage preview and the exact three mobile commands", async () => {
  assert.equal(existsSync(moduleUrl), true, "property decision helper must exist");
  const { getPropertyDecision } = await import(moduleUrl);

  assert.deepEqual(getPropertyDecision({ dealType: "sale", price: 8_880_000 }), {
    intent: "buyer",
    inquiryLabel: "查詢此售盤",
    showMortgage: true,
    mortgageHref: "/mortgage?price=8880000",
    mobileCommands: ["致電", "WhatsApp", "計月供"],
  });
});

test("rental listings use renter intent and never expose mortgage actions", async () => {
  assert.equal(existsSync(moduleUrl), true, "property decision helper must exist");
  const { getPropertyDecision } = await import(moduleUrl);

  assert.deepEqual(getPropertyDecision({ dealType: "rent", price: 28_000 }), {
    intent: "renter",
    inquiryLabel: "查詢此租盤",
    showMortgage: false,
    mortgageHref: null,
    mobileCommands: ["致電", "WhatsApp"],
  });
});

test("browser inquiry payload allow-lists fields and cannot select an agent", async () => {
  assert.equal(existsSync(moduleUrl), true, "property decision helper must exist");
  const { buildPropertyInquiryPayload } = await import(moduleUrl);

  const payload = buildPropertyInquiryPayload({
    form: {
      name: "陳先生",
      phone: "9123 4567",
      email: "buyer@example.com",
      message: "想睇樓",
      agent_id: "attacker-selected-agent",
      assigned_agent_id: "another-attacker-selected-agent",
    },
    propertyId: "11111111-1111-4111-8111-111111111111",
    consentWhatsapp: true,
  });

  assert.deepEqual(payload, {
    name: "陳先生",
    phone: "9123 4567",
    email: "buyer@example.com",
    message: "想睇樓",
    property_id: "11111111-1111-4111-8111-111111111111",
    consentWhatsapp: true,
  });
  assert.equal("agent_id" in payload, false);
  assert.equal("assigned_agent_id" in payload, false);
});

test("property route keeps the full decision and discovery feature set", () => {
  const route = readFileSync(
    new URL("../../routes/property.$listingNo.tsx", import.meta.url),
    "utf8",
  );
  const actions = readFileSync(new URL("./PropertyDecisionActions.tsx", import.meta.url), "utf8");
  const liveAgent = readFileSync(
    new URL("../live-agent/LiveAgentWidget.tsx", import.meta.url),
    "utf8",
  );

  const summaryIndex = route.indexOf('aria-labelledby="property-title"');
  const mediaIndex = route.indexOf('<Tabs defaultValue="photos">');
  assert.notEqual(summaryIndex, -1);
  assert.notEqual(mediaIndex, -1);
  assert.ok(summaryIndex < mediaIndex, "property summary must render before media");

  for (const contract of [
    "hasVideo",
    "hasVR",
    "hasFloorplan",
    "hasMap",
    "txns.length > 0",
    "similar.length > 0",
    "handleSubmit",
    'type="application/ld+json"',
    "RealEstateListing",
    'property: "og:image"',
  ]) {
    assert.equal(route.includes(contract), true, `property route must preserve ${contract}`);
  }

  assert.match(actions, /calculateMortgage\(\{ price \}\)/);
  assert.match(actions, /bottom-16/);
  assert.doesNotMatch(actions, /bottom-0/);
  assert.match(liveAgent, /fixed bottom-4 right-4/);
});
