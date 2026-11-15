import { normalizePhone } from "../phone.js";

export const ENQUIRY_ROUTING_VERSION = "photo-20261116-v1";
export const ENQUIRY_ROUTING_APPROVAL = "user-20261116-enquiry-forwarding-goal5c39c5b8";
export const ENQUIRY_ROUTING_PHOTO_SHA256 =
  "53c362f1ae9ec48e8cdd753bde4bf96a3354a0d432a58964e75c7b3f4a4a1c12";
export const ENQUIRY_COPY = Object.freeze({
  key: "copy",
  kind: "copy",
  staffId: null,
  phone: "85297987774",
});
export const ENQUIRY_MANAGERS = Object.freeze({
  "manager:1": Object.freeze({
    key: "manager:1",
    kind: "manager",
    staffId: "81206a23-777c-45c0-a2c5-7b53757206ca",
    phone: "85266442444",
  }),
  "manager:2": Object.freeze({
    key: "manager:2",
    kind: "manager",
    staffId: "fb4dfa8f-a892-458b-a4f9-7caf48a4a0a2",
    phone: "85291005322",
  }),
  "manager:3": Object.freeze({
    key: "manager:3",
    kind: "manager",
    staffId: "48e258b4-6b1f-4f65-b5e8-2f10a34806ba",
    phone: "85266266608",
  }),
});
const groups = [
  [1, "sham-tseng", ["豪景花園", "帝華軒", "龍騰閣", "逸璟龍灣", "深井汀九村屋"]],
  [
    1,
    "castle-peak-road",
    [
      "滿名山",
      "星堤",
      "上源",
      "The Carmel",
      "南岸",
      "愛琴海岸",
      "帝御",
      "凱和山",
      "愛琴灣",
      "海澄軒",
      "龍珠島",
      "碧翠花園",
      "海譽",
      "青榕臺",
      "海景花園",
      "翠峰小築",
      "容龍居",
      "翠濤居",
      "棕月灣",
      "青山別墅",
      "蟠龍半島",
      "青麗灣別墅",
    ],
  ],
  [2, "sham-tseng", ["浪翠園", "麗都花園", "海雲軒", "嘉御龍庭", "皇璧", "新麗苑", "金麗苑"]],
  [
    2,
    "castle-peak-road",
    ["NAPA", "Oma Oma", "黃金海灣", "帝濤灣", "漣山", "瑜翠園", "雅德苑", "雅翠苑", "春和海景花園"],
  ],
  [3, "sham-tseng", ["碧堤半島", "海韻花園", "縉皇居", "海韻臺"]],
  [
    3,
    "castle-peak-road",
    ["琨崙", "黃金海岸", "OMA by the Sea", "飛揚", "浪濤灣", "海慧花園", "屯門閣"],
  ],
];
export const ENQUIRY_ESTATE_ROUTES = Object.freeze(
  groups.flatMap(([group, districtScope, labels]) =>
    labels.map((label, index) =>
      Object.freeze({
        scopeKey: `photo:${group}:${districtScope}:${index + 1}`,
        label,
        aliases: Object.freeze(
          label === "皇璧"
            ? [label, "皇壁"]
            : label === "深井汀九村屋"
              ? [label, "深井村屋", "汀九村屋", "深井/汀九村屋"]
              : [label],
        ),
        districtScope,
        managerKey: `manager:${group}`,
        estateId: null,
      }),
    ),
  ),
);
export function normalizeEstateLabel(value) {
  return typeof value === "string"
    ? value
        .normalize("NFKC")
        .toUpperCase()
        .replaceAll("台", "臺")
        .replace(/[\p{P}\p{Z}\s]/gu, "")
    : "";
}
export function notificationPhone(value) {
  if (typeof value !== "string") return null;
  const canonical = normalizePhone(value);
  return canonical && /^852[456789]\d{7}$/.test(canonical) ? canonical : null;
}
export function matchEnquiryEstate({
  estateId,
  estateLabel,
  text = "",
  routes = ENQUIRY_ESTATE_ROUTES,
} = {}) {
  const matches = new Map();
  const exact = normalizeEstateLabel(estateLabel);
  const content =
    typeof text === "string" ? text.normalize("NFKC").toUpperCase().replaceAll("台", "臺") : "";
  const spans = [];
  for (const route of routes) {
    if (estateId && route.estateId === estateId) matches.set(route.scopeKey, route);
    for (const alias of route.aliases) {
      const label = normalizeEstateLabel(alias);
      if (!label) continue;
      if (exact && label === exact) matches.set(route.scopeKey, route);
      const pattern = [...label].join("[\\p{P}\\p{Z}\\s]*");
      const boundary = /^[A-Z0-9]/.test(label) ? "(?<![A-Z0-9])" : "";
      const endBoundary = /[A-Z0-9]$/.test(label) ? "(?![A-Z0-9])" : "";
      for (const found of content.matchAll(new RegExp(boundary + pattern + endBoundary, "gu")))
        spans.push({ start: found.index, end: found.index + found[0].length, route });
    }
  }
  if ((estateId || exact) && matches.size === 0)
    return { kind: "general", reason: "estate_unmapped", route: null };
  // Only suppress a shorter alias when a longer label occupies the same text.
  // Separate mentions remain ambiguous, including two estates for one manager.
  for (const span of spans) {
    if (
      !spans.some(
        (other) =>
          other.start <= span.start &&
          other.end >= span.end &&
          other.end - other.start > span.end - span.start,
      )
    )
      matches.set(span.route.scopeKey, span.route);
  }
  if (matches.size > 1) return { kind: "review", reason: "multiple_estates", route: null };
  if (matches.size === 1) return { kind: "estate", route: [...matches.values()][0] };
  return { kind: "general", reason: "estate_unmapped", route: null };
}
export function mentionsSpecificProperty(value) {
  if (typeof value !== "string") return false;
  return (
    /(?:^|[^A-Z0-9])[A-Z][0-9]{6}(?![0-9])/i.test(value) ||
    /\bEPWA\s*:/i.test(value) ||
    /(?:[0-9A-Z]+|[一二三四五六七八九十]+)\s*(?:座|室|單位|樓(?!盤))/i.test(value) ||
    /(?:樓盤|物業)\s*(?:編號|號碼|號|#)\s*[:：]?\s*\S+/.test(value)
  );
}
function usableSales(staff) {
  if (
    !staff ||
    staff.active !== true ||
    staff.showOnWebsite !== true ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(staff.staffId ?? "")
  )
    return null;
  const phone = notificationPhone(staff.whatsapp);
  return phone
    ? {
        key: `sales:${staff.staffId}`,
        kind: "sales",
        staffId: staff.staffId,
        phone,
        ...(staff.displayName ? { displayName: staff.displayName } : {}),
      }
    : null;
}
export function planEnquiryRouting({
  specific = false,
  property = null,
  selectedStaffId = null,
  agents = [],
  legacyAgent = null,
  review = false,
  estateId,
  estateLabel,
  text,
  routes,
} = {}) {
  const base = { routingVersion: ENQUIRY_ROUTING_VERSION, recipients: [ENQUIRY_COPY] };
  if (specific) {
    if (review || !property || property.current !== true || property.status !== "active")
      return { ...base, routingKind: "review", reason: "specific_property_unavailable" };
    const selected = selectedStaffId && agents.find((agent) => agent.staffId === selectedStaffId);
    const sales =
      usableSales(selected) ??
      usableSales(agents.find((agent) => agent.position === 1)) ??
      usableSales(legacyAgent);
    return {
      ...base,
      routingKind: "property",
      propertyId: property.id,
      propertyNo: property.publicListingNo,
      dealType: property.dealType,
      ...(sales
        ? {
            recipients: sales.phone === ENQUIRY_COPY.phone ? [ENQUIRY_COPY] : [sales, ENQUIRY_COPY],
          }
        : { reason: "property_sales_unavailable" }),
    };
  }
  if (review) return { ...base, routingKind: "review", reason: "association_review" };
  const match = matchEnquiryEstate({ estateId, estateLabel, text, routes });
  const manager = match.route && ENQUIRY_MANAGERS[match.route.managerKey];
  if (match.kind !== "estate" || !manager)
    return {
      ...base,
      routingKind: match.kind === "review" ? "review" : "general",
      reason: match.reason ?? "estate_unmapped",
    };
  return {
    ...base,
    routingKind: "estate",
    routeKey: match.route.scopeKey,
    routeRevision: match.route.version ?? 1,
    recipients: [manager, ENQUIRY_COPY],
  };
}
