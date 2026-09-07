import "@tanstack/react-start/server-only";
import { queryRows, numberOrNull, stringOrNull, type DbRow } from "./db.server.ts";
import type { StaffAccess } from "./auth.server.ts";
import {
  propertyGroupFiltersSchema,
  sharedPropertySchema,
  type PropertyGroupFilters,
  type PropertyGroupPage,
  type ManagedPropertyDetail,
  type ManagedPropertySummary,
  type ManagedOffering,
  type SharedPropertyFields,
} from "./admin-properties.types.ts";

// Shared with the mutation function. Hash every member, including historical rows,
// so imports, membership changes and ownership transfers invalidate an open editor.
export const ADMIN_PROPERTY_VERSION_SQL = `md5(string_agg(p.id::text || ':' || coalesce(extract(epoch from p.updated_at)::text,'') || ':' || coalesce(extract(epoch from p.source_updated_at)::text,'') || ':' || coalesce(extract(epoch from p.last_seen_at)::text,'') || ':' || p.deal_type::text || ':' || coalesce(p.agent_id::text,''), '|' ORDER BY p.id))`;
export const ADMIN_PROPERTY_ORDER_SQL = `p.source_updated_at DESC NULLS LAST, p.last_seen_at DESC NULLS LAST, p.updated_at DESC NULLS LAST, p.created_at DESC, p.id ASC`;
function actorScope(actor: StaffAccess) {
  if (actor.roles.some((role) => role === "admin" || role === "manager")) return null;
  if (actor.roles.includes("agent")) return actor.staffId;
  throw new Response("Forbidden", { status: 403 });
}
function baseQuery() {
  return `WITH members AS (
    SELECT p.*,coalesce(m.public_listing_no,'unlinked:'||p.id::text) AS group_no,
      m.public_listing_no IS NULL AS unlinked
    FROM properties p LEFT JOIN property_public_members m ON m.property_id=p.id
  ), versions AS (
    SELECT p.group_no,${ADMIN_PROPERTY_VERSION_SQL} AS version FROM members p GROUP BY p.group_no
  ), ranked AS (
    SELECT p.*, row_number() OVER(PARTITION BY p.group_no,p.deal_type ORDER BY ${ADMIN_PROPERTY_ORDER_SQL}) AS deal_rank
    FROM members p
  ), current_members AS (
    SELECT p.*,e.name_zh AS estate_name,coalesce(s.name_zh,s.name_en) AS agent_name
    FROM ranked p LEFT JOIN estates e ON e.id=p.estate_id LEFT JOIN staff_users s ON s.id=p.agent_id
    WHERE p.deal_rank=1
  ), visible AS (
    SELECT p.* FROM current_members p WHERE ($1::uuid IS NULL OR p.agent_id=$1::uuid)
  ), groups AS (
    SELECT p.group_no,bool_or(p.unlinked) AS unlinked,
      jsonb_agg(to_jsonb(p) ORDER BY p.deal_type) AS offerings,
      max(p.updated_at) AS updated_at,
      (array_agg(p.estate_name ORDER BY CASE p.deal_type::text WHEN 'sale' THEN 0 ELSE 1 END))[1] AS sort_estate,
      (array_agg(p.saleable_area ORDER BY CASE p.deal_type::text WHEN 'sale' THEN 0 ELSE 1 END))[1] AS sort_area,
      max(p.price) FILTER (WHERE p.deal_type::text='sale') AS sort_sale_price,
      max(p.rent) FILTER (WHERE p.deal_type::text='rent') AS sort_rent_price,
      NOT EXISTS(SELECT 1 FROM current_members other WHERE other.group_no=p.group_no AND $1::uuid IS NOT NULL AND other.agent_id IS DISTINCT FROM $1::uuid) AS editable_shared
    FROM visible p GROUP BY p.group_no
  )`;
}
export function buildAdminPropertyGroupsQuery(input: PropertyGroupFilters, actor: StaffAccess) {
  const filters = propertyGroupFiltersSchema.parse(input);
  const sortColumns = {
    updated: "updated_at",
    propertyNo: "group_no",
    estate: "sort_estate",
    area: "sort_area",
    salePrice: "sort_sale_price",
    rentPrice: "sort_rent_price",
  } as const;
  const orderBy = `${sortColumns[filters.sort]} ${filters.direction === "asc" ? "ASC" : "DESC"} NULLS LAST, group_no ASC`;
  const params: unknown[] = [actorScope(actor)];
  const conditions: string[] = [];
  const param = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (filters.status !== "all") conditions.push(`p.status::text=${param(filters.status)}`);
  if (filters.deal && filters.deal !== "all")
    conditions.push(`p.deal_type::text=${param(filters.deal)}`);
  if (filters.estateId) conditions.push(`p.estate_id=${param(filters.estateId)}::uuid`);
  if (filters.agentId) conditions.push(`p.agent_id=${param(filters.agentId)}::uuid`);
  if (filters.q?.trim()) {
    const q = param(`%${filters.q.trim().replace(/[\\%_]/g, "\\$&")}%`);
    conditions.push(
      `(p.group_no ILIKE ${q} OR p.title_zh ILIKE ${q} OR p.estate_name ILIKE ${q} OR p.agent_name ILIKE ${q} OR EXISTS(SELECT 1 FROM ranked alias WHERE alias.group_no=p.group_no AND ($1::uuid IS NULL OR alias.agent_id=$1::uuid) AND alias.listing_no ILIKE ${q}))`,
    );
  }
  const limit = param(filters.pageSize),
    offset = param((filters.page - 1) * filters.pageSize);
  return {
    statement: `${baseQuery()}, matched AS (
    SELECT g.*,v.version FROM groups g JOIN versions v USING(group_no)
    WHERE EXISTS(SELECT 1 FROM visible p WHERE p.group_no=g.group_no ${conditions.map((c) => `AND ${c}`).join(" ")})
  ), page AS (SELECT * FROM matched ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset})
  SELECT (SELECT count(*)::int FROM matched) AS total,coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY ${orderBy}) FROM page),'[]'::jsonb) AS rows`,
    params,
    page: filters.page,
    pageSize: filters.pageSize,
  };
}
export function buildAdminManagedPropertyQuery(id: string, actor: StaffAccess) {
  return {
    statement: `${baseQuery()}
    SELECT g.*,v.version,coalesce((SELECT jsonb_agg(jsonb_build_object('id',h.id,'listingNo',h.listing_no,'dealType',h.deal_type,'status',h.status,'sourceUpdatedAt',h.source_updated_at,'current',h.deal_rank=1) ORDER BY h.deal_type,h.deal_rank) FROM ranked h WHERE h.group_no=g.group_no AND ($1::uuid IS NULL OR h.agent_id=$1::uuid)),'[]'::jsonb) AS history
    FROM groups g JOIN versions v USING(group_no)
    WHERE g.group_no=$2 OR EXISTS(SELECT 1 FROM ranked alias WHERE alias.group_no=g.group_no AND (alias.id::text=$2 OR alias.listing_no=$2) AND ($1::uuid IS NULL OR alias.agent_id=$1::uuid))
    ORDER BY (g.group_no=$2) DESC LIMIT 1`,
    params: [actorScope(actor), id],
  };
}
function sharedFields(row: DbRow): SharedPropertyFields {
  return {
    title_zh: String(row.title_zh ?? ""),
    title_en: stringOrNull(row.title_en),
    estate_id: stringOrNull(row.estate_id),
    district_slug: String(row.district_slug ?? ""),
    address: stringOrNull(row.address),
    saleable_area: numberOrNull(row.saleable_area),
    bedrooms: numberOrNull(row.bedrooms),
    bathrooms: numberOrNull(row.bathrooms),
    floor: stringOrNull(row.floor),
    description: stringOrNull(row.description),
    images: Array.isArray(row.images) ? row.images.map(String) : [],
    seo_title: stringOrNull(row.seo_title),
    seo_description: stringOrNull(row.seo_description),
    video_url: stringOrNull(row.video_url),
  };
}
function offering(row: DbRow): ManagedOffering {
  return {
    id: String(row.id),
    title: String(row.title_zh ?? ""),
    dealType: row.deal_type as "sale" | "rent",
    price: numberOrNull(row.price),
    rent: numberOrNull(row.rent),
    status: String(row.status),
    description: stringOrNull(row.description),
    agentId: stringOrNull(row.agent_id),
    agentName: stringOrNull(row.agent_name),
    editable: true,
  };
}
export function mapAdminPropertyGroup(row: DbRow) {
  const members = row.offerings as DbRow[];
  const first = members.find((m) => m.deal_type === "sale") ?? members[0];
  const shared = sharedFields(first);
  const conflicts = Object.keys(sharedPropertySchema.shape).flatMap((field) => {
    const values = [
      ...new Set(
        members.map((member) =>
          JSON.stringify(sharedFields(member)[field as keyof SharedPropertyFields]),
        ),
      ),
    ];
    return values.length > 1
      ? [
          {
            field,
            values: values.map((value) => {
              const parsed = JSON.parse(value);
              return parsed === null
                ? "—"
                : typeof parsed === "string"
                  ? parsed
                  : JSON.stringify(parsed);
            }),
          },
        ]
      : [];
  });
  const summary: ManagedPropertySummary = {
    propertyNo: String(row.group_no),
    title: shared.title_zh,
    estateName: stringOrNull(first.estate_name),
    image: shared.images[0] ?? null,
    saleableArea: shared.saleable_area,
    updatedAt: stringOrNull(row.updated_at),
    offerings: { sale: null, rent: null },
    version: String(row.version),
    editableShared: row.editable_shared === true && row.unlinked !== true,
    unlinked: row.unlinked === true,
    reviewRequired: conflicts.length > 0,
  };
  for (const member of members)
    if (member.deal_type === "sale" || member.deal_type === "rent")
      summary.offerings[member.deal_type] = {
        ...offering(member),
        editable: row.unlinked !== true,
      };
  return { summary, shared, conflicts };
}
export function buildAdminSourceReviewQuery(ids: string[], actor: StaffAccess) {
  return {
    statement: `WITH visible AS (
    SELECT p.*,m.public_listing_no AS group_no FROM properties p
    JOIN property_public_members m ON m.property_id=p.id
    WHERE p.id=ANY($1::uuid[]) AND ($2::uuid IS NULL OR p.agent_id=$2::uuid)
  ), differences AS (
    SELECT p.group_no,p.deal_type::text AS deal_type,patch.key AS field,
      to_jsonb(p)->patch.key AS managed_value,s.payload->patch.key AS source_value
    FROM visible p JOIN admin_property_overrides o ON o.property_no=p.group_no
    CROSS JOIN LATERAL jsonb_each(o.shared || CASE p.deal_type::text WHEN 'sale' THEN o.sale ELSE o.rent END) patch
    JOIN LATERAL (SELECT payload FROM admin_property_source_snapshots source
      WHERE source.property_id=p.id AND source.property_no=p.group_no AND source.operation IN ('INSERT','UPDATE')
      ORDER BY source.captured_at DESC,source.id DESC LIMIT 1) s ON true
    WHERE patch.key=ANY(ARRAY['title_zh','title_en','estate_id','district_slug','address','saleable_area','bedrooms','bathrooms','floor','description','images','seo_title','seo_description','video_url','price','rent','status','agent_id'])
      AND s.payload->patch.key IS DISTINCT FROM to_jsonb(p)->patch.key
  ) SELECT coalesce((SELECT jsonb_agg(to_jsonb(differences)) FROM differences),'[]'::jsonb) AS differences,
    coalesce((SELECT jsonb_object_agg(o.property_no,o.shared->'description') FROM admin_property_overrides o
    WHERE o.shared ? 'description' AND EXISTS(SELECT 1 FROM visible p WHERE p.group_no=o.property_no)),'{}'::jsonb) AS descriptions`,
    params: [ids, actorScope(actor)],
  };
}
async function managementMetadata(rows: DbRow[], actor: StaffAccess) {
  const [schema] = await queryRows(`SELECT to_regclass('admin_property_overrides') IS NOT NULL
    AND to_regclass('admin_property_source_snapshots') IS NOT NULL
    AND to_regprocedure('admin_property_manage(text,text,text,jsonb,uuid)') IS NOT NULL AS available`);
  const available = schema?.available === true;
  if (!available || !rows.length)
    return {
      available,
      differences: [] as DbRow[],
      descriptions: {} as Record<string, string | null>,
    };
  const ids = rows.flatMap((row) => (row.offerings as DbRow[]).map((member) => String(member.id)));
  const query = buildAdminSourceReviewQuery(ids, actor);
  const [result] = await queryRows(query.statement, query.params);
  return {
    available,
    differences: result.differences as DbRow[],
    descriptions: result.descriptions as Record<string, string | null>,
  };
}
function displayValue(value: unknown) {
  return value === null || value === undefined
    ? "—"
    : typeof value === "string"
      ? value
      : JSON.stringify(value);
}
export async function listAdminPropertyGroups(
  input: PropertyGroupFilters,
  actor: StaffAccess,
): Promise<PropertyGroupPage> {
  const query = buildAdminPropertyGroupsQuery(input, actor);
  const [result] = await queryRows(query.statement, query.params);
  const rawRows = (result?.rows ?? []) as DbRow[];
  const metadata = await managementMetadata(rawRows, actor);
  return {
    rows: rawRows.map((row) => {
      const { summary, conflicts } = mapAdminPropertyGroup(row);
      summary.reviewRequired = conflicts.some(
        (conflict) =>
          conflict.field !== "description" ||
          !Object.hasOwn(metadata.descriptions, summary.propertyNo),
      );
      summary.reviewRequired ||= metadata.differences.some(
        (diff) => diff.group_no === summary.propertyNo,
      );
      return summary;
    }),
    total: Number(result?.total ?? 0),
    page: query.page,
    pageSize: query.pageSize,
  };
}
export async function getAdminManagedProperty(
  id: string,
  actor: StaffAccess,
): Promise<ManagedPropertyDetail | null> {
  const query = buildAdminManagedPropertyQuery(id, actor);
  const [row] = await queryRows(query.statement, query.params);
  if (!row) return null;
  const metadata = await managementMetadata([row], actor);
  const { summary, shared, conflicts } = mapAdminPropertyGroup(row);
  const hasDescription = Object.hasOwn(metadata.descriptions, summary.propertyNo);
  if (hasDescription) shared.description = metadata.descriptions[summary.propertyNo];
  const sourceConflicts = metadata.differences.map((diff) => ({
    field: `source.${diff.deal_type}.${diff.field}`,
    values: [
      `管理：${displayValue(diff.managed_value)}`,
      `來源：${displayValue(diff.source_value)}`,
    ],
  }));
  const visibleConflicts = [
    ...conflicts.filter((conflict) => !(hasDescription && conflict.field === "description")),
    ...sourceConflicts,
  ];
  return {
    ...summary,
    reviewRequired: visibleConflicts.length > 0,
    shared,
    conflicts: visibleConflicts,
    history: row.history as ManagedPropertyDetail["history"],
    managementAvailable: metadata.available && !summary.unlinked,
  };
}
