import {
  DESCRIPTION_MAX_UNITS,
  DESCRIPTION_MIN_UNITS,
  TITLE_MAX_UNITS,
  displayWidth,
  truncateToWidth,
} from "@/content/seo-budget.js";
import { formatArea, formatManDisplay, formatHkd, formatPsf, sanitizeListingText } from "./format";
import { activePropertyOfferings, publicPropertyNo } from "./property-public";

/**
 * Deterministic SEO 標題 / SEO 描述 for a listing detail page.
 *
 * ## The gap this closes
 *
 * `properties.seo_title` / `seo_description` are the CMS fields staff fill in
 * by hand (admin.cms.tsx, PropertyForm.tsx). Nothing populates them for a
 * machine-ingested listing -- neither 20260907120000_propertyhk_ingestion_v2.sql
 * nor any other migration writes those columns -- so for the great majority of
 * `/property/*` pages the head fell back to:
 *
 *   title:       `${title_zh}｜${priceSummary}｜晉誠地產`
 *   description: `(seo_description ?? description).slice(0, 150)`
 *
 * Two defects follow. The description was a 150-**character** slice of the
 * source's free-text body, so it cut mid-clause and, when `description` was
 * null too, degraded to `${title}  ${price}` -- a description that is just the
 * title again. And the derived title carried nothing the source title did not,
 * so two 3-房 units in the same estate at the same price produced byte-identical
 * heads: duplicate content across the site's highest-intent URLs.
 *
 * ## What this does instead
 *
 * Assembles both strings from the listing's own structured columns -- estate
 * name, floor, bedrooms, saleable area, orientation, features, deal type and
 * price -- in priority order, appending a segment only while it fits the SERP
 * width budget (src/content/seo-budget.js). Facts are never invented: every
 * segment is dropped when its column is null, which is why the assembler is
 * priority-ordered rather than a fixed template string.
 *
 * A hand-written CMS value still wins outright. That is the point of the CMS
 * field, and it is what estate.$slug.tsx already does with `estates.seo_title`.
 */

/** Mirrors /listings' and /agents' own DISTRICT_LABELS -- the same four
 * districts and display strings. Kept as a local copy for the same reason
 * agents.tsx documents: four string literals are not worth one route reaching
 * into another's internals. */
const DISTRICT_LABELS: Record<string, string> = {
  "sham-tseng": "深井",
  "ting-kau": "汀九",
  "tsuen-wan": "荃灣",
  "castle-peak-road": "青山公路",
};

const BRAND_SUFFIX = "｜晉誠地產";
const LICENCE = "C-018613";

export type ListingSeoInput = {
  listing_no: string;
  public_listing_no?: string | null;
  title_zh?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  description?: string | null;
  deal_type?: string | null;
  price?: number | null;
  rent?: number | null;
  status?: string | null;
  offerings?: ReadonlyArray<{
    id?: string;
    listing_no?: string;
    deal_type: "sale" | "rent";
    price: number | null;
    rent: number | null;
    status: string;
  }> | null;

  /** The joined estate snapshot the listing SELECT already returns
   * (`e.name_zh AS estate_name_zh` etc., mapped to this nested shape by
   * public-data.server.ts). Null for a listing not linked to an estate. */
  estates?: { name_zh?: string | null; district_slug?: string | null } | null;
  district_slug?: string | null;
  saleable_area?: number | null;
  gross_area?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  floor?: string | number | null;
  orientation?: string | null;
  features?: readonly string[] | null;
};

