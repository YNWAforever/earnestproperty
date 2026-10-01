import "@tanstack/react-start/server-only";
import { queryRows } from "../neon/db.server.ts";
import type { PortalInterpretation, PortalReference } from "./no-link.types.ts";

export type ResolutionReason =
  | "scope_conflict"
  | "missing_publication"
  | "ambiguous_publication"
  | "stale_publication"
  | "ambiguous_staff"
  | "inactive_staff"
  | "missing_staff_mapping"
  | "unverified_reference";
export type PortalScopeRow = {
  channel_id: string;
  source: string;
  scope_id: string;
  staff_namespace: string;
};
export type PortalListingRow = {
  source: string;
  scope_id: string;
  external_listing_id: string;
  deal_type: string;
  property_id: string | null;
  observation_id: string;
  policy_version: string;
  last_accepted_at: string;
  source_status: string;
  validation_state: string;
  publication_status: string | null;
  public_offer: boolean;
  publication_owner_id: string | null;
};
export type PortalStaffRow = {
  id: string;
  namespace: string;
  external_reference: string;
  staff_id: string;
  active: boolean;
  mapping_version: number;
  valid_from: string;
  valid_until: string | null;
  verified_at: string;
};
export type MatchResult = {
  reference: PortalReference;
  status: "resolved" | "review";
  reasons: ResolutionReason[];
  propertyId: string | null;
  requestedStaffId: string | null;
  publicationOwnerId: string | null;
  snapshot: {
    source: string | null;
    scopeId: string | null;
    externalListingId: string | null;
    dealType: string | null;
    observationId: string | null;
    policyVersion: string | null;
    mappingId: string | null;
    mappingVersion: number | null;
  };
};
export type ResolutionPorts = {
  loadScopes: (channelId: string, at: string) => Promise<PortalScopeRow[]>;
  loadListings: (
    wanted: Array<{ source: string; scopeId: string; id: string; dealType: string }>,
  ) => Promise<PortalListingRow[]>;
  loadStaffMappings: (
    wanted: Array<{ namespace: string; text: string }>,
  ) => Promise<PortalStaffRow[]>;
};

export function makePortalResolutionPorts(query: typeof queryRows): ResolutionPorts {
  return {
    async loadScopes(channelId, at) {
      return query<PortalScopeRow>(
        `SELECT channel_id,source,scope_id,staff_namespace FROM whatsapp_portal_source_scopes
       WHERE channel_id=$1 AND enabled AND verified_at<=$2::timestamptz`,
        [channelId, at],
      );
    },
    async loadListings(wanted) {
      if (wanted.length === 0) return [];
      return query<PortalListingRow>(
        `WITH wanted AS (
         SELECT DISTINCT source,scope_id,external_listing_id,deal_type
         FROM jsonb_to_recordset($1::jsonb)
           AS x(source text,scope_id text,external_listing_id text,deal_type text)
       )
       SELECT s.source,s.scope_id,s.external_listing_id,s.deal_type::text AS deal_type,
              s.property_id,s.observation_id,s.policy_version,s.last_accepted_at,
              s.source_status,o.validation_state,l.status AS publication_status,
              (p.id IS NOT NULL AND p.status::text='active' AND EXISTS(SELECT 1 FROM property_public_members pm WHERE pm.property_id=p.id)) AS public_offer,
              p.agent_id AS publication_owner_id
       FROM wanted w JOIN mls_source_state s
         ON s.source=w.source AND s.scope_id=w.scope_id
        AND s.external_listing_id=w.external_listing_id AND s.deal_type::text=w.deal_type
       JOIN listing_source_observations o ON o.id=s.observation_id
       LEFT JOIN property_source_links l
         ON l.source=s.source AND l.external_listing_id=s.external_listing_id AND l.deal_type=s.deal_type
       LEFT JOIN properties p ON p.id=s.property_id
`,
        [
          JSON.stringify(
            wanted.map((x) => ({
              source: x.source,
              scope_id: x.scopeId,
              external_listing_id: x.id,
              deal_type: x.dealType,
            })),
          ),
        ],
      );
    },
    async loadStaffMappings(wanted) {
      if (wanted.length === 0) return [];
      return query<PortalStaffRow>(
        `WITH wanted AS (
         SELECT DISTINCT namespace,external_reference
         FROM jsonb_to_recordset($1::jsonb) AS x(namespace text,external_reference text)
       )
       SELECT r.id,r.namespace,r.external_reference,r.staff_id,s.active,
              r.mapping_version,r.valid_from,r.valid_until,r.verified_at
       FROM wanted w JOIN staff_external_references r
         ON r.namespace=w.namespace AND r.external_reference=w.external_reference
       JOIN staff_users s ON s.id=r.staff_id`,
        [
          JSON.stringify(
            wanted.map((x) => ({ namespace: x.namespace, external_reference: x.text })),
          ),
        ],
      );
    },
  };
}

export const portalResolutionPorts = makePortalResolutionPorts(queryRows);

function instant(value: string): number {
  return Date.parse(value);
}

