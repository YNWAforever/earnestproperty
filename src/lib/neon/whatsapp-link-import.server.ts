import "@tanstack/react-start/server-only";
import { z } from "zod";
import { queryRows } from "./db.server.ts";
import { canonicalListingCte } from "./public-listing-query.js";
import type { LinkOfferSelection } from "../admin/whatsapp-link-selection.ts";
import type { ImportReference } from "../whatsapp-enquiries/link-batch-import.ts";

const source = z.enum(["website", "28hse", "youtube", "other"]);
export const linkImportLookupInput = z
  .object({
    offers: z
      .array(
        z
          .object({
            publicListingNo: z.string().trim().min(1).max(160),
            dealType: z.enum(["sale", "rent"]),
          })
          .strict(),
      )
      .max(1000),
    references: z
      .array(
        z
          .object({
            source,
            namespace: z.string().trim().min(1).max(160),
            externalReference: z.string().min(1).max(160),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();

export async function resolveLinkImportContext(
  value: unknown,
  query = queryRows,
): Promise<{
  offers: LinkOfferSelection[];
  references: ImportReference[];
}> {
  const input = linkImportLookupInput.parse(value);
  if (input.references.some((item) => !item.namespace.startsWith(item.source + "/")))
    throw new Response("SOURCE_REFERENCE_SCOPE_INVALID", { status: 400 });
  const offerRows = input.offers.length
    ? await query(
        `${canonicalListingCte("TRUE", true)},
    wanted AS (
      SELECT DISTINCT UPPER(public_listing_no) AS public_listing_no, deal_type
      FROM jsonb_to_recordset($1::jsonb) AS x(public_listing_no text,deal_type text)
    )
    SELECT p.id,c.public_listing_no,p.deal_type,p.title_zh,p.price,p.rent,p.agent_id,
      COALESCE(s.name_zh,s.name_en) AS agent_name
    FROM current_offerings c JOIN properties p ON p.id=c.id
    JOIN wanted w ON w.public_listing_no=c.public_listing_no AND w.deal_type=p.deal_type::text
    LEFT JOIN staff_users s ON s.id=p.agent_id
    WHERE p.status::text='active'
    ORDER BY c.public_listing_no,p.deal_type`,
        [
          JSON.stringify(
            input.offers.map((item) => ({
              public_listing_no: item.publicListingNo,
              deal_type: item.dealType,
            })),
          ),
        ],
      )
    : [];
  const referenceRows = input.references.length
    ? await query(
        `WITH wanted AS (
      SELECT DISTINCT source,namespace,external_reference
      FROM jsonb_to_recordset($1::jsonb)
        AS x(source text,namespace text,external_reference text)
    )
    SELECT r.id,r.namespace,r.external_reference,r.staff_id
    FROM wanted w JOIN staff_external_references r
      ON r.namespace=w.namespace AND r.external_reference=w.external_reference
    JOIN staff_users s ON s.id=r.staff_id AND s.active
    WHERE r.namespace LIKE w.source||'/%'
      AND r.valid_from<=now() AND (r.valid_until IS NULL OR r.valid_until>now())
      AND r.verified_at<=now()
    ORDER BY r.namespace,r.external_reference,r.id`,
        [
          JSON.stringify(
            input.references.map((item) => ({
              source: item.source,
              namespace: item.namespace,
              external_reference: item.externalReference,
            })),
          ),
        ],
      )
    : [];
  return {
    offers: offerRows.map((r) => ({
      propertyId: String(r.id),
      publicListingNo: String(r.public_listing_no),
      dealType: r.deal_type as "sale" | "rent",
      title: String(r.title_zh ?? ""),
      price:
        r.deal_type === "sale"
          ? r.price == null
            ? null
            : Number(r.price)
          : r.rent == null
            ? null
            : Number(r.rent),
      agentId: r.agent_id ? String(r.agent_id) : null,
      agentName: r.agent_name ? String(r.agent_name) : null,
    })),
    references: referenceRows.map((r) => ({
      id: String(r.id),
      namespace: String(r.namespace),
      externalReference: String(r.external_reference),
      staffId: String(r.staff_id),
      valid: true,
    })),
  };
}
