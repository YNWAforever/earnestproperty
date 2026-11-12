/**
 * Pure estate/district resolution for legacy old-site detail pages.
 *
 * The legacy site names a building ("大廈 (中/英)") without a stable estate id,
 * so sync has to map those free-text names onto the `estates` table. This
 * module is deliberately DB-free: the caller loads `estates` rows once and
 * builds a resolver with `createEstateResolver(estates)`.
 */

const DISTRICT_RULES = Object.freeze([
  [/深井|SHAM TSENG/i, "sham-tseng"],
  [/汀九|TING KAU/i, "ting-kau"],
  [/青龍頭|TSING LUNG TAU/i, "tsing-lung-tau"],
  [/青山公路|掃管笏|大欖|黃金海岸|加多利灣|CASTLE PEAK/i, "castle-peak-road"],
]);

const BLOCK_SUFFIX_PATTERNS = Object.freeze([
  // 第01座 / 第1期 / 第3期 / 第A期
  /\s*第\s*[0-9A-Z]+\s*[座期]$/i,
  // A座 / B2座 / 01座
  /\s*[A-Z]\s*\d*\s*座$/i,
  /\s*\d+\s*座$/,
  // TWR 01 / BLK 03 / BLOCK B2 / PHASE 5 / TOWER 2
  /\s*TWR\.?\s*\d+$/i,
  /\s*TOWER\s*\d+$/i,
  /\s*BLK\.?\s*[A-Z0-9-]+$/i,
  /\s*BLOCK\s*[A-Z0-9-]+$/i,
  /\s*PHASE\s*[0-9A-Z-]+$/i,
  // 洋房 / 大廈
  /\s*洋房$/,
  /\s*大廈$/,
]);

const MATCH_TYPES = Object.freeze(["name_zh", "name_en", "alias"]);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

/**
 * Normalize an estate/building string for comparison: fullwidth characters to
 * ASCII, 臺→台, drop whitespace, interpuncts and hyphen-like separators, and
 * lower-case Latin text. CJK characters are kept intact.
 */
export function normalizeEstateText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/臺/g, "台")
    .replace(/[‧·•・]/g, "")
    .replace(/[\u2010-\u2015\u2212\-_/\\]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/**
 * Remove trailing block/phase descriptors ("第01座", "第3期", "A座", "TWR 01",
 * "BLK 03", "PHASE 5", "洋房", "大廈", ...) repeatedly, plus a leading 香港 so
 * "香港黃金海岸" can match "黃金海岸".
 */
export function stripBlockSuffix(value) {
  let text = String(value ?? "")
    .normalize("NFKC")
    .replace(/臺/g, "台")
    .trim();

  text = text.replace(/^香港/, "");

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of BLOCK_SUFFIX_PATTERNS) {
      const next = text.replace(pattern, "").trim();
      if (next !== text) {
        text = next;
        changed = true;
      }
    }
  }

  return text;
}

/**
 * Best-effort district slug from free text. Returns null when nothing matches.
 * It NEVER returns "tsuen-wan": that district does not exist for the new site's
 * legacy inventory, so falling back to it would silently mis-tag listings.
 */
export function resolveDistrictFromText(text) {
  const haystack = String(text ?? "");
  if (!haystack.trim()) return null;
  for (const [pattern, slug] of DISTRICT_RULES) {
    if (pattern.test(haystack)) return slug;
  }
  return null;
}

function aliasList(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // Plain string alias, e.g. "ROYAL SEA CREST".
    }
    return [value.trim()];
  }
  return [];
}

function estateNameEntries(estate) {
  const entries = [];
  if (estate.name_zh) entries.push({ text: String(estate.name_zh), matchedBy: MATCH_TYPES[0] });
  if (estate.name_en) entries.push({ text: String(estate.name_en), matchedBy: MATCH_TYPES[1] });
  for (const alias of aliasList(estate.aliases)) {
    entries.push({ text: alias, matchedBy: MATCH_TYPES[2] });
  }

  const variants = [];
  for (const entry of entries) {
    const variantsForName = unique([
      normalizeEstateText(entry.text),
      normalizeEstateText(stripBlockSuffix(entry.text)),
    ]);
    for (const text of variantsForName) {
      variants.push({ text, matchedBy: entry.matchedBy });
    }
  }

  return variants;
}

