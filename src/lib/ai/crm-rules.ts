import type { AiTagSafetyLevel } from "./ai-types";

const factualPrefixes = ["budget_", "estate_", "intent_", "source_", "lang_", "district_"];
const knownEstateInterestTags = new Set([
  "bellagio_interest",
  "sea-crest-villa_interest",
  "sea_crest_villa_interest",
  "hong-kong-garden_interest",
  "hong_kong_garden_interest",
  "rhine-garden_interest",
  "rhine_garden_interest",
  "lido-garden_interest",
  "lido_garden_interest",
]);
const sensitiveTags = new Set(["hot_lead", "ready_to_buy", "urgent_30_days", "needs_valuation"]);
const judgmentalTags = new Set(["low_quality", "price_shopper", "unresponsive"]);

export function classifyAiTagSafety(tag: string): AiTagSafetyLevel {
  if (judgmentalTags.has(tag)) return "judgmental";
  if (sensitiveTags.has(tag)) return "sensitive";
  if (factualPrefixes.some((prefix) => tag.startsWith(prefix))) return "factual";
  if (knownEstateInterestTags.has(tag)) return "factual";
  return "sensitive";
}

export function canAutoApplyAiTag(tag: string) {
  return classifyAiTagSafety(tag) === "factual";
}

export function suggestFactualTags(input: {
  intent?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
  preferred_estates?: string[] | null;
  source?: string | null;
  language?: string | null;
}) {
  const tags = new Set<string>();
  if (input.intent) tags.add(`intent_${slug(input.intent)}`);
  if (input.source) tags.add(`source_${slug(input.source)}`);
  if (input.language) tags.add(`lang_${slug(input.language)}`);
  for (const estate of input.preferred_estates ?? []) tags.add(`estate_${slug(estate)}`);

  const budget = budgetBand(input.budget_min ?? null, input.budget_max ?? null);
  if (budget) tags.add(budget);

  return [...tags];
}

export function scoreLeadProfile(input: {
  intent?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
  preferred_estates?: string[] | null;
  timeline?: string | null;
  opt_in_whatsapp?: boolean | null;
  last_activity_days?: number | null;
}) {
  let score = 10;
  if (input.intent) score += 10;
  if (input.budget_min || input.budget_max) score += 20;
  if ((input.preferred_estates ?? []).length > 0) score += 15;
  if (input.opt_in_whatsapp) score += 15;
  if (input.timeline === "30_days") score += 20;
  if (typeof input.last_activity_days === "number" && input.last_activity_days <= 7) score += 10;
  if (typeof input.last_activity_days === "number" && input.last_activity_days > 60) score -= 10;
  return Math.max(0, Math.min(100, score));
}

function budgetBand(min: number | null, max: number | null) {
  if (!min && !max) return null;
  const low = Math.floor((min ?? 0) / 1000000);
  const high = Math.ceil((max ?? min ?? 0) / 1000000);
  return `budget_${low}m_${high}m`;
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
