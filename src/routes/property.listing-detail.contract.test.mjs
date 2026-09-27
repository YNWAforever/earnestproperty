import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Plain data/logic module, no JSX -- importable directly under Node's native
// type stripping (same approach src/content/castle-peak-road.test.mjs and
// src/lib/neon/corridor-scope.contract.test.mjs already use), so the Task 7
// transport-matching tests below exercise the real function rather than a
// source-scan reimplementation of its logic.
import { findCastlePeakRoadSegmentByDistrictSlug } from "../content/castle-peak-road.ts";

// Source-scan regression tests for Task 6 (gallery a11y/keyboard nav,
// freshness stamp, withdrawn/unavailable state) on /property/$listingNo.
// This repo has no render harness for this route (confirmed: no existing
// test file exercised property.$listingNo.tsx's component tree before this
// one), so -- matching listings.contract.test.mjs's established pattern --
// most assertions below run against the raw source text, and the handful of
// pure-logic pieces (the loader's status branching, head()'s noindex gate,
// the gallery's wrap-around stepper) are extracted and actually executed
// via ts.transpileModule so a behavioral regression fails the test rather
// than just a string no longer matching.
const routeSource = await readFile(new URL("./property.$listingNo.tsx", import.meta.url), "utf8");
const serverSource = await readFile(
  new URL("../lib/neon/public-data.server.ts", import.meta.url),
  "utf8",
);

const publicHelperSource = (
  await readFile(new URL("../lib/property-public.ts", import.meta.url), "utf8")
)
  .replace(/^import .*;$/gm, "")
  .replace(/export /g, "");

/** Strip a module's imports and `export ` keywords so it can be concatenated
 * into a transpiled snippet, the same way publicHelperSource is. */
const inlineModule = async (relativePath) =>
  (await readFile(new URL(relativePath, import.meta.url), "utf8"))
    .replace(/^import\s[\s\S]*?;$/gm, "")
    .replace(/^export type [\s\S]*?^};$/gm, "")
    .replace(/export declare /g, "")
    .replace(/export /g, "");

// head() now builds its title/description with listingSeo(), so the snippet
// needs the generator and the width budget it depends on, not just the four
// stubs it used to get. Inlined rather than stubbed so the executed head is
// the real one -- a stub would have let the generator regress unnoticed here.
const formatModuleSource = await inlineModule("../lib/format.ts");
const seoBudgetSource = await inlineModule("../content/seo-budget.js");
const listingSeoSource = await inlineModule("../lib/listing-seo.ts");

function transpileAndRun(snippet) {
  const { outputText } = ts.transpileModule(snippet, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const exportsObj = {};
  new Function("exports", outputText)(exportsObj);
  return exportsObj;
}

// --- fetchPropertyByListingNo no longer hardcodes status = 'active' ------

function extractServerFn(name, nextExportMarker) {
  const startNeedle = `export async function ${name}(`;
  const start = serverSource.indexOf(startNeedle);
  assert.ok(start !== -1, `expected to find ${startNeedle} in public-data.server.ts`);
  const end = serverSource.indexOf(nextExportMarker, start + startNeedle.length);
  assert.ok(end !== -1, `expected to find "${nextExportMarker}" after ${name}`);
  return serverSource.slice(start, end);
}

test("detail lookup preserves aliases and unavailable-state selection", () => {
  const body = extractServerFn(
    "fetchPropertyByListingNo",
    "export async function fetchPropertyByLegacyDetailId",
  );
  assert.match(body, /requested\.listing_no = \$1 OR requested_public\.public_listing_no = \$1/);
  assert.match(body, /offering_rank = 1/);
  assert.doesNotMatch(
    body,
    /WHERE current_offerings\.status = 'active'/,
    "sold/rented details must remain resolvable when no active offering remains",
  );
});

test("public inventory requires latest active offerings while legacy aliases remain resolvable", () => {
  assert.match(serverSource, /const where = \["p\.status = 'active'"\];/);
  const legacy = extractServerFn(
    "fetchPropertyByLegacyDetailId",
    "export async function fetchSimilarListings",
  );
  assert.match(legacy, /legacy\.legacy_detail_id = \$1/);
  assert.match(legacy, /offering_rank = 1/);
  assert.match(legacy, /status = 'active'/);
});

// --- Loader: active/sold/rented resolve; offline/inactive/draft 404 ------

function buildLoader() {
  const unavailableMatch = routeSource.match(/const UNAVAILABLE_STATUSES = new Set\(\[[^\]]*\]\);/);
  assert.ok(unavailableMatch, "expected UNAVAILABLE_STATUSES definition");
  const startNeedle = "loader: async ({ params }) => {";
  const bodyStart = routeSource.indexOf(startNeedle) + startNeedle.length;
  assert.ok(bodyStart > startNeedle.length - 1, "expected the route loader");
  const returnMarker = "return { property, similar, txns, branches, enquiryLinks };";
  const returnIdx = routeSource.indexOf(returnMarker, bodyStart);
  assert.ok(returnIdx !== -1, "expected the loader's final return statement");
  const body = routeSource.slice(bodyStart, returnIdx + returnMarker.length);

  const snippet = `
${unavailableMatch[0]}
async function loader(params, deps) {
  const { fetchPropertyByListingNo, notFound, redirect, fetchSimilarListings, fetchEstateTransactions, fetchNeonBranches, resolveWhatsappLinks = async()=>({enabled:false,links:[],fallbackHref:null,actions:[]}), activePropertyOfferings = p=>p.offerings??[p], publicPropertyNo=p=>p.public_listing_no??p.listing_no, publicPropertyTitle=p=>p.title_zh??"", sanitizeListingText=s=>s, resolvePublicWaAction=offer=>({href:"/contact",mode:"contact",publicListingNo:offer.publicListingNo,dealType:offer.dealType}), resolveWebsiteActions=offers=>({actions:offers.map(offer=>({href:"/contact",mode:"contact",publicListingNo:offer.publicListingNo,dealType:offer.dealType}))}) } = deps;
  const SITE_CONTACT = { whatsappPhone: "" };
  ${body}
}
exports.loader = loader;
`;
  return transpileAndRun(snippet).loader;
}