function candidateValues(detail) {
  return unique(
    [
      detail?.buildingZh,
      detail?.buildingEn,
      detail?.title,
      detail?.streetZh,
      detail?.streetEn,
      detail?.address,
    ]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean),
  );
}

function matchScore(candidate, name, allowReverse) {
  if (!candidate || !name) return 0;
  if (candidate === name) return candidate.length;
  // Candidate is a longer form of the estate name ("縉皇居第01座" vs "縉皇居").
  if (candidate.startsWith(name)) return name.length;
  // Estate name is a longer form of the candidate ("LIDO GARDEN BLK 03" vs
  // "LIDO GARDEN"). Only raw candidates may match this way: a block-stripped
  // candidate such as "浪翠園" must not reverse-match the "浪翠園5期" alias of a
  // *different* phase/estate, which is exactly what the phase suffix exists to
  // disambiguate.
  if (allowReverse && candidate.length >= 2 && name.startsWith(candidate)) return candidate.length;
  return 0;
}

function normalizedCandidateVariants(candidates) {
  const variants = [];
  for (const value of candidates) {
    const raw = normalizeEstateText(value);
    if (raw) variants.push({ text: raw, allowReverse: true });
    const stripped = normalizeEstateText(stripBlockSuffix(value));
    if (stripped && stripped !== raw) variants.push({ text: stripped, allowReverse: false });
  }
  return variants;
}

/**
 * Build a resolver from `estates` rows:
 * `{ id, slug, name_zh, name_en, aliases: string[]|null, district_slug }`.
 */
export function createEstateResolver(estates = []) {
  const entries = [];
  for (const estate of estates ?? []) {
    if (!estate) continue;
    const names = estateNameEntries(estate);
    if (!names.length) continue;
    entries.push({
      id: estate.id ?? null,
      slug: estate.slug ?? null,
      districtSlug: estate.district_slug ?? null,
      names,
    });
  }

  function resolveByEstate(candidates) {
    const candidateVariants = normalizedCandidateVariants(candidates);

    let bestScore = 0;
    let bestMatches = [];

    for (const entry of entries) {
      for (const name of entry.names) {
        for (const candidate of candidateVariants) {
          const score = matchScore(candidate.text, name.text, candidate.allowReverse);
          if (!score) continue;
          if (score > bestScore) {
            bestScore = score;
            bestMatches = [{ entry, matchedBy: name.matchedBy }];
          } else if (score === bestScore && !bestMatches.some((match) => match.entry === entry)) {
            bestMatches.push({ entry, matchedBy: name.matchedBy });
          }
        }
      }
    }

    if (!bestMatches.length) return { ambiguous: false, match: null };

    const distinctEstateIds = new Set(bestMatches.map(({ entry }) => entry.id));
    if (distinctEstateIds.size > 1) return { ambiguous: true, match: null };

    const [bestMatch] = bestMatches;
    return { ambiguous: false, match: bestMatch };
  }

  return {
    resolveLocation(detail = {}) {
      const candidates = candidateValues(detail);
      const { ambiguous, match } = resolveByEstate(candidates);
      const districtFromText = resolveDistrictFromText(candidates.join(" "));

      if (ambiguous) {
        return {
          estateId: null,
          estateSlug: null,
          districtSlug: null,
          matchedBy: null,
          ambiguous: true,
        };
      }

      if (!match) {
        return {
          estateId: null,
          estateSlug: null,
          districtSlug: districtFromText,
          matchedBy: null,
          ambiguous: false,
        };
      }

      return {
        estateId: match.entry.id,
        estateSlug: match.entry.slug,
        districtSlug: match.entry.districtSlug ?? districtFromText,
        matchedBy: match.matchedBy,
        ambiguous: false,
      };
    },
  };
}
