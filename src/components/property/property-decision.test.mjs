import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const moduleUrl = new URL("./property-decision.js", import.meta.url);
const layoutModuleUrl = new URL("./property-media-contact-layout.js", import.meta.url);

test("sale listings expose mortgage preview and the exact three mobile commands", async () => {
  assert.equal(existsSync(moduleUrl), true, "property decision helper must exist");
  const { getPropertyDecision } = await import(moduleUrl);

  assert.deepEqual(getPropertyDecision({ dealType: "sale", price: 8_880_000 }), {
    intent: "buyer",
    inquiryLabel: "查詢此售盤",
    showMortgage: true,
    hasMortgagePrice: true,
    mortgageHref: "/mortgage?price=8880000",
    mobileCommands: ["致電", "WhatsApp", "計月供"],
  });
});

test("sale listings without a price retain the generic mortgage action", async () => {
  const { getPropertyDecision } = await import(moduleUrl);

  assert.deepEqual(getPropertyDecision({ dealType: "sale", price: null }), {
    intent: "buyer",
    inquiryLabel: "查詢此售盤",
    showMortgage: true,
    hasMortgagePrice: false,
    mortgageHref: "/mortgage",
    mobileCommands: ["致電", "WhatsApp", "計月供"],
  });
});

test("sale listings with an invalid price retain the generic mortgage action", async () => {
  const { getPropertyDecision } = await import(moduleUrl);

  assert.deepEqual(getPropertyDecision({ dealType: "sale", price: -1 }), {
    intent: "buyer",
    inquiryLabel: "查詢此售盤",
    showMortgage: true,
    hasMortgagePrice: false,
    mortgageHref: "/mortgage",
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
    hasMortgagePrice: false,
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

test("property layout renders mobile contact immediately after media without duplicating the form", async () => {
  assert.equal(existsSync(layoutModuleUrl), true, "property media/contact layout must exist");
  const { PropertyMediaContactLayout } = await import(layoutModuleUrl);

  const markup = renderToStaticMarkup(
    createElement(PropertyMediaContactLayout, {
      media: createElement("section", { "data-marker": "media" }, "media"),
      mobileContact: createElement(
        "section",
        { "data-marker": "mobile-contact" },
        "assigned public agent",
      ),
      details: createElement("section", { "data-marker": "details" }, "description"),
      sidebar: createElement(
        "form",
        { id: "property-inquiry-form" },
        createElement("input", { id: "name", name: "name" }),
      ),
    }),
  );

  const mediaIndex = markup.indexOf('data-marker="media"');
  const mobileContactIndex = markup.indexOf('data-marker="mobile-contact"');
  const detailsIndex = markup.indexOf('data-marker="details"');
  const sidebarIndex = markup.indexOf('id="property-inquiry-form"');
  assert.ok(mediaIndex < mobileContactIndex, "mobile contact must follow media");
  assert.ok(mobileContactIndex < detailsIndex, "mobile contact must precede property details");
  assert.ok(
    detailsIndex < sidebarIndex,
    "desktop sidebar stays paired beside the media/details column",
  );
  assert.match(markup, /lg:grid-cols-\[2fr_1fr\]/);
  assert.match(markup, /data-slot="mobile-contact" class="mt-4 lg:hidden"/);
  assert.equal((markup.match(/id="property-inquiry-form"/g) ?? []).length, 1);
  assert.equal((markup.match(/id="name"/g) ?? []).length, 1);
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
  assert.match(route, /PropertyMediaContactLayout/);
  assert.match(route, /mobileContact=/);

  for (const contract of [
    "hasVideo",
    "hasVR",
    "hasFloorplan",
    "hasMap",
    "txns.length > 0",
    "similar.length > 0",
    "<PropertyInquiryForm",
    'type="application/ld+json"',
    "RealEstateListing",
    'property: "og:image"',
  ]) {
    assert.equal(route.includes(contract), true, `property route must preserve ${contract}`);
  }

  // The enquiry form moved out of the route into its own component; focusInquiry() in the
  // route still depends on its `id="name"` input and the submit handler must stay wired.
  const inquiryForm = readFileSync(new URL("./PropertyInquiryForm.tsx", import.meta.url), "utf8");
  assert.match(inquiryForm, /async function handleSubmit/);
  assert.match(inquiryForm, /<Input id="name" name="name"/);

  assert.match(actions, /calculateMortgage\(\{ price \}\)/);
  assert.match(actions, /decision\.hasMortgagePrice && price !== null/);
  assert.match(actions, /輸入樓價、按揭成數及年期，快速估算置業預算。/);
  assert.match(actions, /開啟按揭計算機/);
  // Bar position and the chat slot are pinned by the dedicated test below.
  assert.match(liveAgent, /DialogPrimitive\.Trigger/);
  assert.match(route, /暫時未能載入樓盤資料，請稍後再試。/);
  assert.doesNotMatch(route, /\{error\.message\}/);
});

// FX-16 F-07: the bar used to float at bottom-16 so it sat above the 問樓助手
// pill, stacking 121 px of chrome over the gallery. It now sits on the safe
// area at bottom-0 and keeps a right slot that the docked chat icon fills.
test("the property bar sits at bottom-0 with the same launcher slot", () => {
  const actions = readFileSync(new URL("./PropertyDecisionActions.tsx", import.meta.url), "utf8");
  const route = readFileSync(
    new URL("../../routes/property.$listingNo.tsx", import.meta.url),
    "utf8",
  );
  const bar = actions.match(/<div\s+className="([^"]*)"\s+data-property-mobile-actions/)?.[1] ?? "";
  assert.match(bar, /fixed inset-x-0 bottom-0/, "the bar must touch the viewport bottom");
  assert.doesNotMatch(bar, /bottom-16/, "the old 64 px float covered the gallery CTAs");
  assert.match(
    bar,
    /pb-\[calc\(0\.5rem\+env\(safe-area-inset-bottom\)\)\]/,
    "the home indicator must not sit on the buttons",
  );
  assert.match(bar, /pr-\[3\.75rem\]/, "44 px icon + 12 px edge + 4 px gap for the chat icon");
  assert.match(bar, /lg:hidden/);
  // Below 420 px the three leading icons drop so 「WhatsApp」 fits a 89 px column at 360 px.
  assert.equal(actions.match(/className="[^"]*\bhidden\b[^"]*\bmin-\[420px\]:inline"/g)?.length, 3);
  // The route no longer reserves 128 px of its own; the root reserves the bar's height.
  assert.doesNotMatch(route, /pb-32/);
  const launcher = readFileSync(
    new URL("../live-agent/LiveAgentLauncher.tsx", import.meta.url),
    "utf8",
  );
  assert.match(launcher, /docked\?: boolean/);
});

test("property.$listingNo.tsx sanitizes title/description/address before rendering (DR-4)", () => {
  const route = readFileSync(
    new URL("../../routes/property.$listingNo.tsx", import.meta.url),
    "utf8",
  );

  assert.match(route, /import \{[\s\S]*?sanitizeListingText[\s\S]*?\} from "@\/lib\/format"/);
  // At least one call site per field family, not an exhaustive count -- the
  // goal is catching a future raw-interpolation regression, not pinning the
  // exact number of call sites (title/description/address each have several).
  assert.match(route, /sanitizeListingText\(publicPropertyTitle\(property\)\)/);
  assert.match(route, /sanitizeListingText\(property\.description\)/);
  assert.match(route, /sanitizeListingText\(property\.address\)/);
  assert.match(route, /sanitizeListingText\(publicPropertyTitle\(listing\)\)/);
  // A blank title is worse than an unsanitized one -- title always falls back
  // to the raw value, never to an empty string.
  assert.match(
    route,
    /sanitizeListingText\(publicPropertyTitle\(property\)\) \?\? property\.title_zh/,
  );
  // A missing/malformed description must show a real fallback, not a blank
  // paragraph or the literal word "null".
  assert.match(route, /safeDescription \?\? "暫無詳細描述"/);
});