function text(value: unknown): string | null {
  return typeof value === "string" ? sanitizeListingText(value) : null;
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function districtLabel(input: ListingSeoInput): string | null {
  const slug = text(input.district_slug) ?? text(input.estates?.district_slug);
  if (!slug) return null;
  return DISTRICT_LABELS[slug] ?? null;
}

/**
 * "高層" / "中層" / "低層" arrive as-is from the source; a bare number is a
 * floor number and needs the 樓 measure word to read as one. Anything else
 * (a block name, a stray token) is dropped rather than guessed at.
 */
function floorLabel(value: unknown): string | null {
  const raw = typeof value === "number" ? String(value) : text(value);
  if (!raw) return null;
  if (/^\d{1,3}$/.test(raw)) return `${raw} 樓`;
  if (/^(高|中|低)層$/.test(raw)) return raw;
  return null;
}

function bedroomLabel(value: unknown): string | null {
  const bedrooms = positive(value);
  if (bedrooms === null) return null;
  return Number.isInteger(bedrooms) ? `${bedrooms} 房` : null;
}

/**
 * The deal + price segment, in the register a Hong Kong portal uses ("售
 * $1,180萬" / "租 $18,000"). A listing with both an active sale and an active
 * rent offering says so, because that is a genuine selling point and the
 * on-page copy (propertyDealLabel) already calls it 可買可租.
 */
function priceLabel(input: ListingSeoInput): string | null {
  const offerings = activePropertyOfferings({
    id: undefined,
    listing_no: input.listing_no,
    public_listing_no: input.public_listing_no ?? undefined,
    deal_type: input.deal_type ?? "sale",
    price: input.price ?? null,
    rent: input.rent ?? null,
    status: input.status ?? "active",
    // activePropertyOfferings' PublicOffering requires a non-optional id; the
    // mapper always supplies one, and it is never read here.
    offerings: input.offerings
      ? input.offerings.map((offering) => ({
          ...offering,
          id: offering.id ?? "",
          listing_no: offering.listing_no ?? input.listing_no,
        }))
      : undefined,
  });
  const parts: string[] = [];
  for (const offering of offerings) {
    if (offering.deal_type === "rent") {
      const rent = formatHkd(offering.rent);
      if (rent) parts.push(`租 ${rent}`);
    } else {
      const man = formatManDisplay(offering.price);
      if (man) parts.push(`售 $${man}`);
    }
  }
  // Dedupe: a group can carry two sale offerings at the same asking price.
  return [...new Set(parts)].join("、") || null;
}

/**
 * Append `｜`-joined segments in priority order, keeping the brand suffix
 * reserved so it is never the thing that gets dropped. A segment that does not
 * fit is skipped rather than truncated -- half a fact reads worse than no fact.
 *
 * Segments already present in the accumulated title are skipped too. Source
 * titles routinely restate the facts held in the structured columns ("深井放盤"
 * with district_slug `sham-tseng`, "青山公路獨立屋 4房" with bedrooms 4), and
 * without this the assembler produced 深井放盤｜深井放盤.
 */
function assembleTitle(head: string, segments: Array<string | null>): string {
  const budget = TITLE_MAX_UNITS - displayWidth(BRAND_SUFFIX);
  let title = truncateToWidth(head, budget);
  for (const segment of segments) {
    if (!segment) continue;
    if (restates(title, segment)) continue;
    const candidate = `${title}｜${segment}`;
    if (displayWidth(candidate) <= budget) title = candidate;
  }
  return `${title}${BRAND_SUFFIX}`;
}

/**
 * Whether `segment` would restate what `existing` already says.
 *
 * Compares with spaces stripped, because the structured columns render
 * "4 房" where a source title writes "4房" -- the same fact, and appending both
 * reads as a template glitch to anyone scanning a result page.
 */
function restates(existing: string, segment: string): boolean {
  const flat = (value: string) => value.replace(/\s+/g, "");
  const haystack = flat(existing);
  const needle = flat(segment);
  if (!needle) return true;
  if (haystack.includes(needle)) return true;
  // A composite segment ("高層 3 房") is a restatement only when every one of
  // its own parts already appears; "高層" alone in the title should not
  // suppress the bedroom count.
  const parts = segment
    .split(/[\s、]+/)
    .filter(Boolean)
    .map(flat);
  return parts.length > 1 && parts.every((part) => haystack.includes(part));
}

/**
 * The SEO 標題 for a listing detail page.
 *
 * A hand-written `seo_title` is used verbatim (plus the brand suffix, matching
 * the behaviour it replaces). Otherwise: estate name, then the unit's own
 * distinguishing facts, then the deal/price, then the district.
 */
export function listingSeoTitle(input: ListingSeoInput): string {
  const authored = text(input.seo_title);
  if (authored) return `${authored}${BRAND_SUFFIX}`;

  const estate = text(input.estates?.name_zh);
  const sourceTitle = text(input.title_zh);
  const district = districtLabel(input);
  const head = estate ?? sourceTitle ?? (district ? `${district}放盤` : "放盤");

  // Unit spec first: it is what separates two listings in the same estate, and
  // "碧堤半島 高層 3 房" is the phrase a buyer actually searches.
  const spec = [floorLabel(input.floor), bedroomLabel(input.bedrooms)].filter(Boolean).join(" ");
  const area = formatArea(positive(input.saleable_area) ?? positive(input.gross_area));
  const distinguishing = Boolean(spec) || Boolean(area);

  return assembleTitle(head, [
    spec || null,
    priceLabel(input),
    district ? `${district}放盤` : null,
    // Only reached when the estate name is short enough to leave room; the
    // source title often repeats the estate, so it goes last.
    area ? `實用 ${area}` : null,
    // Uniqueness backstop, same rule as the description: two units in one
    // estate at one asking price with no floor and no area recorded produce
    // byte-identical titles otherwise, which is the duplicate-content case
    // this module exists to remove. Ordered ahead of the source title
    // deliberately -- when the two collide for the remaining budget, a
    // distinct title is worth more than a restatement of the estate name.
    distinguishing
      ? null
      : `編號 ${publicPropertyNo({
          listing_no: input.listing_no,
          public_listing_no: input.public_listing_no ?? undefined,
        })}`,
    estate && sourceTitle ? sourceTitle : null,
  ]);
}

/**
 * The SEO 描述 for a listing detail page.
 *
 * Sentences are appended while they fit the 160-unit snippet budget, in
 * descending order of what a searcher decides on. `seo_description` from the
 * CMS wins, and is width-trimmed on a clause boundary rather than sliced --
 * an over-long authored value is a truncation problem, not a reason to discard
 * the editor's work.
 */
export function listingSeoDescription(input: ListingSeoInput): string {
  const authored = text(input.seo_description);
  if (authored) return truncateToWidth(authored, DESCRIPTION_MAX_UNITS);

  const estate = text(input.estates?.name_zh);
  const sourceTitle = text(input.title_zh);
  const subject = estate ?? sourceTitle ?? "此盤源";
  const district = districtLabel(input);
  const publicNo = publicPropertyNo({
    listing_no: input.listing_no,
    public_listing_no: input.public_listing_no ?? undefined,
  });

  const floor = floorLabel(input.floor);
  const bedrooms = bedroomLabel(input.bedrooms);
  const bathrooms = positive(input.bathrooms) !== null ? `${input.bathrooms} 廁` : null;
  const orientation = text(input.orientation);
  const area = formatArea(positive(input.saleable_area));
  // formatPsf already carries the 呎 measure word ("$12,190 呎"), so labelling
  // it 實呎約 as well rendered "實呎約 $12,190 呎". 呎價 + the bare figure is how
  // a Hong Kong listing states it.
  const psf = formatPsf(positive(input.price), positive(input.saleable_area));
  const psfFigure = psf ? psf.replace(/\s*呎$/, "") : null;
  const price = priceLabel(input);
  const features = (input.features ?? [])
    .map((feature) => text(feature))
    .filter((feature): feature is string => Boolean(feature))
    .slice(0, 2);

  // The sign-off every other description on the site carries. Reserved out of
  // the budget before anything else is appended, so a long body or a long
  // feature list can never be what drops the call to action.
  const cta = `WhatsApp 即時預約睇樓。晉誠地產 ${LICENCE}。`;
  const bodyBudget = DESCRIPTION_MAX_UNITS - displayWidth(cta);

  const sentences: string[] = [];

  // 1. What the unit is, and where. `subject` always resolves, so this
  //    sentence is never empty -- there is no path to an empty description.
  //    Spec parts the subject already states are dropped: a source title used
  //    as the subject ("青山公路獨立屋 4房 連花園") otherwise produced
  //    "…連花園 4 房單位".
  const spec = [floor, bedrooms]
    .filter((part): part is string => Boolean(part) && !restates(subject, part as string))
    .join(" ");
  const opening = district ? `${district}${subject}` : subject;
  sentences.push(spec ? `${opening} ${spec}單位。` : `${opening}放盤。`);

  // 2. The measurable facts, in the order a searcher screens on.
  const measures = [area ? `實用 ${area}` : null, orientation, bathrooms]
    .filter(Boolean)
    .join("，");
  if (measures) sentences.push(`${measures}。`);

  // 3. Money.
  const money = [price, psfFigure ? `呎價 ${psfFigure}` : null].filter(Boolean).join("，");
  if (money) sentences.push(`${money}。`);

  // 4. The source's own selling points, capped at two so one listing's long
  //    feature list cannot crowd out the rest.
  if (features.length) sentences.push(`${features.join("、")}。`);

  let description = "";
  for (const sentence of sentences) {
    // Skip rather than truncate, and skip a sentence whose facts the copy
    // already states -- a source title used as `subject` often repeats them.
    if (restates(description, sentence.replace(/[。]/g, ""))) continue;
    if (displayWidth(description + sentence) > bodyBudget) continue;
    description += sentence;
  }

  // 5. Body copy, but only as filler when the structured facts left the
  //    snippet thin -- and clause-trimmed, never mid-word sliced. This is what
  //    replaces the old `description.slice(0, 150)`.
  const body = text(input.description);
  if (body && displayWidth(description) < DESCRIPTION_MIN_UNITS) {
    const filler = truncateToWidth(body, bodyBudget - displayWidth(description) - 2);
    if (filler) description += `${filler}。`;
  }

  // 6. Uniqueness backstop. A unit with no floor, no area, no orientation and
  //    no features is indistinguishable from its neighbour in the same estate
  //    at the same asking price -- exactly the duplicate-snippet case this
  //    module exists to remove. The public listing number is the one fact that
  //    is always distinct, and is what a caller quotes on the phone anyway.
  // Measured on the raw facts, not the de-duplicated `spec`: a unit whose
  // bedroom count only reached the copy through its source title is still a
  // distinguishable unit.
  const distinguishing = Boolean(floor || bedrooms || area) || features.length > 0;
  if (
    !distinguishing &&
    displayWidth(`盤源編號 ${publicNo}。${description}${cta}`) <= DESCRIPTION_MAX_UNITS
  ) {
    description = `盤源編號 ${publicNo}。${description}`;
  }

  return `${description}${cta}`;
}

/** Both strings for one listing. */
export function listingSeo(input: ListingSeoInput): { title: string; description: string } {
  return { title: listingSeoTitle(input), description: listingSeoDescription(input) };
}
