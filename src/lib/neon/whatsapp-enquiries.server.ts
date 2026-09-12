import "@tanstack/react-start/server-only";
import { createHash, randomUUID } from "node:crypto";
import { queryRows, transactionRows, type DbRow, type TransactionStatement } from "./db.server.ts";
import type { StaffAccess } from "./auth.server.ts";
import type {
  TrackingLinkInput,
  TrackingLink,
  WhatsappEnquiry,
} from "./whatsapp-enquiries.types.ts";
import {
  mintReference,
  shouldMintReference,
  companyWhatsappHref,
} from "../whatsapp-enquiries/links.ts";
const fields = `l.id,l.code,v.*,l.created_at`;
export function companyChannel() {
  const channel = process.env.EP_WA_COMPANY_CHANNEL_ID;
  if (!channel || channel.length > 160) throw new Error("WA_COMPANY_CHANNEL_REQUIRED");
  return channel;
}
export function trackingEnabled() {
  return process.env.EP_WA_TRACKED_LINKS_ENABLED === "true";
}
function admin(actor: StaffAccess) {
  if (!actor.roles.some((r) => r === "admin" || r === "manager"))
    throw new Response("Forbidden", { status: 403 });
}
function linkDto(row: DbRow): TrackingLink {
  return {
    id: String(row.id),
    code: String(row.code),
    version: Number(row.version),
    channelId: String(row.channel_id),
    placementSource: row.placement_source as TrackingLink["placementSource"],
    entryPointType: row.entry_point_type as TrackingLink["entryPointType"],
    publicListingNo: row.public_listing_no as string | null,
    propertyId: row.property_id as string | null,
    dealType: row.deal_type as TrackingLink["dealType"],
    requestedStaffId: row.requested_staff_id as string | null,
    branchId: row.branch_id as string | null,
    externalListingId: row.external_listing_id as string | null,
    videoId: row.video_id as string | null,
    placementVerifiedAt: row.placement_verified_at as string | null,
    placementVerified: Boolean(row.placement_verified_at),
    enabled: row.enabled === true,
    createdAt: String(row.created_at),
  };
}
export async function listTrackingLinks(actor: StaffAccess) {
  admin(actor);
  return (
    await queryRows(
      `SELECT ${fields} FROM whatsapp_tracking_links l JOIN whatsapp_tracking_link_versions v ON v.link_id=l.id AND v.version=l.current_version ORDER BY l.created_at DESC LIMIT 500`,
    )
  ).map(linkDto);
}
/** Same current-offer ordering as public detail; never substitutes a different source row. */
export const currentOfferSql = `SELECT p.id,p.title_zh FROM properties p JOIN property_public_members m ON m.property_id=p.id WHERE p.id=$1::uuid AND m.public_listing_no=$2 AND p.deal_type::text=$3 AND p.status::text='active' AND p.id=(SELECT x.id FROM property_public_members pm JOIN properties x ON x.id=pm.property_id WHERE pm.public_listing_no=$2 AND x.deal_type::text=$3 ORDER BY x.source_updated_at DESC NULLS LAST,x.last_seen_at DESC NULLS LAST,x.updated_at DESC NULLS LAST,x.created_at DESC,x.id ASC LIMIT 1)`;
async function validateLink(input: TrackingLinkInput, query = queryRows) {
  if (
    Boolean(input.propertyId) !== Boolean(input.publicListingNo) ||
    Boolean(input.propertyId) !== Boolean(input.dealType)
  )
    throw new Error("WA_LINK_OFFER_CONTEXT_REQUIRED");
  if (
    input.enabled &&
    input.propertyId &&
    !(await query(currentOfferSql, [input.propertyId, input.publicListingNo, input.dealType]))
      .length
  )
    throw new Error("WA_LINK_PUBLIC_OFFER_UNAVAILABLE");
  if (
    input.enabled &&
    input.requestedStaffId &&
    !(
      await query("SELECT id FROM staff_users WHERE id=$1::uuid AND active=true", [
        input.requestedStaffId,
      ])
    ).length
  )
    throw new Error("WA_LINK_STAFF_UNAVAILABLE");
}
function versionStatement(
  id: string,
  version: number,
  input: TrackingLinkInput,
  actor: StaffAccess,
  channel: string,
): TransactionStatement {
  return {
    statement: `INSERT INTO whatsapp_tracking_link_versions(link_id,version,channel_id,placement_source,entry_point_type,public_listing_no,property_id,deal_type,requested_staff_id,branch_id,external_listing_id,video_id,enabled,created_by,placement_verified_at) SELECT $1::uuid,$2,$3,$4,$5,$6,$7::uuid,$8,$9::uuid,$10,$11,$12,$13,$14::uuid,$15::timestamptz WHERE EXISTS(SELECT 1 FROM whatsapp_tracking_links WHERE id=$1::uuid AND current_version=$2) RETURNING *`,
    params: [
      id,
      version,
      channel,
      input.placementSource,
      input.entryPointType,
      input.publicListingNo ?? null,
      input.propertyId ?? null,
      input.dealType ?? null,
      input.requestedStaffId ?? null,
      input.branchId ?? null,
      input.externalListingId ?? null,
      input.videoId ?? null,
      input.enabled,
      actor.staffId,
      input.placementVerified ? new Date().toISOString() : null,
    ],
  };
}
export async function saveTrackingLink(
  input: TrackingLinkInput & { id?: string; expectedVersion?: number },
  actor: StaffAccess,
  dependencies = { query: queryRows, transaction: transactionRows },
) {
  const { query, transaction } = dependencies;
  admin(actor);
  await validateLink(input, query);
  const previous =
    input.id && !input.enabled
      ? (
          await query(
            "SELECT channel_id FROM whatsapp_tracking_link_versions WHERE link_id=$1::uuid AND version=$2",
            [input.id, input.expectedVersion],
          )
        )[0]
      : null;
  const channel = previous ? String(previous.channel_id) : companyChannel(),
    id = input.id ?? randomUUID(),
    version = input.id ? (input.expectedVersion ?? 0) + 1 : 1;
  if (input.id && !input.expectedVersion) throw new Error("WA_LINK_VERSION_REQUIRED");
  const first: TransactionStatement = input.id
    ? {
        statement:
          "UPDATE whatsapp_tracking_links SET current_version=current_version+1 WHERE id=$1::uuid AND current_version=$2 RETURNING id",
        params: [id, input.expectedVersion],
      }
    : {
        statement:
          "INSERT INTO whatsapp_tracking_links(id,code,created_by) VALUES($1::uuid,$2,$3::uuid) RETURNING id",
        params: [id, mintReference(), actor.staffId],
      };
  // The immutable version is inserted only when the optimistic update succeeded. Lock/read current version in one CTE.
  const result = await transaction([first, versionStatement(id, version, input, actor, channel)]);
  if (!result[0].length) throw new Error("WA_LINK_VERSION_CONFLICT");
  const [row] = await query(
    `SELECT ${fields} FROM whatsapp_tracking_links l JOIN whatsapp_tracking_link_versions v ON v.link_id=l.id WHERE l.id=$1::uuid AND v.version=$2`,
    [id, version],
  );
  return linkDto(row);
}
export async function provisionTrackingLinks(inputs: TrackingLinkInput[], actor: StaffAccess) {
  admin(actor);
  if (inputs.length < 1 || inputs.length > 50) throw new Error("WA_LINK_BATCH_LIMIT");
  for (const input of inputs) await validateLink(input);
  const channel = companyChannel(),
    ids = inputs.map(() => randomUUID());
  const statements = inputs.flatMap((input, i) => [
    {
      statement:
        "INSERT INTO whatsapp_tracking_links(id,code,created_by) VALUES($1::uuid,$2,$3::uuid)",
      params: [ids[i], mintReference(), actor.staffId],
    },
    versionStatement(ids[i], 1, input, actor, channel),
  ]);
  await transactionRows(statements);
  return (
    await queryRows(
      `SELECT ${fields} FROM whatsapp_tracking_links l JOIN whatsapp_tracking_link_versions v ON v.link_id=l.id AND v.version=l.current_version WHERE l.id=ANY($1::uuid[])`,
      [ids],
    )
  ).map(linkDto);
}
export async function resolveTrackingLinks(
  offers: { propertyId: string; publicListingNo: string; dealType: "sale" | "rent" }[],
  query = queryRows,
) {
  const enabled = trackingEnabled();
  const fallbackHref = enabled
    ? process.env.EP_WA_COMPANY_PHONE
      ? companyWhatsappHref(process.env.EP_WA_COMPANY_PHONE, "您好，我想向晉誠地產查詢。")
      : "/contact"
    : null;
  if (!enabled)
    return {
      enabled,
      fallbackHref,
      links: offers.map((o) => ({ propertyId: o.propertyId, href: null })),
    };
  const channel = companyChannel();
  // One batch read; public reads cannot provision or reveal internal requested staff/branch metadata.
  const rows = await query(
    `WITH wanted AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x("propertyId" uuid,"publicListingNo" text,"dealType" text)), ranked AS (SELECT p.id,m.public_listing_no,p.deal_type,p.status,row_number() OVER(PARTITION BY m.public_listing_no,p.deal_type ORDER BY p.source_updated_at DESC NULLS LAST,p.last_seen_at DESC NULLS LAST,p.updated_at DESC NULLS LAST,p.created_at DESC,p.id ASC) rn FROM properties p JOIN property_public_members m ON m.property_id=p.id WHERE m.public_listing_no IN(SELECT "publicListingNo" FROM wanted)) SELECT DISTINCT ON (w."propertyId") w."propertyId",l.code FROM wanted w JOIN ranked p ON p.id=w."propertyId" AND p.public_listing_no=w."publicListingNo" AND p.deal_type::text=w."dealType" AND p.rn=1 AND p.status::text='active' JOIN whatsapp_tracking_link_versions v ON v.property_id=p.id AND v.public_listing_no=p.public_listing_no AND v.deal_type=p.deal_type::text AND v.enabled AND v.placement_source='website' AND v.channel_id=$2 JOIN whatsapp_tracking_links l ON l.id=v.link_id AND l.current_version=v.version ORDER BY w."propertyId",l.created_at,l.id`,
    [JSON.stringify(offers), channel],
  );
  const missing = offers.filter((o) => !rows.some((r) => r.propertyId === o.propertyId));
  if (missing.length)
    console.warn(
      "WA_TRACKING_LINK_UNPROVISIONED",
      JSON.stringify(
        missing
          .map((o) => ({ propertyId: o.propertyId, publicListingNo: o.publicListingNo }))
          .slice(0, 50),
      ),
    );
  return {
    enabled,
    fallbackHref,
    links: offers.map((o) => ({
      propertyId: o.propertyId,
      href: rows.find((r) => r.propertyId === o.propertyId)
        ? `/w/${rows.find((r) => r.propertyId === o.propertyId)!.code}`
        : null,
    })),
  };
}
export async function listEnquiries(
  conversationId: string,
  actor: StaffAccess,
  query = queryRows,
): Promise<WhatsappEnquiry[]> {
  const privileged = actor.roles.some((r) => r === "admin" || r === "manager");
  if (!privileged && !actor.roles.includes("agent"))
    throw new Response("Forbidden", { status: 403 });
  const [allowed] = await query(
    "SELECT id FROM whatsapp_conversations WHERE id=$1::uuid AND ($2::boolean OR assigned_agent_id=$3::uuid)",
    [conversationId, privileged, actor.staffId],
  );
  if (!allowed) throw new Response("Forbidden", { status: 403 });
  const rows = await query(
    `SELECT i.* FROM inquiries i JOIN whatsapp_conversations c ON c.id=i.conversation_id WHERE i.conversation_id=$1::uuid AND i.source='whatsapp' AND ($2::boolean OR c.assigned_agent_id=$3::uuid) ORDER BY i.created_at DESC LIMIT 100`,
    [conversationId, privileged, actor.staffId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    conversationId: String(r.conversation_id),
    name: r.name as string | null,
    propertyId: r.property_id as string | null,
    publicListingNo: r.public_listing_no as string | null,
    placementSource: String(r.placement_source),
    attributionMethod: String(r.attribution_method),
    requestedStaffId: r.requested_staff_id as string | null,
    entryPointType: String(r.entry_point_type),
    serviceState: String(r.service_state),
    associationReview: r.association_review === true,
    customerMessageAt: r.customer_message_at as string | null,
    webhookReceivedAt: String(r.webhook_received_at),
    responseDueAt: r.response_due_at as string | null,
    firstHumanResponseAt: r.first_human_response_at as string | null,
    effectsEligible: r.effects_eligible === true,
    crmLeadId: r.crm_lead_id as string | null,
  }));
}
export async function trackedRedirect(request: Request, code: string, query = queryRows) {
  const headers = {
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
  };
  const fallback = () => {
    const phone = process.env.EP_WA_COMPANY_PHONE;
    return new Response(null, {
      status: 302,
      headers: {
        ...headers,
        Location: phone
          ? companyWhatsappHref(phone, "您好，我想向晉誠地產查詢。樓盤供應請向職員確認。")
          : "/contact",
      },
    });
  };
  if (!shouldMintReference(request)) return new Response(null, { status: 204, headers });
  if (!trackingEnabled() || !/^[A-Za-z0-9_-]{16,64}$/.test(code)) return fallback();
  const channel = companyChannel();
  // A finite global bucket bounds storage under arbitrary code/IP input; no IP is retained.
  const key = createHash("sha256").update("wa-redirect-global").digest("hex");
  const [limit] = await query(
    `INSERT INTO whatsapp_link_rate_buckets(bucket_key,window_start,request_count) VALUES($1,date_trunc('minute',now()),1) ON CONFLICT(bucket_key) DO UPDATE SET window_start=date_trunc('minute',now()),request_count=CASE WHEN whatsapp_link_rate_buckets.window_start=date_trunc('minute',now()) THEN whatsapp_link_rate_buckets.request_count+1 ELSE 1 END RETURNING request_count`,
    [key],
  );
  if (Number(limit.request_count) > 300)
    return new Response("請稍後再試，或聯絡公司總台。", {
      status: 429,
      headers: { ...headers, "Retry-After": "60" },
    });
  const [row] = await query(
    `SELECT ${fields} FROM whatsapp_tracking_links l JOIN whatsapp_tracking_link_versions v ON v.link_id=l.id AND v.version=l.current_version WHERE l.code=$1 AND v.enabled AND v.channel_id=$2`,
    [code, channel],
  );
  if (!row) return fallback();
  let title = "";
  if (row.property_id) {
    const [offer] = await query(currentOfferSql, [
      row.property_id,
      row.public_listing_no,
      row.deal_type,
    ]);
    if (!offer) return fallback();
    title = String(offer.title_zh).slice(0, 160);
  }
  const phone = process.env.EP_WA_COMPANY_PHONE ?? "";
  companyWhatsappHref(phone, "");
  const reference = mintReference(),
    snapshot = linkDto(row);
  await query(
    `INSERT INTO whatsapp_link_opens(reference_hash,link_id,link_version,channel_id,context_snapshot) VALUES($1,$2::uuid,$3,$4,$5::jsonb)`,
    [
      createHash("sha256").update(reference).digest("hex"),
      row.id,
      row.version,
      channel,
      JSON.stringify(snapshot),
    ],
  );
  const text = title
    ? `您好，我想查詢${row.deal_type === "rent" ? "租盤" : "售盤"}：${title}（${row.public_listing_no}）。\nEPWA:${reference}`
    : `您好，我想向晉誠地產查詢。\nEPWA:${reference}`;
  return new Response(null, {
    status: 302,
    headers: { ...headers, Location: companyWhatsappHref(phone, text) },
  });
}

/** Authenticated administration only; selection remains revalidated when saving. */
export async function searchLinkOffers(q: string) {
  const rows = await queryRows(
    `WITH ranked AS (
 SELECT p.id,p.title_zh,p.deal_type,p.status,m.public_listing_no,row_number() OVER(PARTITION BY m.public_listing_no,p.deal_type ORDER BY p.source_updated_at DESC NULLS LAST,p.last_seen_at DESC NULLS LAST,p.updated_at DESC NULLS LAST,p.created_at DESC,p.id ASC) rn
 FROM properties p JOIN property_public_members m ON m.property_id=p.id
 ) SELECT id,title_zh,deal_type,public_listing_no FROM ranked WHERE rn=1 AND status::text='active' AND (public_listing_no ILIKE $1 OR title_zh ILIKE $1) ORDER BY public_listing_no,deal_type LIMIT 50`,
    ["%" + q.slice(0, 100) + "%"],
  );
  return rows.map((r) => ({
    propertyId: String(r.id),
    publicListingNo: String(r.public_listing_no),
    dealType: r.deal_type as "sale" | "rent",
    title: String(r.title_zh),
  }));
}