test("loader: active/sold/rented resolve normally and still fetch similar listings + transactions + branches", async () => {
  const loader = buildLoader();
  for (const status of ["active", "sold", "rented"]) {
    const similarCalls = [];
    const txnsCalls = [];
    const branchesCalls = [];
    const property = { status, estate_id: "estate-1", deal_type: "sale", id: "prop-1" };
    const deps = {
      fetchPropertyByListingNo: async () => property,
      notFound: () => new Error("unexpected notFound()"),
      fetchSimilarListings: async (...args) => {
        similarCalls.push(args);
        return [];
      },
      fetchEstateTransactions: async (...args) => {
        txnsCalls.push(args);
        return [];
      },
      fetchNeonBranches: async () => {
        branchesCalls.push([]);
        return [
          {
            id: "b1",
            slug: "lido",
            name: "麗都分行",
            address: null,
            phone: null,
            whatsapp: null,
            photo: null,
          },
        ];
      },
    };
    const result = await loader({ listingNo: "X1" }, deps);
    assert.equal(result.property, property, `expected status="${status}" to resolve, not 404`);
    assert.equal(
      similarCalls.length,
      1,
      `expected fetchSimilarListings to still run for status="${status}" (estate_id/deal_type are known even for a non-active property)`,
    );
    assert.equal(
      txnsCalls.length,
      1,
      `expected fetchEstateTransactions to still run for status="${status}"`,
    );
    assert.equal(
      branchesCalls.length,
      1,
      `expected fetchNeonBranches to still run for status="${status}"`,
    );
    assert.deepEqual(result.branches, [
      {
        id: "b1",
        slug: "lido",
        name: "麗都分行",
        address: null,
        phone: null,
        whatsapp: null,
        photo: null,
      },
    ]);
  }
});

test("loader: a failed branches fetch degrades to an empty list rather than failing the whole property page", async () => {
  const loader = buildLoader();
  const property = { status: "active", estate_id: "estate-1", deal_type: "sale", id: "prop-1" };
  const deps = {
    fetchPropertyByListingNo: async () => property,
    notFound: () => new Error("unexpected notFound()"),
    fetchSimilarListings: async () => [],
    fetchEstateTransactions: async () => [],
    fetchNeonBranches: async () => {
      throw new Error("Neon blip");
    },
  };
  const result = await loader({ listingNo: "X1" }, deps);
  assert.deepEqual(result.branches, []);
});