export async function resolvePortalReferences(
  interpretation: PortalInterpretation,
  trusted: { channelId: string; at: string },
  ports: ResolutionPorts = portalResolutionPorts,
): Promise<MatchResult[]> {
  if (!trusted.channelId || !Number.isFinite(instant(trusted.at)))
    throw new Error("PORTAL_TRUSTED_CONTEXT_REQUIRED");
  if (interpretation.references.length > 1000) throw new Error("PORTAL_REFERENCE_LIMIT");
  const scopes = await ports.loadScopes(trusted.channelId, trusted.at);
  const eligible = interpretation.references.map((reference) => {
    const source = reference.source === "28hse" ? "28hse_agent_540" : "propertyhk";
    const matches = scopes.filter(
      (scope) => scope.channel_id === trusted.channelId && scope.source === source,
    );
    return { reference, source, scopes: matches };
  });
  const wanted = eligible.flatMap(({ reference, source, scopes: available }) =>
    reference.externalListingId && reference.dealType && reference.shape === "verified"
      ? available.map((scope) => ({
          source,
          scopeId: scope.scope_id,
          id: reference.externalListingId!,
          dealType: reference.dealType!,
        }))
      : [],
  );
  const staffWanted = eligible.flatMap(({ scopes: available }) =>
    interpretation.requestedStaffText
      ? available.map((scope) => ({
          namespace: scope.staff_namespace,
          text: interpretation.requestedStaffText!,
        }))
      : [],
  );
  const [listings, mappings] = await Promise.all([
    ports.loadListings(wanted),
    ports.loadStaffMappings(staffWanted),
  ]);
  const now = instant(trusted.at);
  const staleBefore = now - 30 * 24 * 60 * 60 * 1000;
  return eligible.map(({ reference, source, scopes: available }) => {
    const reasons: ResolutionReason[] = [];
    if (available.length !== 1) reasons.push("scope_conflict");
    if (reference.shape !== "verified" || !reference.externalListingId || !reference.dealType)
      reasons.push("unverified_reference");
    const candidates = listings.filter(
      (row) =>
        row.source === source &&
        available.some((scope) => scope.scope_id === row.scope_id) &&
        row.external_listing_id === reference.externalListingId &&
        row.deal_type === reference.dealType,
    );
    if (candidates.length > 1) reasons.push("ambiguous_publication");
    const selected = candidates.length === 1 ? candidates[0] : null;
    if (
      !selected ||
      selected.source_status !== "active" ||
      selected.publication_status !== "active" ||
      !selected.public_offer ||
      !selected.property_id ||
      selected.validation_state !== "valid"
    ) {
      reasons.push("missing_publication");
    } else if (
      !Number.isFinite(instant(selected.last_accepted_at)) ||
      instant(selected.last_accepted_at) < staleBefore
    ) {
      reasons.push("stale_publication");
    }
    const staffCandidates = interpretation.requestedStaffText
      ? mappings.filter(
          (mapping) =>
            available.some((scope) => scope.staff_namespace === mapping.namespace) &&
            mapping.external_reference === interpretation.requestedStaffText &&
            instant(mapping.valid_from) <= now &&
            (!mapping.valid_until || now < instant(mapping.valid_until)) &&
            instant(mapping.verified_at) <= now,
        )
      : [];
    if (staffCandidates.length > 1) reasons.push("ambiguous_staff");
    const staff = staffCandidates.length === 1 ? staffCandidates[0] : null;
    if (staff && !staff.active) reasons.push("inactive_staff");
    if (interpretation.requestedStaffText && !staff && staffCandidates.length === 0)
      reasons.push("missing_staff_mapping");
    if (interpretation.requiresReview) reasons.push("unverified_reference");
    const safeProperty =
      selected &&
      !reasons.some((reason) =>
        [
          "scope_conflict",
          "unverified_reference",
          "missing_publication",
          "ambiguous_publication",
          "stale_publication",
        ].includes(reason),
      );
    return {
      reference,
      status: reasons.length === 0 ? ("resolved" as const) : ("review" as const),
      reasons: [...new Set(reasons)],
      propertyId: safeProperty ? selected.property_id : null,
      requestedStaffId:
        staff && staff.active && staffCandidates.length === 1 ? staff.staff_id : null,
      publicationOwnerId: safeProperty ? selected.publication_owner_id : null,
      snapshot: {
        source: selected?.source ?? source,
        scopeId: selected?.scope_id ?? available[0]?.scope_id ?? null,
        externalListingId: reference.externalListingId,
        dealType: reference.dealType,
        observationId: selected?.observation_id ?? null,
        policyVersion: selected?.policy_version ?? null,
        mappingId: staff?.id ?? null,
        mappingVersion: staff?.mapping_version ?? null,
      },
    };
  });
}

/** Idempotent append-only readback. Changed evidence for a parser version is rejected. */
export async function recordPortalInterpretation(
  receiptId: string,
  interpretation: PortalInterpretation,
  resolution: MatchResult[],
  query: typeof queryRows = queryRows,
): Promise<string> {
  const interpretationJson = JSON.stringify(interpretation);
  const resolutionJson = JSON.stringify(resolution);
  const [row] = await query<{ id: string }>(
    `WITH inserted AS (
       INSERT INTO whatsapp_portal_interpretations(receipt_id,parser_version,interpretation,resolution)
       VALUES($1::uuid,$2,$3::jsonb,$4::jsonb)
       ON CONFLICT(receipt_id,parser_version) DO NOTHING RETURNING id
     )
     SELECT id FROM inserted UNION ALL
     SELECT id FROM whatsapp_portal_interpretations
     WHERE receipt_id=$1::uuid AND parser_version=$2
       AND interpretation=$3::jsonb AND resolution=$4::jsonb`,
    [receiptId, interpretation.parserVersion, interpretationJson, resolutionJson],
  );
  if (!row) throw new Error("PORTAL_INTERPRETATION_VERSION_CONFLICT");
  return row.id;
}
