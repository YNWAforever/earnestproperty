import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Exercise the actual loader and head without a database or browser. The
// search results and published estate list are the only external inputs.
const source = readFileSync(new URL("./listings.tsx", import.meta.url), "utf8");
const loaderStart = source.indexOf("  loader: async ({ deps }) => {");
const headStart = source.indexOf("  head: ({ loaderData }) => {");
const headEnd = source.indexOf("  pendingComponent:", headStart);
assert.ok(loaderStart >= 0 && headStart > loaderStart && headEnd > headStart);
const loaderBody = source
  .slice(loaderStart + "  loader: async ({ deps }) => {".length, headStart)
  .replace(/\n  },\s*$/, "");
const headBody = source
  .slice(headStart + "  head: ({ loaderData }) => {".length, headEnd)
  .replace(/\n  },\s*$/, "");

function routeFunctions(results, recorded) {
  const snippet = `
    const DISTRICT_LABELS = { "sham-tseng": "深井", "ting-kau": "汀九", "tsuen-wan": "荃灣", "castle-peak-road": "青山公路" };
    const PAGE_SIZE = 12;
    const SITE_CONTACT = { whatsappPhone: "00000000" };
    const pageSeo = { listings: { path: "/listings", title: "Listings", description: "Description" } };
    const canonicalLink = (path) => ({ rel: "canonical", href: "https://example.test" + path });
    const listingSearchSeo = () => ({ title: "Listings", description: "Description" });
    const fetchEstateOptions = async () => [{ slug: "bellagio", name_zh: "碧堤半島" }];
    const searchListings = async (query) => { recorded.push(query); return results; };
    const publicPropertyNo = (row) => row.listing_no;
    const publicPropertyTitle = (row) => row.title_zh;
    const sanitizeListingText = (text) => text;
    const resolveWhatsappLinks = async () => ({ actions: [] });
    const resolveWebsiteActions = () => ({ actions: [] });
    exports.loader = async function({ deps }) { ${loaderBody} };
    exports.head = function({ loaderData }) { ${headBody} };
  `;
  const js = ts.transpileModule(snippet, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("exports", "recorded", "results", js)(exports, recorded, results);
  return exports;
}

const defaults = { deal: "all", sort: "newest", page: 1 };
async function headFor(
  search,
  result = {
    rows: [{ id: "1", listing_no: "A001", title_zh: "盤源", deal_type: "sale" }],
    total: 36,
  },
) {
  const recorded = [];
  const route = routeFunctions(result, recorded);
  const loaderData = await route.loader({ deps: { ...defaults, ...search } });
  return { head: route.head({ loaderData }), query: recorded[0] };
}

function canonical(head) {
  return head.links.find((link) => link.rel === "canonical")?.href;
}
function robots(head) {
  return head.meta.find((entry) => entry.name === "robots")?.content;
}
function ogUrl(head) {
  return head.meta.find((entry) => entry.property === "og:url")?.content;
}

test("populated base and paginated listings have their own indexable canonical URLs", async () => {
  for (const [search, path] of [
    [{}, "/listings"],
    [{ page: 8 }, "/listings?page=8"],
  ]) {
    const { head } = await headFor(search);
    assert.equal(canonical(head), `https://example.test${path}`);
    assert.equal(ogUrl(head), canonical(head));
    assert.equal(robots(head), undefined);
  }
});

test("district-filtered pagination preserves the filter in its canonical and search", async () => {
  const { head, query } = await headFor({ district: "sham-tseng", page: 8 });
  assert.equal(canonical(head), "https://example.test/listings?district=sham-tseng&page=8");
  assert.equal(ogUrl(head), canonical(head));
  assert.equal(robots(head), undefined);
  assert.equal(query.districtSlug, "sham-tseng");
  assert.equal(query.page, 8);
});

test("sale, rent, district and published estate result pages use bounded self-canonicals", async () => {
  const cases = [
    [{ deal: "sale" }, "/listings?deal=sale"],
    [{ deal: "rent", district: "ting-kau" }, "/listings?deal=rent&district=ting-kau"],
    [{ deal: "rent", estate: "bellagio", page: 2 }, "/listings?deal=rent&estate=bellagio&page=2"],
    [{ estate: "bellagio" }, "/listings?estate=bellagio"],
  ];
  for (const [search, path] of cases) {
    const { head } = await headFor(search);
    assert.equal(canonical(head), `https://example.test${path}`);
    assert.equal(ogUrl(head), canonical(head));
    assert.equal(robots(head), undefined);
  }
});

test("arbitrary searches stay usable but do not expose terms in head URLs or become indexable", async () => {
  const cases = [
    { keyword: "person@example.test", page: 2 },
    { deal: "sale", minPrice: 4_000_000 },
    { bedrooms: 3 },
    { minArea: 0 },
    { sort: "price_asc", page: 2 },
    { agent: "private-agent-id" },
    { estate: "unknown-estate" },
    { district: "unknown-district" },
    { district: "sham-tseng", estate: "bellagio" },
  ];
  for (const search of cases) {
    const { head } = await headFor(search);
    assert.equal(robots(head), "noindex,follow", JSON.stringify(search));
    assert.equal(canonical(head), undefined, JSON.stringify(search));
    assert.equal(ogUrl(head), "https://example.test/listings", JSON.stringify(search));
    assert.doesNotMatch(JSON.stringify(head), /person@example\.test|private-agent-id/);
  }
  const { query } = await headFor({ keyword: "person@example.test" });
  assert.equal(query.keyword, "person@example.test");
});

test("complex filters and pagination still reach the listing query unchanged", async () => {
  const search = {
    deal: "rent",
    district: "sham-tseng",
    estate: "bellagio",
    keyword: "海景",
    minPrice: 12_000,
    maxPrice: 30_000,
    minArea: 500,
    maxArea: 900,
    bedrooms: 3,
    agent: "test-agent",
    sort: "price_asc",
    page: 2,
  };
  const { query, head } = await headFor(search);
  assert.equal(robots(head), "noindex,follow");
  assert.deepEqual(query, {
    deal: "rent",
    keyword: "海景",
    districtSlug: "sham-tseng",
    minPrice: 12_000,
    maxPrice: 30_000,
    minArea: 500,
    maxArea: 900,
    bedrooms: 3,
    estateSlug: "bellagio",
    agentId: "test-agent",
    sort: "price_asc",
    page: 2,
    pageSize: 12,
  });
});

test("an unresolved loader does not noindex the listings hub", () => {
  const route = routeFunctions({ rows: [], total: 0 }, []);
  const head = route.head({ loaderData: undefined });
  assert.equal(robots(head), undefined);
  assert.equal(canonical(head), "https://example.test/listings");
});

test("empty pages, including page numbers past the results, stay noindexed", async () => {
  for (const result of [
    { rows: [], total: 0 },
    { rows: [], total: 36 },
  ]) {
    const { head } = await headFor({ page: 99 }, result);
    assert.equal(robots(head), "noindex,follow");
  }
});