test("loader: offline/inactive/draft (and a missing listing_no) throw notFound before fetching similar/transactions", async () => {
  const loader = buildLoader();
  const NOT_FOUND = { marker: "not-found" };

  for (const status of ["offline", "inactive", "draft"]) {
    const property = { status, estate_id: "estate-1", deal_type: "sale", id: "prop-1" };
    const deps = {
      fetchPropertyByListingNo: async () => property,
      notFound: () => NOT_FOUND,
      fetchSimilarListings: async () => {
        throw new Error(`fetchSimilarListings must not run for status="${status}"`);
      },
      fetchEstateTransactions: async () => {
        throw new Error(`fetchEstateTransactions must not run for status="${status}"`);
      },
      fetchNeonBranches: async () => {
        throw new Error(`fetchNeonBranches must not run for status="${status}"`);
      },
    };
    let caught;
    try {
      await loader({ listingNo: "X1" }, deps);
    } catch (err) {
      caught = err;
    }
    assert.equal(caught, NOT_FOUND, `expected status="${status}" to be treated as not-found`);
  }

  // A listing_no that matches no row at all behaves identically.
  const deps = {
    fetchPropertyByListingNo: async () => null,
    notFound: () => NOT_FOUND,
    fetchSimilarListings: async () => {
      throw new Error("fetchSimilarListings must not run when the property is null");
    },
    fetchEstateTransactions: async () => {
      throw new Error("fetchEstateTransactions must not run when the property is null");
    },
    fetchNeonBranches: async () => {
      throw new Error("fetchNeonBranches must not run when the property is null");
    },
  };
  let caught;
  try {
    await loader({ listingNo: "does-not-exist" }, deps);
  } catch (err) {
    caught = err;
  }
  assert.equal(caught, NOT_FOUND);
});

// --- head(): noindex only for sold/rented --------------------------------

function buildHead() {
  const unavailableMatch = routeSource.match(/const UNAVAILABLE_STATUSES = new Set\(\[[^\]]*\]\);/);
  assert.ok(unavailableMatch);
  // listing-seo.ts declares the same set (its copy decides whether the title
  // says 已售出/已租出) and is inlined below, so the snippet would silently use
  // the module's copy if the two ever diverged. Pin them equal instead.
  const moduleUnavailable = listingSeoSource.match(
    /const UNAVAILABLE_STATUSES = new Set\(\[[^\]]*\]\);/,
  );
  assert.ok(moduleUnavailable, "expected listing-seo.ts to declare UNAVAILABLE_STATUSES");
  assert.equal(
    moduleUnavailable[0],
    unavailableMatch[0],
    "src/lib/listing-seo.ts and the route must agree on which statuses are unavailable",
  );
  const startNeedle = "head: ({ loaderData }) => {";
  const bodyStart = routeSource.indexOf(startNeedle) + startNeedle.length;
  assert.ok(bodyStart > startNeedle.length - 1, "expected the route head()");
  const linksMarkerIdx = routeSource.indexOf("links: [canonical],", bodyStart);
  assert.ok(linksMarkerIdx !== -1);
  const closeIdx = routeSource.indexOf("};", linksMarkerIdx) + 2;
  const body = routeSource.slice(bodyStart, closeIdx);

  const snippet = `
const SITE_URL = "https://example.test";
function canonicalLink(path) { return { rel: "canonical", href: SITE_URL + path }; }
${formatModuleSource}
${publicHelperSource}
${seoBudgetSource}
${listingSeoSource}
function head({ loaderData }) {
  ${body}
}
exports.head = head;
`;
  return transpileAndRun(snippet).head;
}

test("head(): sold/rented carry a noindex,follow robots meta; active does not", () => {
  const head = buildHead();
  const base = {
    listing_no: "X1",
    title_zh: "測試盤源",
    deal_type: "sale",
    rent: null,
    price: 8000000,
    description: "描述",
    images: ["https://example.test/1.jpg"],
  };

  const activeResult = head({ loaderData: { property: { ...base, status: "active" } } });
  assert.equal(
    activeResult.meta.some((m) => m.name === "robots"),
    false,
    "active listing must not be noindex'd",
  );

  for (const status of ["sold", "rented"]) {
    const result = head({ loaderData: { property: { ...base, status } } });
    const robots = result.meta.find((m) => m.name === "robots");
    assert.ok(robots, `expected a robots meta for status="${status}"`);
    assert.equal(robots.content, "noindex,follow");
  }
});

// --- Withdrawn/unavailable render branch ----------------------------------

