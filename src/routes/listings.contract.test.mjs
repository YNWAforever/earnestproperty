import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
