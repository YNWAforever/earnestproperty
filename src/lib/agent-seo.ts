import {
  DESCRIPTION_MAX_UNITS,
  TITLE_MAX_UNITS,
  displayWidth,
  truncateToWidth,
} from "@/content/seo-budget.js";
import { estateRegistry } from "@/content/estate-registry";
import { authored } from "@/content/seo";
import { districtLabelForSlug } from "./listing-seo";

/**
 * SEO 標題 / SEO 描述 for an agent profile page.
 *
 * ## The gap this closes
 *
 * `/agents/<slug>` built its head from two fields:
 *
 *   title:       `${name}｜晉誠地產 Earnest Property`
 *   description: `${name} ${job_title ?? "晉誠地產專業代理"}，直接聯絡了解深井、
 *                 青山公路、汀九放盤、買樓及租樓服務。`
 *
 * So every profile shipped the same 30-character tail with only a name and a
 * role varying, and the title carried no role, no district and no 地產代理
 * head term at all. The loader already holds the branch, the bio, the
 * specialties, the served estates, the languages and the agent's own licence
 * number -- none of it reached the head.
 *
 * The `??` on `job_title` was the same empty-string defect `authored()` exists
 * for: a blank column won the fallback and the description rendered a stray
 * space where the role should be.
 *
 * ## What this does instead
 *
 * Names the agent, their role and the districts they actually serve (derived
 * from `served_estate_slugs` through the registry's real `districtSlug`, never
 * guessed), their branch, and the estates they are responsible for. Nothing is
 * invented: each part is dropped when its column is empty, and a profile with
 * no name at all gets honest agency copy instead of a stencil with a hole in
 * it.
 */

/** The agency's EAA licence, distinct from an individual agent's licence_no. */
const AGENCY_LICENCE = "C-018613";
const BRAND_SUFFIX = "｜晉誠地產";
/** The corridor the agency covers, for a profile with no served estates. */
const DEFAULT_AREA = "深井 青山公路 汀九";

export type AgentSeoInput = {
  name_zh?: string | null;
  name_en?: string | null;
  job_title?: string | null;
  licence_no?: string | null;
  /** Already resolved through agentBranchName() -- branch_id wins over the
   * free-text `branch`, and neither is defaulted. */
  branch_name?: string | null;
  bio?: string | null;
  specialties?: readonly string[] | null;
  served_estate_slugs?: readonly string[] | null;
};

function firstAuthored(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = authored(value);
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * The Chinese names of the estates this agent serves, in registry order, and
 * the districts those estates really sit in.
 *
 * Both come from estate-registry.ts rather than the slug text: a slug is not a
 * name, and `districtSlug` is the only verified district for an estate (the
 * same reason listing-seo.ts prefers `estates.district_slug`).
 */
function servedAreas(slugs: readonly string[] | null | undefined): {
  estates: string[];
  districts: string[];
} {
  const wanted = new Set((slugs ?? []).filter(Boolean));
  const estates: string[] = [];
  const districts: string[] = [];
  for (const entry of estateRegistry) {
    if (!wanted.has(entry.slug)) continue;
    estates.push(entry.nameZh);
    const label = districtLabelForSlug(entry.districtSlug);
    if (label && !districts.includes(label)) districts.push(label);
  }
  return { estates, districts };
}

export function agentSeo(input: AgentSeoInput): { title: string; description: string } {
  const name = firstAuthored(input.name_zh, input.name_en);
  const role = authored(input.job_title);
  const branch = authored(input.branch_name);
  const licence = authored(input.licence_no);
  const { estates, districts } = servedAreas(input.served_estate_slugs);
  const area = districts.length ? districts.join(" ") : DEFAULT_AREA;
  const specialties = (input.specialties ?? [])
    .map((value) => authored(value))
    .filter((value): value is string => Boolean(value));

  // A published profile can have both name columns empty. The old head then
  // shipped "專業代理｜晉誠地產 Earnest Property" -- a stencil with a hole in
  // it. Honest agency copy is better than a fake name.
  if (!name) {
    return {
      title: truncateToWidth(`晉誠地產持牌代理｜${area}買樓租樓`, TITLE_MAX_UNITS),
      description: truncateToWidth(
        `晉誠地產持牌地產代理，專營${area}買樓、租樓及放盤委託。WhatsApp 直接聯絡查詢在售及放租單位，即時安排睇樓及免費估價。${AGENCY_LICENCE}。`,
        DESCRIPTION_MAX_UNITS,
      ),
    };
  }

  const head = `${name}${role ? ` ${role}` : ""}`;
  // 地產代理 is the head term a searcher uses with an agent's name, and the
  // district is what makes the page local. Appended only while they fit.
  const budget = TITLE_MAX_UNITS - displayWidth(BRAND_SUFFIX);
  let title = truncateToWidth(head, budget);
  for (const segment of [`${area}地產代理`, "地產代理"]) {
    const candidate = `${title}｜${segment}`;
    if (displayWidth(candidate) <= budget) {
      title = candidate;
      break;
    }
  }

  // Descending order of what a searcher wants: who, where they work, what they
  // cover, then how to reach them.
  const responsibility = estates.length
    ? `專責${estates.slice(0, 3).join("、")}買賣及租務`
    : specialties.length
      ? `專責${specialties.slice(0, 2).join("、")}`
      : `專營${area}買樓、租樓及放盤委託`;
  const clauses = [
    `${name}，晉誠地產${role ?? "持牌地產代理"}`,
    branch ? `駐${branch}` : null,
    responsibility,
  ].filter(Boolean);
  const signOff = licence
    ? `WhatsApp 直接預約睇樓或免費估價。牌照 ${licence}／${AGENCY_LICENCE}。`
    : `WhatsApp 直接預約睇樓或免費估價。晉誠地產 ${AGENCY_LICENCE}。`;

  let description = `${clauses.join("，")}。`;
  if (displayWidth(description + signOff) > DESCRIPTION_MAX_UNITS) {
    description = truncateToWidth(description, DESCRIPTION_MAX_UNITS - displayWidth(signOff));
    description = `${description}。`;
  }

  return { title: `${title}${BRAND_SUFFIX}`, description: `${description}${signOff}` };
}