test("sidebar and mobileContact both swap to PropertyUnavailableNotice when isUnavailable, instead of the enquiry form/contact CTAs", () => {
  const sidebarStart = routeSource.indexOf("sidebar={");
  const sidebarEnd = routeSource.indexOf("\n      />", sidebarStart);
  const sidebarBody = routeSource.slice(sidebarStart, sidebarEnd);
  assert.match(sidebarBody, /isUnavailable \? \(\s*<PropertyUnavailableNotice/);
  assert.match(sidebarBody, /<PropertyDecisionActions/);
  assert.match(sidebarBody, /<form onSubmit={handleSubmit}/);

  const mobileStart = routeSource.indexOf("mobileContact={");
  const mobileEnd = routeSource.indexOf("details={", mobileStart);
  const mobileBody = routeSource.slice(mobileStart, mobileEnd);
  assert.match(mobileBody, /isUnavailable \? \(\s*<PropertyUnavailableNotice/);
  assert.match(mobileBody, /<PropertyMobileContactSummary/);
});

test("PropertyUnavailableNotice links to /listings filtered by the listing's own deal type and estate", () => {
  const start = routeSource.indexOf("function PropertyUnavailableNotice(");
  assert.ok(start !== -1);
  const body = routeSource.slice(start, start + 1200);
  assert.match(body, /to="\/listings"/);
  assert.match(body, /search={{ deal: dealType, estate: estateSlug \?\? undefined, page: 1 }}/);
});

test("a destructive badge marks the unavailable state next to the deal-type badge", () => {
  assert.match(routeSource, /const isUnavailable = UNAVAILABLE_STATUSES\.has\(property\.status\);/);
  assert.match(
    routeSource,
    /isUnavailable \? <Badge variant="destructive">\{unavailableLabel\}<\/Badge> : null/,
  );
});

// --- Freshness stamp --------------------------------------------------------

test("FreshnessStamp replaces the raw formatHkDate(property.updated_at) '最後更新' line", () => {
  assert.match(routeSource, /from "@\/components\/layout\/FreshnessStamp"/);
  assert.match(routeSource, /<FreshnessStamp updatedAt={property\.updated_at} \/>/);
  assert.doesNotMatch(routeSource, /formatHkDate\(property\.updated_at\)/);
  assert.doesNotMatch(routeSource, /最後更新：/);
  // formatHkDate is still used elsewhere on this page (transaction dates) --
  // only the property.updated_at call site was replaced.
  assert.match(routeSource, /formatHkDate\(t\.deal_date\)/);
});

// --- Gallery: keyboard nav + every image reachable -------------------------

test("the >5-photos bug is fixed: thumbnails map over ALL images, not images.slice(0, 5)", () => {
  assert.doesNotMatch(routeSource, /images\.slice\(0, 5\)/);
  const galleryStart = routeSource.indexOf('<TabsContent value="photos"');
  const galleryEnd = routeSource.indexOf("</TabsContent>", galleryStart);
  const galleryBody = routeSource.slice(galleryStart, galleryEnd);
  assert.match(galleryBody, /\{images\.map\(\(src, i\) => \(/);
  // Horizontally-scrollable strip, per the plan's option 1, is how every
  // thumbnail stays reachable once there are more than 5 photos.
  assert.match(galleryBody, /overflow-x-auto/);
});

test("gallery main viewer is keyboard-focusable and wires Left/Right arrow keys to stepImage", () => {
  const galleryStart = routeSource.indexOf('<TabsContent value="photos"');
  const galleryEnd = routeSource.indexOf("</TabsContent>", galleryStart);
  const galleryBody = routeSource.slice(galleryStart, galleryEnd);
  assert.match(galleryBody, /onKeyDown={handleGalleryKeyDown}/);
  assert.match(galleryBody, /tabIndex={images\.length > 1 \? 0 : undefined}/);
  assert.match(routeSource, /function handleGalleryKeyDown\(/);
  assert.match(routeSource, /e\.key === "ArrowLeft"/);
  assert.match(routeSource, /e\.key === "ArrowRight"/);
  assert.match(routeSource, /stepImage\(-1\)/);
  assert.match(routeSource, /stepImage\(1\)/);
});

test("stepImage wraps in both directions across the FULL image count (not capped at 5)", () => {
  const match = routeSource.match(
    /setActiveImg\(\(i\) => (\(i \+ delta \+ images\.length\) % images\.length)\);/,
  );
  assert.ok(match, "expected stepImage's wrap-around updater expression");
  const evalStep = (i, delta, imagesLength) =>
    new Function("i", "delta", "images", `return ${match[1]};`)(i, delta, { length: imagesLength });

  // 7 images (> the old cap of 5): stepping backward from the first image
  // wraps to the last, and forward from the last wraps to the first.
  assert.equal(evalStep(0, -1, 7), 6);
  assert.equal(evalStep(6, 1, 7), 0);
  // A plain forward/backward step in the middle of a >5-image set.
  assert.equal(evalStep(3, 1, 7), 4);
  assert.equal(evalStep(3, -1, 7), 2);
});

test("active thumbnail carries aria-current, not just a border-color change", () => {
  const galleryStart = routeSource.indexOf('<TabsContent value="photos"');
  const galleryEnd = routeSource.indexOf("</TabsContent>", galleryStart);
  const galleryBody = routeSource.slice(galleryStart, galleryEnd);
  assert.match(galleryBody, /aria-current={i === activeImg \? "true" : undefined}/);
  // The border-color signal stays too (visual reinforcement), it's just no
  // longer the ONLY signal.
  assert.match(galleryBody, /i === activeImg \? "border-primary" : "border-transparent"/);
});

// --- Task 7: cash-required-at-closing summary (component-level regression --
// see PropertyDecisionActions.test.tsx for the actual arithmetic assertion --
// this just checks the route wires the summing card in, since the sum itself
// lives inside PropertyDecisionActions, not this route file) --------------

test("the sidebar's mortgage teaser is PropertyDecisionActions, which now also renders the cash-required summary", () => {
  // Task 7 extends the *existing* mortgage teaser card (data-property-mortgage-card
  // in PropertyDecisionActions.tsx) rather than adding a second, independent
  // calculateMortgage() call site on this route -- confirm no such second call
  // site was introduced here.
  assert.doesNotMatch(routeSource, /calculateMortgage\(/);
  assert.match(routeSource, /<PropertyDecisionActions/);
});

// --- Task 7: nearby transport section --------------------------------------

test("findCastlePeakRoadSegmentByDistrictSlug resolves a property's district_slug to its corridor segment, or null when unmatched", () => {
  // Own top-level slug -- the simple case.
  assert.equal(findCastlePeakRoadSegmentByDistrictSlug("ting-kau")?.slug, "ting-kau");
  // A district_slug a segment absorbed into its own districtSlugs list without
  // becoming a same-named segment of its own (see the sham-tseng segment's
  // districtSlugs in castle-peak-road.ts).
  assert.equal(findCastlePeakRoadSegmentByDistrictSlug("tsing-lung-tau")?.slug, "sham-tseng");
  assert.equal(findCastlePeakRoadSegmentByDistrictSlug("castle-peak-road")?.slug, "sham-tseng");
  // A district_slug with no corridor segment at all (and the null/undefined
  // no-district case) resolves to null, not a placeholder-shaped object.
  assert.equal(findCastlePeakRoadSegmentByDistrictSlug("mong-kok"), null);
  assert.equal(findCastlePeakRoadSegmentByDistrictSlug(null), null);
  assert.equal(findCastlePeakRoadSegmentByDistrictSlug(undefined), null);
});

test("the property page uses exact estate transport and a neutral fallback", () => {
  assert.match(routeSource, /resolveEstateTransport\(estate\.slug\)/);
  assert.doesNotMatch(routeSource, /findCastlePeakRoadSegmentByDistrictSlug\(/);
  const cardStart = routeSource.indexOf("data-property-transport-card");
  assert.ok(cardStart !== -1);
  const gateStart = routeSource.lastIndexOf("{transportInfo && (", cardStart);
  assert.ok(gateStart !== -1 && gateStart < cardStart);
  const cardEnd = routeSource.indexOf(")}", cardStart);
  const cardBody = routeSource.slice(cardStart, cardEnd);
  assert.match(cardBody, /\{transportInfo\.text\}/);
  assert.match(cardBody, /params=\{\{ segment: transportInfo\.segmentSlug \}\}/);
  assert.match(routeSource, /data-property-transport-fallback/);
  assert.match(routeSource, /此屋苑的交通資料仍待核對/);
});

test("loader: optional similar listings and transactions fail independently without losing the primary listing", async () => {
  const loader = buildLoader();
  const property = { status: "active", estate_id: "estate-1", deal_type: "sale", id: "prop-1" };
  for (const failed of ["similar", "transactions"]) {
    const result = await loader(
      { listingNo: "X1" },
      {
        fetchPropertyByListingNo: async () => property,
        notFound: () => Error("unexpected"),
        fetchSimilarListings: async () => {
          if (failed === "similar") throw Error("optional failure");
          return [{ id: "similar" }];
        },
        fetchEstateTransactions: async () => {
          if (failed === "transactions") throw Error("optional failure");
          return [{ unit: "synthetic" }];
        },
        fetchNeonBranches: async () => [],
      },
    );
    assert.equal(result.property, property);
    assert.deepEqual(failed === "similar" ? result.similar : result.txns, []);
    assert.equal((failed === "similar" ? result.txns : result.similar).length, 1);
  }
});

test("legacy sale and rent URLs redirect to the same stable unit and preserve rent intent", async () => {
  const loader = buildLoader();
  for (const suffix of ["S", "R"]) {
    const property = {
      status: "active",
      public_listing_no: "B054645",
      listing_no: "B054645-6782226-S",
    };
    let options;
    const marker = new Error("redirect");
    await assert.rejects(
      loader(
        { listingNo: `B054645-6782226-${suffix}` },
        {
          fetchPropertyByListingNo: async () => property,
          redirect: (input) => {
            options = input;
            return marker;
          },
        },
      ),
      (error) => error === marker,
    );
    assert.equal(options.statusCode, 301);
    assert.equal(options.params.listingNo, "B054645");
    assert.equal(options.search({}).deal, suffix === "R" ? "rent" : "sale");
  }
});

test("head canonical points to the unit even when representative offering changes", () => {
  const result = buildHead()({
    loaderData: {
      property: {
        status: "active",
        public_listing_no: "B054645",
        listing_no: "B054645-NEW-R",
        title_zh: "碧堤半島",
        deal_type: "rent",
        price: null,
        rent: 18500,
      },
    },
  });
  assert.equal(result.links[0].href, "https://example.test/property/B054645");
  assert.equal(
    result.meta.find((meta) => meta.property === "og:url")?.content,
    result.links[0].href,
  );
});

test("selected sale and rent retain shared page copy and separate sanitized notes", async () => {
  const start = routeSource.indexOf("  const selectedDeal =");
  const end = routeSource.indexOf("  const safeAddress =", start);
  assert.ok(start >= 0 && end > start);
  const formatSource = (
    await readFile(new URL("../lib/format.ts", import.meta.url), "utf8")
  ).replace(/export /g, "");
  const { project } = transpileAndRun(
    `${formatSource}\n${publicHelperSource}\nfunction project(baseProperty,search){${routeSource.slice(start, end)}\nreturn {property,safeDescription,safeOfferingDescription:typeof safeOfferingDescription==='undefined'?null:safeOfferingDescription};}\nexports.project=project;`,
  );
  const sale = {
    id: "sale",
    listing_no: "P-S",
    deal_type: "sale",
    price: 6700000,
    rent: null,
    status: "active",
    description: "Sale A",
  };
  const rent = {
    id: "rent",
    listing_no: "P-R",
    deal_type: "rent",
    price: null,
    rent: 18000,
    status: "active",
    description: '"Rent B"',
  };
  const base = { ...sale, title_zh: "Property", description: "Shared C", offerings: [sale, rent] };
  for (const deal of ["sale", "rent"]) {
    const view = project(base, { deal });
    assert.equal(view.safeDescription, "Shared C");
    assert.equal(view.property.id, deal, "inquiry retains selected offering row");
    assert.equal(view.safeOfferingDescription, deal === "sale" ? "Sale A" : "Rent B");
  }
  assert.equal(project({ ...base, description: null }, { deal: "rent" }).safeDescription, null);
  assert.equal(
    project({ ...base, description: "Sale A" }, { deal: "sale" }).safeOfferingDescription,
    null,
    "matching note is not duplicated",
  );
  assert.equal(
    project({ ...base, offerings: [{ ...sale, description: "NaN" }] }, { deal: "sale" })
      .safeOfferingDescription,
    null,
    "malformed note is suppressed",
  );
  assert.match(routeSource, /safeOfferingDescription\s*&&/);
  assert.match(routeSource, /\{safeOfferingDescription\}/);
});

test("tracking resolver failure retains public listing and uses company contact fallback", async () => {
  const loader = buildLoader();
  const property = {
    id: "p",
    listing_no: "G1",
    status: "active",
    deal_type: "sale",
    estate_id: null,
  };
  const result = await loader(
    { listingNo: "G1" },
    {
      fetchPropertyByListingNo: async () => property,
      fetchSimilarListings: async () => [],
      fetchEstateTransactions: async () => [],
      fetchNeonBranches: async () => [],
      resolveWhatsappLinks: async () => {
        throw new Error("configuration unavailable");
      },
    },
  );
  assert.equal(result.property, property);
  assert.equal(result.enquiryLinks.actions[0].href, "/contact");
});
