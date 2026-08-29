import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Source-scan regression tests for /listings' UI shell (mobile filter
// drawer, active-filter chips, grid/list toggle, loading/error states).
// This repo has no render harness for this route today (confirmed: no
// existing test file exercised listings.tsx's component tree before this
// one), so -- matching SiteHeader.contract.test.mjs's established pattern
// -- these assert against the raw source text rather than rendered output.
const source = await readFile(
  new URL("./listings.tsx", import.meta.url),
  "utf8",
);

// buildActiveFilterChips() is a plain, dependency-light function (no JSX,
// no router/React imports needed at runtime) sandwiched between two other
// top-level declarations that already have unique source anchors elsewhere
// in this file. Unlike the pure-regex tests above, this extracts its real
// source text (plus its two small dependencies) and actually executes it,
// so a behavioral regression -- e.g. a chip rendering for a filter that no
// longer has any effect on the results -- fails the test rather than just
// silently matching whatever text happens to be there.
function loadActiveFilterChipsFn() {
  const districtBlock = source.slice(
    source.indexOf("const DISTRICT_LABELS"),
    source.indexOf("type ActiveFilterChip"),
  );
  const sortLabelsBlock = source.slice(
    source.indexOf("const SORT_LABELS"),
    source.indexOf("function SortSelect"),
  );
  const chipsBlock = source.slice(
    source.indexOf("function buildActiveFilterChips("),
    source.indexOf("function FilterChip("),
  );
  const snippet = [
    districtBlock,
    sortLabelsBlock,
    chipsBlock,
    "export { buildActiveFilterChips };\n",
  ].join("\n");

  const { outputText } = ts.transpileModule(snippet, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });

  const exportsObj = {};
  new Function("exports", outputText)(exportsObj);
  return exportsObj.buildActiveFilterChips;
}

test("desktop filters panel is hidden below lg and visible from lg up", () => {
  assert.match(source, /<aside className="hidden lg:block[^"]*">/);
  assert.match(source, /<DesktopFiltersPanel /);
});

test("mobile filters sheet trigger only shows below the lg breakpoint", () => {
  assert.match(source, /function MobileFiltersSheet/);
  // The trigger Button must carry lg:hidden -- same idiom SiteHeader.tsx
  // already uses for its own mobile nav trigger.
  const mobileSheetBody = source.slice(
    source.indexOf("function MobileFiltersSheet"),
  );
  assert.match(mobileSheetBody, /<SheetTrigger asChild>/);
  assert.match(
    mobileSheetBody.slice(0, 800),
    /className="relative gap-1\.5 lg:hidden"/,
  );
  assert.match(mobileSheetBody.slice(0, 2000), /篩選/);
});

test("mobile sheet's apply/reset call the SAME filters.apply()/filters.reset() the desktop panel uses -- no parallel handler", () => {
  // DesktopFiltersPanel wires its buttons straight to filters.apply /
  // filters.reset from the shared useListingFiltersState() hook.
  assert.match(source, /<Button onClick={filters\.apply} className="w-full">/);
  assert.match(source, /onClick={filters\.reset}/);

  // MobileFiltersSheet's 套用/清除 buttons call filters.apply()/filters.reset()
  // (the very same functions, passed down as props) rather than defining
  // their own separate apply/reset logic.
  const mobileSheetBody = source.slice(
    source.indexOf("function MobileFiltersSheet"),
    source.indexOf("function ViewModeToggle"),
  );
  assert.match(mobileSheetBody, /filters\.apply\(\);/);
  assert.match(mobileSheetBody, /filters\.reset\(\);/);
  // There is exactly one `apply()`/`reset()` implementation in the whole
  // file, inside useListingFiltersState -- not one per surface.
  assert.equal((source.match(/function apply\(\)/g) ?? []).length, 1);
  assert.equal((source.match(/function reset\(\)/g) ?? []).length, 1);
});

test("both the desktop panel and the mobile sheet render the shared FilterFields component (single source of controls)", () => {
  const desktopPanelBody = source.slice(
    source.indexOf("function DesktopFiltersPanel"),
    source.indexOf("function MobileFiltersSheet"),
  );
  const mobileSheetBody = source.slice(
    source.indexOf("function MobileFiltersSheet"),
    source.indexOf("function ViewModeToggle"),
  );
  assert.match(
    desktopPanelBody,
    /<FilterFields estates={estates} filters={filters} idPrefix="desktop" \/>/,
  );
  assert.match(
    mobileSheetBody,
    /<FilterFields\s+estates={estates}\s+filters={filters}\s+idPrefix="mobile"\s*\/>/,
  );
});

