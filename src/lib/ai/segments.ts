import type { CrmSegmentEligibility, CrmSegmentFilters } from "./ai-types";
import { estateRegistry } from "../../content/estate-registry.ts";

/**
 * Turns one alias string into a regex alternative, collapsing internal
 * whitespace runs to `\s*` so a multi-word English alias still matches text
 * with different/no spacing (e.g. "Sea Crest" also matches "SeaCrest") --
 * reproducing what the old hand-written patterns did for their English
 * fragments (e.g. `/sea\s*crest/i`).
 */
function toRegexAlternative(alias: string): string {
  return alias
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*");
}

/**
 * Derived from estate-registry.ts's `aliases` field (DR-10) instead of a
 * second hand-maintained regex list. Only the five estates with a real
 * detail page (`hasPage: true`) are matchable here, matching the original
 * hand-written list's coverage. Each entry's aliases are a superset of what
 * the old hardcoded pattern matched on (e.g. bellagio's old pattern was
 * `/碧堤|bellagio/i`; its registry aliases include "碧堤半島" and "碧堤"), so
 * every prompt that used to match still matches.
 */
const estateAliases: Array<[RegExp, string]> = estateRegistry
  .filter((entry) => entry.hasPage)
  .map((entry) => [
    new RegExp(entry.aliases.map(toRegexAlternative).join("|"), "i"),
    entry.slug,
  ]);

export function parseSegmentPromptToFilters(prompt: string): CrmSegmentFilters {
  const text = prompt.toLowerCase();
  const filters: CrmSegmentFilters = {};

  if (/買|buyer|buy/.test(text)) filters.intent = "buyer";
  if (/租|renter|rent/.test(text)) filters.intent = "renter";
  if (/放盤|業主|估價|landlord|seller|valuation/.test(text))
    filters.intent = "landlord";
  if (/深井|sham\s*tseng/.test(text)) filters.district_slug = "sham-tseng";
  if (/汀九|ting\s*kau/.test(text)) filters.district_slug = "ting-kau";
  if (/荃灣|tsuen\s*wan/.test(text)) filters.district_slug = "tsuen-wan";

  const estates = estateAliases
    .filter(([pattern]) => pattern.test(prompt))
    .map(([, slug]) => slug);
  if (estates.length) filters.preferred_estates = estates;

  const budget = parseBudget(prompt);
  if (budget) filters.budget = budget;

  const days = prompt.match(/最近\s*(\d+)\s*日|last\s*(\d+)\s*days/i);
  if (days) filters.last_activity_days = Number(days[1] ?? days[2]);

  if (/opt[-\s]?in|同意|whatsapp/i.test(prompt))
    filters.require_whatsapp_opt_in = true;

  return filters;
}

export function classifySegmentEligibility(input: {
  normalized_phone: string | null;
  opt_in_whatsapp: boolean | null;
  opted_out_whatsapp: boolean | null;
}): CrmSegmentEligibility {
  if (!input.normalized_phone) return "missing_phone";
  if (input.opted_out_whatsapp) return "opted_out";
  if (!input.opt_in_whatsapp) return "not_opted_in";
  return "eligible";
}

const WAN_MULTIPLIER = 10000;
const YIK_MULTIPLIER = 100000000;

function parseBudget(prompt: string) {
  // 億 (hundred-million) ranges take precedence over 萬 (ten-thousand) so that a
  // prompt like "1-2億" is not mis-parsed by the 萬 matcher.
  const yikRange = prompt.match(
    /(\d+(?:\.\d+)?)\s*[-至到]\s*(\d+(?:\.\d+)?)\s*億/,
  );
  if (yikRange) {
    return {
      min: Math.round(Number(yikRange[1]) * YIK_MULTIPLIER),
      max: Math.round(Number(yikRange[2]) * YIK_MULTIPLIER),
    };
  }

  const wanRange = prompt.match(
    /(\d+(?:\.\d+)?)\s*[-至到]\s*(\d+(?:\.\d+)?)\s*萬/,
  );
  if (wanRange) {
    return {
      min: Math.round(Number(wanRange[1]) * WAN_MULTIPLIER),
      max: Math.round(Number(wanRange[2]) * WAN_MULTIPLIER),
    };
  }

  const yikSingle = prompt.match(/(\d+(?:\.\d+)?)\s*億/);
  if (yikSingle) {
    const value = Math.round(Number(yikSingle[1]) * YIK_MULTIPLIER);
    return { min: value, max: value };
  }

  const wanSingle = prompt.match(/(\d+(?:\.\d+)?)\s*萬/);
  if (wanSingle) {
    const value = Math.round(Number(wanSingle[1]) * WAN_MULTIPLIER);
    return { min: value, max: value };
  }

  return undefined;
}
