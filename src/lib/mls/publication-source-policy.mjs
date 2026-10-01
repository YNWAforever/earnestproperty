import { isIP } from "node:net";
import { exactUnitIdentity } from "./unit-identity.mjs";
import { stableObservationHash } from "./source-contract.mjs";
export const HSE_PUBLICATION_SOURCE = Object.freeze({
  source: "28hse_agent_540",
  scopeId: "agent:540",
  mediaHosts: ["i1.28hse.com", "i2.28hse.com", "i3.28hse.com"],
  rightsConfirmed: true,
});
export function resolvePublicationSource(policy) {
  const c = policy?.config;
  if (
    policy?.source !== "propertyhk" ||
    policy.scope_id !== "branches:EPW,EPS,EPT" ||
    policy.owner !== "no-hermes-v2" ||
    policy.publish_enabled !== true ||
    c?.publication_verified !== true ||
    c.media_rights_confirmed !== true ||
    c.allowed_media_hosts_verified !== true ||
    !Array.isArray(c.allowed_media_hosts) ||
    !c.allowed_media_hosts.length ||
    c.allowed_media_hosts.length > 10 ||
    c.allowed_media_hosts.some(
      (h) =>
        typeof h !== "string" ||
        isIP(h) ||
        !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(h),
    )
  )
    throw Error("SOURCE_PUBLICATION_POLICY_UNVERIFIED");
  const rule = c.source_url_identity;
  if (
    !["global", "branch"].includes(policy.id_scope) ||
    rule?.verified !== true ||
    typeof rule.path_template !== "string" ||
    !rule.path_template.startsWith("/") ||
    !rule.path_template.includes("{id}") ||
    /[?#%]/.test(rule.path_template) ||
    /\{(?!id\}|branch\})/.test(rule.path_template) ||
    (policy.id_scope === "branch" && !rule.path_template.includes("{branch}"))
  )
    throw Error("SOURCE_PUBLICATION_POLICY_UNVERIFIED");
  return {
    source: "propertyhk",
    scopeId: policy.scope_id,
    mediaHosts: [...new Set(c.allowed_media_hosts)],
    rightsConfirmed: true,
    idScope: policy.id_scope,
    aliases: c.aliases ?? {},
    verifySourceUrl: (r, url) =>
      typeof r.property_id === "string" &&
      /^[A-Za-z0-9_-]+$/.test(r.property_id) &&
      ["EPW", "EPS", "EPT"].includes(r.branch_code) &&
      ["https://www.property.hk", "https://property.hk"].includes(url.origin) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname ===
        rule.path_template.replaceAll("{id}", r.property_id).replaceAll("{branch}", r.branch_code),
  };
}
const frozen = (value) =>
  Array.isArray(value)
    ? Object.freeze(value.map(frozen))
    : value && typeof value === "object"
      ? Object.freeze(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, frozen(v)])))
      : value;
export function createPropertyhkMediaObservation({
  raw,
  externalId,
  unitKey,
  fetchedAt,
  aliases = {},
  verifySourceUrl,
  images = raw.publication.images,
}) {
  const identity = exactUnitIdentity(raw, aliases);
  if (!identity.key || unitKey !== identity.key || !verifySourceUrl?.(raw, new URL(raw.source_url)))
    throw Error("PROPERTYHK_MEDIA_IDENTITY_UNVERIFIED");
  const value = {
    schemaVersion: 2,
    source: "propertyhk",
    externalId,
    dealType: raw.deal_type,
    unitKey,
    sourceUrl: raw.source_url,
    propertyNoRaw: null,
    propertyNoNormalized: null,
    matchKey: null,
    fields: {
      [raw.deal_type === "sale" ? "price" : "rent"]:
        raw[raw.deal_type === "sale" ? "price" : "rent"],
    },
    rawFields: {},
    identity,
    mediaCandidates: images.map((url, i) => ({
      url,
      category: "listing_photo",
      isPrimary: i === 0,
    })),
    sourceUpdatedAt: null,
    discoveredAt: fetchedAt,
    fetchedAt,
    validationState: "valid",
    quarantineReasons: [],
    parseWarnings: [],
  };
  const observation = { ...value, contentHash: stableObservationHash(value) };
  if (validatePropertyhkMediaObservation(observation))
    throw Error("PROPERTYHK_MEDIA_OBSERVATION_INVALID");
  return frozen(observation);
}
export function validatePropertyhkMediaObservation(observation) {
  try {
    const { contentHash, ...value } = observation;
    const identity = observation.identity;
    const url = new URL(observation.sourceUrl);
    if (
      observation.schemaVersion !== 2 ||
      observation.source !== "propertyhk" ||
      typeof observation.externalId !== "string" ||
      !observation.externalId ||
      /\s/.test(observation.externalId) ||
      !["sale", "rent"].includes(observation.dealType) ||
      observation.unitKey !== identity.key ||
      identity.key !==
        JSON.stringify([
          identity.district,
          identity.estate,
          identity.phase,
          identity.block,
          identity.floor,
          identity.unit,
          observation.dealType,
        ]) ||
      [identity.district, identity.estate, identity.block, identity.floor, identity.unit].some(
        (x) => typeof x !== "string" || !x,
      ) ||
      !["https://www.property.hk", "https://property.hk"].includes(url.origin) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^[a-f0-9]{64}$/.test(contentHash ?? "") ||
      stableObservationHash(value) !== contentHash ||
      observation.validationState !== "valid" ||
      !Array.isArray(observation.quarantineReasons) ||
      observation.quarantineReasons.length ||
      !Array.isArray(observation.parseWarnings) ||
      observation.parseWarnings.some((x) => typeof x !== "string") ||
      !Number.isFinite(Date.parse(observation.fetchedAt)) ||
      observation.discoveredAt !== observation.fetchedAt ||
      !(Number(observation.fields[observation.dealType === "sale" ? "price" : "rent"]) > 0) ||
      !Array.isArray(observation.mediaCandidates) ||
      observation.mediaCandidates.length > 6 ||
      observation.mediaCandidates.some(
        (x) =>
          typeof x.url !== "string" ||
          !x.url ||
          x.category !== "listing_photo" ||
          typeof x.isPrimary !== "boolean",
      )
    )
      return "propertyhk_media_contract_invalid";
    return null;
  } catch {
    return "propertyhk_media_contract_invalid";
  }
}
