import type {
  PortalDealType,
  PortalInterpretation,
  PortalReference,
  PortalSource,
  PortalWarning,
} from "./no-link.types.ts";

export const PORTAL_PARSER_VERSION = "portal-intake-v1" as const;
const MAX_TEXT = 16_000;
const URL_PATTERN = /https?:\/\/[^\s<>[\]()，。！？「」『』]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;
const VERIFIED_28HSE_PATH = /^\/(buy|rent)\/[^/]+\/property-(\d+)\/?$/i;

function uniqueWarning(warnings: PortalWarning[], warning: PortalWarning): void {
  if (!warnings.includes(warning)) warnings.push(warning);
}

function dealInMessage(text: string): PortalDealType | null {
  if (/(?:出售|售)\s*(?:HKD|HK\$|\$|[\d,])/i.test(text)) return "sale";
  if (/(?:出租|租)\s*(?:HKD|HK\$|\$|[\d,])/i.test(text)) return "rent";
  return null;
}

function quotedPrice(text: string): number | null {
  const match = text.match(/(?:HKD|HK\$|\$)\s*([\d,]+(?:\.\d+)?)\s*(萬|万)?\s*(?:元|蚊)?/i);
  if (!match) return null;
  const amount = Number(match[1].replaceAll(",", "")) * (match[2] ? 10_000 : 1);
  return Number.isFinite(amount) && amount > 0 && amount <= 1_000_000_000_000 ? amount : null;
}

function recognisedSource(url: URL): PortalSource | null {
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (url.hostname === "www.28hse.com") return "28hse";
  if (url.hostname === "property.hk" || url.hostname === "www.property.hk") return "propertyhk";
  return null;
}

function canonical(url: URL, source: PortalSource): string {
  const result = new URL(url.href);
  if (source === "28hse") result.searchParams.delete("t");
  return result.href;
}

function requestedStaff(text: string): string | null {
  const match = text.match(/^\s*([^\n。！？!?，,]{2,80}?)\s+你好(?:[，,！!。\s]|$)/);
  return match?.[1]?.trim() || null;
}

function estate(text: string): string | null {
  const match = text.match(
    /見到這個\s*([^，,。！？!?\n$]{1,60}?)\s*[，,]?\s*(?:售|租|出售|出租)\s*(?:HKD|HK\$|\$)/,
  );
  return match?.[1]?.trim() || null;
}

/** Pure, conservative interpretation. The verified transport supplies customer identity. */
export function parsePortalEnquiry(text: string): PortalInterpretation {
  const warnings: PortalWarning[] = [];
  const result: PortalInterpretation = {
    parserVersion: PORTAL_PARSER_VERSION,
    references: [],
    requestedStaffText: null,
    estateText: null,
    messageDealType: null,
    quotedPriceHkd: null,
    warnings,
    requiresReview: false,
  };
  if (typeof text !== "string" || text.length > MAX_TEXT) {
    uniqueWarning(warnings, "text_too_long");
    result.requiresReview = true;
    return result;
  }

  const textWithoutUrls = text.replace(URL_PATTERN, " ");
  const declaredSource = /(?:^|[^\w.])28hse(?:$|[^\w.])/i.test(textWithoutUrls) ? "28hse" : null;
  const declaredId =
    textWithoutUrls.match(/樓盤\s*[（(]\s*ID\s*[:：]\s*(\d+)\s*[)）]/i)?.[1] ?? null;
  result.requestedStaffText = requestedStaff(textWithoutUrls);
  result.estateText = estate(textWithoutUrls);
  result.messageDealType = dealInMessage(textWithoutUrls);
  result.quotedPriceHkd = quotedPrice(textWithoutUrls);

  for (const match of text.matchAll(URL_PATTERN)) {
    const originalUrl = match[0].replace(TRAILING_PUNCTUATION, "");
    const span: [number, number] = [match.index, match.index + originalUrl.length];
    let url: URL;
    try {
      url = new URL(originalUrl);
    } catch {
      uniqueWarning(warnings, "untrusted_portal_url");
      continue;
    }
    const source = recognisedSource(url);
    if (!source) {
      uniqueWarning(warnings, "untrusted_portal_url");
      continue;
    }
    const path = source === "28hse" ? url.pathname.match(VERIFIED_28HSE_PATH) : null;
    const externalListingId = path?.[2] ?? null;
    const dealType = path ? (path[1].toLowerCase() === "buy" ? "sale" : "rent") : null;
    const canonicalUrl = canonical(url, source);
    if (source === "propertyhk") uniqueWarning(warnings, "propertyhk_shape_unverified");
    if (source === "28hse" && !path) uniqueWarning(warnings, "unverified_28hse_shape");
    const existing = result.references.find(
      (ref) => ref.source === source && ref.canonicalUrl === canonicalUrl,
    );
    if (existing) {
      existing.spans.push(span);
      continue;
    }
    const reference: PortalReference = {
      source,
      sourceEvidence: ["url-derived"],
      originalUrl,
      canonicalUrl,
      spans: [span],
      externalListingId,
      dealType,
      shape: path ? "verified" : "unverified",
    };
    result.references.push(reference);
  }

  if (declaredSource && declaredId) {
    const matching = result.references.find(
      (ref) => ref.source === declaredSource && ref.externalListingId === declaredId,
    );
    if (matching) matching.sourceEvidence.push("message-declared");
    else if (
      result.references.some(
        (ref) => ref.source === declaredSource && ref.externalListingId !== null,
      )
    ) {
      uniqueWarning(warnings, "text_url_id_conflict");
    } else {
      result.references.push({
        source: declaredSource,
        sourceEvidence: ["message-declared"],
        originalUrl: null,
        canonicalUrl: null,
        spans: [],
        externalListingId: declaredId,
        dealType: result.messageDealType,
        shape: "unverified",
      });
    }
  } else if (
    declaredId &&
    result.references.some((ref) => ref.source === "28hse" && ref.externalListingId !== declaredId)
  ) {
    uniqueWarning(warnings, "text_url_id_conflict");
  }

  if (
    result.messageDealType &&
    result.references.some((ref) => ref.dealType && ref.dealType !== result.messageDealType)
  ) {
    uniqueWarning(warnings, "deal_type_conflict");
  }
  if (result.references.length > 1) uniqueWarning(warnings, "multiple_references");
  result.requiresReview = warnings.length > 0;
  return result;
}