test("the deal=all price-bound explanatory copy lives in the single shared FilterFields component, so it reaches both surfaces", () => {
  const fieldsBody = source.slice(
    source.indexOf("function FilterFields"),
    source.indexOf("function DesktopFiltersPanel"),
  );
  assert.match(
    fieldsBody,
    /售價同月租唔同單位，揀「售盤」或「租盤」先可以設定價格。/,
  );
  // Only one copy of the sentence in the whole file -- proof it wasn't
  // duplicated (and risk drifting) when the panel was split in two.
  const occurrences =
    source.split("售價同月租唔同單位，揀「售盤」或「租盤」先可以設定價格。")
      .length - 1;
  assert.equal(occurrences, 1);
});

test("active-filter chips are built from non-default search params, one chip per param", () => {
  assert.match(source, /function buildActiveFilterChips\(/);
  for (const key of [
    "deal",
    "district",
    "estate",
    "bedrooms",
    "minPrice",
    "maxPrice",
    "minArea",
    "maxArea",
    "keyword",
    "sort",
  ]) {
    assert.match(
      source,
      new RegExp(`key:\\s*"${key}"`),
      `expected an active-filter chip descriptor for "${key}"`,
    );
  }
  assert.match(source, /activeChips\.map\(\(chip\) =>/);
  assert.match(source, /清除全部篩選/);
});

test("active-filter chips never claim a price filter is active when deal=all, mirroring describeListingSearch()'s server-parity gate", () => {
  // listingWhere() in public-data.server.ts drops minPrice/maxPrice
  // entirely once deal="all" (sale prices are in millions, rents in
  // thousands -- no single bound means both), so a chip for either param
  // under deal="all" would tell the user a filter is active that has zero
  // effect on the actual results. describeListingSearch() already gates on
  // this; buildActiveFilterChips() must too.
  const buildActiveFilterChips = loadActiveFilterChipsFn();
  const baseSearch = {
    deal: "all",
    district: undefined,
    minPrice: 5_000_000,
    maxPrice: 8_000_000,
    minArea: undefined,
    maxArea: undefined,
    bedrooms: undefined,
    estate: undefined,
    keyword: undefined,
    sort: "newest",
    page: 1,
  };

  const chipsUnderAllDeals = buildActiveFilterChips(baseSearch, []);
  assert.deepEqual(
    chipsUnderAllDeals.map((chip) => chip.key),
    [],
    'no chip should render for minPrice/maxPrice while deal is "all" -- ' +
      "the server ignores both bounds in that state",
  );

  // Sanity check the fixture and the extraction itself: the same bounds
  // DO produce chips once a deal type narrows the price column, proving
  // this isn't just always returning an empty array.
  const chipsUnderSaleDeal = buildActiveFilterChips(
    { ...baseSearch, deal: "sale" },
    [],
  );
  assert.deepEqual(chipsUnderSaleDeal.map((chip) => chip.key).sort(), [
    "deal",
    "maxPrice",
    "minPrice",
  ]);
});

test("each filter chip removes only its own param via a search merge function, not a whole-object replace", () => {
  const chipBody = source.slice(
    source.indexOf("function FilterChip"),
    source.indexOf("/**\n * All the mutable"),
  );
  // The established, reviewer-checked-for pattern: `search: (prev) => ({ ...prev, ... })`,
  // never a static `search={{ ... }}` object that would drop every other
  // active param.
  assert.match(chipBody, /search={\(prev: Record<string, unknown>\) => {/);
  assert.match(
    chipBody,
    /const next: Record<string, unknown> = { \.\.\.prev };/,
  );
  assert.match(chipBody, /delete next\[key\];/);
  assert.doesNotMatch(chipBody, /search={{ deal: "all", page: 1 }}/);
});

test("view mode is local component state, not a URL search param", () => {
  assert.match(
    source,
    /const \[viewMode, setViewMode\] = useState<"grid" \| "list">\("grid"\);/,
  );
  // It must not appear in the Zod search schema (that would make it a
  // shareable/URL-persisted param, which the plan explicitly says it is not).
  const schemaBody = source.slice(
    source.indexOf("const searchSchema = z.object({"),
    source.indexOf("});", source.indexOf("const searchSchema = z.object({")),
  );
  assert.doesNotMatch(schemaBody, /viewMode/);
});

test("a list-row card variant exists alongside the grid card, both fed by the same data-derivation helper", () => {
  assert.match(source, /function ListingCard\(/);
  assert.match(source, /function ListingCardRow\(/);
  assert.match(source, /function deriveListingCardData\(/);
  assert.match(source, /viewMode === "grid" \? \(/);
  assert.match(source, /<ListingCardRow key={p\.id} p={p} \/>/);
});

test("the route defines pendingComponent and errorComponent", () => {
  const routeConfig = source.slice(
    source.indexOf('createFileRoute("/listings")({'),
    source.indexOf("component: ListingsPage,") +
      "component: ListingsPage,".length,
  );
  assert.match(routeConfig, /pendingComponent: ListingsPendingComponent,/);
  assert.match(routeConfig, /errorComponent: ListingsErrorComponent,/);
});

test("pendingComponent renders a grid of SkeletonBlock cards shaped like the results grid", () => {
  const pendingBody = source.slice(
    source.indexOf("function ListingsPendingComponent"),
    source.indexOf("function ListingsErrorComponent"),
  );
  assert.match(pendingBody, /SkeletonBlock/);
  assert.match(pendingBody, /Array\.from\({ length: PAGE_SIZE }/);
  assert.match(pendingBody, /variant="card"/);
});

test("errorComponent explains the failure, retries via router.invalidate(), and offers a way back", () => {
  const errorBody = source.slice(
    source.indexOf("function ListingsErrorComponent"),
    source.indexOf("function ListingsPage"),
  );
  assert.match(errorBody, /const router = useRouter\(\);/);
  assert.match(errorBody, /router\.invalidate\(\)/);
  assert.match(
    errorBody,
    /<Link to="\/listings" search={{ deal: "all", page: 1 }}>/,
  );
});

test("SkeletonBlock and Sheet primitives are imported from this repo's existing vendored components", () => {
  assert.match(source, /from "@\/components\/layout\/SkeletonBlock"/);
  assert.match(source, /from "@\/components\/ui\/sheet"/);
});

// --- Task 3: DR-7 accessibility fixes, freshness stamp, share action -----
//
// FilterFields is the SINGLE shared component both DesktopFiltersPanel and
// MobileFiltersSheet render (proven above by the "both the desktop panel
// and the mobile sheet render the shared FilterFields component" test) --
// so every assertion below against FilterFields' body applies to both
// surfaces without needing a separate mobile-specific copy of each check.
function extractFilterFieldsBody() {
  return source.slice(
    source.indexOf("function FilterFields"),
    source.indexOf("function DesktopFiltersPanel"),
  );
}

test("the deal-type buttons form a labelled radiogroup, each button carrying real radio semantics", () => {
  const fieldsBody = extractFilterFieldsBody();
  // The radiogroup is labelled via aria-labelledby pointing at a stable id
  // on the existing "類型" <Label>, rather than repeating the label text a
  // second time as a literal aria-label string.
  assert.match(fieldsBody, /id={dealTypeLabelId}/);
  assert.match(
    fieldsBody,
    /role="radiogroup"\s+aria-labelledby={dealTypeLabelId}/,
  );
  assert.match(fieldsBody, /role="radio"/);
  assert.match(fieldsBody, /aria-checked={deal === v}/);
});

test("aria-checked on the deal-type radios is a live expression that flips per button, not a value pinned at render time", () => {
  // Extracts the EXACT aria-checked expression from the current source and
  // evaluates it for every (deal, v) combination the three buttons can take
  // -- this is what proves clicking a different button (which changes the
  // `deal` state React re-renders FilterFields with) produces a DIFFERENT
  // aria-checked outcome on each button, not just a snapshot that happens
  // to be correct once on initial render.
  const fieldsBody = extractFilterFieldsBody();
  const match = fieldsBody.match(/aria-checked={([^}]+)}/);
  assert.ok(
    match,
    "expected an aria-checked={...} expression on the deal-type radio buttons",
  );
  const evalChecked = (deal, v) =>
    new Function("deal", "v", `return (${match[1]});`)(deal, v);

  for (const deal of ["all", "sale", "rent"]) {
    for (const v of ["all", "sale", "rent"]) {
      assert.equal(
        evalChecked(deal, v),
        deal === v,
        `expected aria-checked to be ${deal === v} for deal="${deal}", v="${v}"`,
      );
    }
  }
});

test("each price input has a real id + deal-type-aware aria-label, not just a placeholder", () => {
  const fieldsBody = extractFilterFieldsBody();
  assert.match(
    fieldsBody,
    /id={minPriceId}[\s\S]{0,120}aria-label={`最低\$\{priceUnitLabel\} \(HKD\)`}/,
  );
  assert.match(
    fieldsBody,
    /id={maxPriceId}[\s\S]{0,120}aria-label={`最高\$\{priceUnitLabel\} \(HKD\)`}/,
  );
  // priceUnitLabel must actually depend on the current deal type -- proves
  // the aria-label text isn't a static, always-identical string.
  assert.match(
    fieldsBody,
    /const priceUnitLabel = isAllDeals \? "價格" : isRent \? "月租" : "售價";/,
  );
});

test("each of the three filter selects has its SelectTrigger id wired to a real <Label htmlFor>", () => {
  const fieldsBody = extractFilterFieldsBody();
  for (const id of ["bedroomsId", "districtId", "estateId"]) {
    assert.match(
      fieldsBody,
      new RegExp(`<Label className="mb-2 block text-xs" htmlFor={${id}}>`),
      `expected a <Label htmlFor={${id}}> wired to its SelectTrigger`,
    );
    assert.match(
      fieldsBody,
      new RegExp(`<SelectTrigger id={${id}} className="h-11">`),
      `expected <SelectTrigger id={${id}}> with no redundant aria-label`,
    );
  }
  // The old floating-label-plus-redundant-aria-label pattern (DR-7) is gone
  // from these three selects.
  assert.doesNotMatch(fieldsBody, /aria-label="房數"/);
  assert.doesNotMatch(fieldsBody, /aria-label="地區"/);
  assert.doesNotMatch(fieldsBody, /aria-label="屋苑"/);
});

test("FreshnessStamp replaces the raw formatHkDate '最後更新' text in BOTH ListingCard and ListingCardRow", () => {
  assert.match(source, /from "@\/components\/layout\/FreshnessStamp"/);
  const cardBody = source.slice(
    source.indexOf("function ListingCard("),
    source.indexOf("// Same data as ListingCard"),
  );
  const rowBody = source.slice(
    source.indexOf("function ListingCardRow("),
    source.indexOf("function Pagination("),
  );
  for (const [name, body] of [
    ["ListingCard", cardBody],
    ["ListingCardRow", rowBody],
  ]) {
    assert.match(
      body,
      /<FreshnessStamp\s+updatedAt={p\.last_seen_at}/,
      `expected ${name} to render <FreshnessStamp updatedAt={p.last_seen_at} />`,
    );
    assert.doesNotMatch(
      body,
      /最後更新：/,
      `expected ${name} to no longer render the raw "最後更新：" text`,
    );
  }
  // The card-data helper no longer needs to derive a formatted date string
  // itself -- FreshnessStamp does that internally from the raw timestamp.
  assert.doesNotMatch(source, /formatHkDate/);
});

test("both card layouts get a share button reusing lib/share.ts's shareUrl (the exact mechanism property.$listingNo.tsx already used)", () => {
  assert.match(source, /from "@\/lib\/share"/);
  assert.match(source, /function handleCardShare\(/);
  assert.match(
    source,
    /void shareUrl\(title, `\${SITE_URL}\/property\/\${listingNo}`\);/,
  );

  const cardBody = source.slice(
    source.indexOf("function ListingCard("),
    source.indexOf("// Same data as ListingCard"),
  );
  const rowBody = source.slice(
    source.indexOf("function ListingCardRow("),
    source.indexOf("function Pagination("),
  );
  for (const [name, body] of [
    ["ListingCard", cardBody],
    ["ListingCardRow", rowBody],
  ]) {
    assert.match(
      body,
      /onClick={\(\) => handleCardShare\(safeTitle, p\.listing_no\)}/,
      `expected ${name} to wire a share button to handleCardShare`,
    );
    // The share <button> must be a SIBLING of <Link>, not nested inside it
    // -- a <button> inside an <a> is invalid HTML and would leave a screen
    // reader unable to tell which element a click activates. Proven here by
    // checking the button's onClick appears AFTER the matching </Link>.
    const linkCloseIndex = body.indexOf("</Link>");
    const buttonIndex = body.indexOf(
      "onClick={() => handleCardShare(safeTitle, p.listing_no)}",
    );
    assert.ok(linkCloseIndex !== -1, `expected ${name} to render a <Link>`);
    assert.ok(
      buttonIndex > linkCloseIndex,
      `expected ${name}'s share button to be a sibling of <Link>, not nested inside it`,
    );
  }
});

test("lib/share.ts exports the reusable shareUrl helper and property.$listingNo.tsx's own share button now delegates to it", () => {
  const shareLibSource = readFileSync(
    new URL("../lib/share.ts", import.meta.url),
    "utf8",
  );
  assert.match(shareLibSource, /export async function shareUrl\(/);
  assert.match(shareLibSource, /navigator\.share/);
  assert.match(shareLibSource, /navigator\.clipboard\.writeText/);

  const propertyPageSource = readFileSync(
    new URL("./property.$listingNo.tsx", import.meta.url),
    "utf8",
  );
  assert.match(propertyPageSource, /from "@\/lib\/share"/);
  assert.match(propertyPageSource, /await shareUrl\(safeTitle, url\);/);
  // The inline navigator.share/clipboard implementation this was extracted
  // from must actually be gone, not duplicated alongside the shared helper.
  assert.doesNotMatch(
    propertyPageSource,
    /await navigator\.clipboard\.writeText\(url\);/,
  );
});
