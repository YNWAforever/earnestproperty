import "@tanstack/react-start/server-only";

import { getRequest } from "@tanstack/react-start/server";

import type {
  CmsArchiveInput,
  CmsCategoryResult,
  CmsDraftSaveInput,
  CmsEditorResult,
  CmsHubRow,
  CmsHubView,
  CmsPublishInput,
  CmsRestoreInput,
} from "./admin-cms.types";
import { requireStaffAccess, type StaffAccess } from "./auth.server";
import { dateOrNull, getSql, queryRows, stringOrEmpty, stringOrNull } from "./db.server";
import {
  CMS_RESOURCE_TYPES,
  makeRestoreDraft,
  type CmsResourceType,
  type CmsRevisionState,
} from "./cms-revisions";
import { writeAudit } from "./admin-data.server";

const ALL_CMS_ROLES = ["admin", "manager", "agent"] as const;
const PUBLISH_ROLES = ["admin", "manager"] as const;

type RevisionRow = {
  id: unknown;
  resource_type: unknown;
  resource_id: unknown;
  version_number: unknown;
  state: unknown;
  payload: unknown;
  base_published_version: unknown;
  created_at: unknown;
  created_by: unknown;
};

function isResourceType(value: unknown): value is CmsResourceType {
  return typeof value === "string" && CMS_RESOURCE_TYPES.includes(value as CmsResourceType);
}

function assertResourceType(value: unknown): asserts value is CmsResourceType {
  if (!isResourceType(value)) throw new Error("INVALID_CMS_RESOURCE_TYPE");
}

function payloadRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_CMS_PAYLOAD");
  }
  return structuredClone(value as Record<string, unknown>);
}

function nonEmpty(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`CMS_VALIDATION:${field}`);
}

function validatePayload(resourceType: CmsResourceType, payload: Record<string, unknown>) {
  if (resourceType === "estate") {
    nonEmpty(payload.slug, "slug");
    nonEmpty(payload.name_zh, "name_zh");
    nonEmpty(payload.district_slug, "district_slug");
  } else if (resourceType === "article") {
    nonEmpty(payload.slug, "slug");
    nonEmpty(payload.title, "title");
  } else if (resourceType === "video") {
    nonEmpty(payload.title, "title");
    nonEmpty(payload.video_url, "video_url");
  } else if (resourceType === "faq") {
    nonEmpty(payload.scope, "scope");
    nonEmpty(payload.question, "question");
    nonEmpty(payload.answer, "answer");
  } else {
    nonEmpty(payload.url, "url");
    nonEmpty(payload.pathname, "pathname");
  }
}

function hubRow(row: Record<string, unknown>): CmsHubRow {
  return {
    resourceType: String(row.resource_type) as CmsResourceType,
    resourceId: stringOrEmpty(row.resource_id),
    title: stringOrEmpty(row.title),
    slug: stringOrNull(row.slug),
    state: String(row.state) as CmsRevisionState,
    latestRevisionId: stringOrEmpty(row.latest_revision_id),
    latestVersion: Number(row.latest_version ?? 0),
    publishedVersion: row.published_version == null ? null : Number(row.published_version),
    updatedAt: dateOrNull(row.updated_at) ?? new Date(0).toISOString(),
    updatedBy: stringOrNull(row.updated_by),
  };
}

async function staffForRead() {
  return requireStaffAccess(getRequest(), [...ALL_CMS_ROLES]);
}

async function listHubRows(input: {
  view?: CmsHubView;
  query?: string;
  resourceType?: CmsResourceType;
}, actor: StaffAccess) {
  const params: unknown[] = [];
  const filters: string[] = [];
  if (input.resourceType) {
    params.push(input.resourceType);
    filters.push(`latest.resource_type = $${params.length}`);
  }
  if (input.view === "mine") {
    params.push(actor.staffId);
    filters.push(`latest.created_by = $${params.length}::uuid`);
  } else if (input.view === "ready") {
    filters.push("latest.state = 'draft'");
  } else if (input.view === "published") {
    filters.push("latest.state = 'published'");
  }
  const query = input.query?.trim();
  if (query) {
    params.push(`%${query}%`);
    filters.push(`(COALESCE(latest.payload->>'title', latest.payload->>'name_zh', latest.payload->>'question', latest.payload->>'pathname', '') ILIKE $${params.length} OR COALESCE(latest.payload->>'slug', '') ILIKE $${params.length})`);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  return queryRows(
    `
    WITH latest AS (
      SELECT DISTINCT ON (r.resource_type, r.resource_id)
        r.*
      FROM cms_content_revisions r
      ORDER BY r.resource_type, r.resource_id, r.version_number DESC
    )
    SELECT
      latest.resource_type,
      latest.resource_id,
      COALESCE(latest.payload->>'title', latest.payload->>'name_zh', latest.payload->>'question', latest.payload->>'pathname', 'Untitled') AS title,
      latest.payload->>'slug' AS slug,
      latest.state,
      latest.id AS latest_revision_id,
      latest.version_number AS latest_version,
      published.version_number AS published_version,
      latest.created_at AS updated_at,
      staff.name_zh AS updated_by
    FROM latest
    LEFT JOIN LATERAL (
      SELECT version_number
      FROM cms_content_revisions published_revision
      WHERE published_revision.resource_type = latest.resource_type
        AND published_revision.resource_id = latest.resource_id
        AND published_revision.state = 'published'
      ORDER BY version_number DESC
      LIMIT 1
    ) published ON true
    LEFT JOIN staff_users staff ON staff.id = latest.created_by
    ${where}
    ORDER BY latest.created_at DESC
    `,
    params,
  );
}

export async function fetchAdminCmsHub(input: { view: CmsHubView; query?: string }) {
  const actor = await staffForRead();
  return (await listHubRows(input, actor)).map(hubRow);
}

export async function fetchAdminCmsCategory(input: {
  resourceType: CmsResourceType;
  query?: string;
}): Promise<CmsCategoryResult> {
  assertResourceType(input.resourceType);
  const actor = await staffForRead();
  try {
    return { rows: (await listHubRows(input, actor)).map(hubRow) };
  } catch (error) {
    if (input.resourceType === "video" && /cms_videos|does not exist/i.test(String(error))) {
      return { rows: [], unavailableReason: "影片資料表尚未建立" };
    }
    throw error;
  }
}

export async function fetchAdminCmsEditor(input: {
  resourceType: CmsResourceType;
  resourceId: string;
}): Promise<CmsEditorResult> {
  assertResourceType(input.resourceType);
  await staffForRead();
  const rows = await queryRows(
    `SELECT id, resource_type, resource_id, version_number, state, payload,
      base_published_version, created_at, created_by
     FROM cms_content_revisions
     WHERE resource_type = $1 AND resource_id = $2
     ORDER BY version_number DESC
     LIMIT 20`,
    [input.resourceType, input.resourceId],
  );
  const latest = rows[0];
  const row = latest
    ? hubRow({
        ...latest,
        title: String(latest.payload && typeof latest.payload === "object"
          ? ((latest.payload as Record<string, unknown>).title ?? (latest.payload as Record<string, unknown>).name_zh ?? (latest.payload as Record<string, unknown>).question ?? "Untitled")
          : "Untitled"),
        slug: latest.payload && typeof latest.payload === "object" ? (latest.payload as Record<string, unknown>).slug : null,
        latest_revision_id: latest.id,
        latest_version: latest.version_number,
        published_version: rows.find((entry) => entry.state === "published")?.version_number ?? null,
        updated_at: latest.created_at,
        updated_by: latest.created_by,
      })
    : null;
  return {
    row,
    revisions: rows.map((revision) => ({
      id: stringOrEmpty(revision.id),
      versionNumber: Number(revision.version_number),
      state: String(revision.state) as CmsRevisionState,
      createdAt: dateOrNull(revision.created_at) ?? new Date(0).toISOString(),
      createdBy: stringOrNull(revision.created_by),
    })),
  };
}

async function saveDraftForActor(input: CmsDraftSaveInput, actor: StaffAccess) {
  assertResourceType(input.resourceType);
  const payload = payloadRecord(input.payload);
  validatePayload(input.resourceType, payload);
  const resourceIdRows = input.resourceId
    ? [{ id: input.resourceId }]
    : await queryRows("SELECT gen_random_uuid() AS id");
  const resourceId = stringOrEmpty(resourceIdRows[0]?.id);
  const existing = await queryRows(
    `SELECT id, version_number FROM cms_content_revisions
     WHERE resource_type = $1 AND resource_id = $2 AND state = 'draft' AND created_by = $3
     ORDER BY version_number DESC LIMIT 1`,
    [input.resourceType, resourceId, actor.staffId],
  );
  const payloadJson = JSON.stringify(payload);
  const rows = existing[0]
    ? await queryRows(
        `UPDATE cms_content_revisions
         SET payload = $1::jsonb, validation_summary = '{}'::jsonb,
           base_published_version = $2, restored_from_revision_id = $3, created_at = now()
         WHERE id = $4
         RETURNING id, version_number, created_at`,
        [payloadJson, input.basePublishedVersion ?? null, input.restoredFromRevisionId ?? null, existing[0].id],
      )
    : await queryRows(
        `INSERT INTO cms_content_revisions (
           resource_type, resource_id, version_number, state, payload,
           base_published_version, created_by, restored_from_revision_id
         )
         SELECT $1, $2, COALESCE(MAX(version_number), 0) + 1, 'draft', $3::jsonb,
           $4, $5, $6
         FROM cms_content_revisions
         WHERE resource_type = $1 AND resource_id = $2
         RETURNING id, version_number, created_at`,
        [input.resourceType, resourceId, payloadJson, input.basePublishedVersion ?? null, actor.staffId, input.restoredFromRevisionId ?? null],
      );
  const saved = rows[0];
  await writeAudit(actor.staffId, "cms_draft_saved", input.resourceType, resourceId, {
    revisionId: stringOrEmpty(saved?.id),
  });
  return {
    resourceId,
    revisionId: stringOrEmpty(saved?.id),
    versionNumber: Number(saved?.version_number ?? existing[0]?.version_number ?? 1),
    savedAt: dateOrNull(saved?.created_at) ?? new Date().toISOString(),
  };
}

export async function saveAdminCmsDraft(input: CmsDraftSaveInput, request: Request) {
  const actor = await requireStaffAccess(request, ["admin", "manager", "agent"]);
  return saveDraftForActor(input, actor);
}

function projectorSql(resourceType: CmsResourceType) {
  const common = `
    WITH draft AS (
      SELECT * FROM cms_content_revisions
      WHERE id = $1 AND resource_type = $2 AND resource_id = $3 AND state = 'draft'
      FOR UPDATE
    ), current_published AS (
      SELECT version_number FROM cms_content_revisions
      WHERE resource_type = $2 AND resource_id = $3 AND state = 'published'
      ORDER BY version_number DESC LIMIT 1 FOR UPDATE
    ), eligible AS (
      SELECT draft.* FROM draft
      WHERE COALESCE(draft.base_published_version, 0) = COALESCE((SELECT version_number FROM current_published), 0)
    ), superseded AS (
      UPDATE cms_content_revisions SET state = 'superseded'
      WHERE resource_type = $2 AND resource_id = $3 AND state = 'published'
        AND EXISTS (SELECT 1 FROM eligible)
    ), published AS (
      UPDATE cms_content_revisions SET state = 'published', published_at = now()
      WHERE id = $1 AND EXISTS (SELECT 1 FROM eligible)
      RETURNING id
    )`;
  if (resourceType === "estate") return `${common}
    INSERT INTO estates (id, slug, name_zh, name_en, district_slug, developer, year_completed,
      phases, total_units, area_min, area_max, description, hero_image, facilities,
      seo_title, seo_description, published)
    SELECT resource_id, payload->>'slug', payload->>'name_zh', payload->>'name_en',
      payload->>'district_slug', payload->>'developer', (payload->>'year_completed')::int,
      (payload->>'phases')::int, (payload->>'total_units')::int, (payload->>'area_min')::int,
      (payload->>'area_max')::int, payload->>'description', payload->>'hero_image',
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(payload->'facilities', '[]'::jsonb))),
      payload->>'seo_title', payload->>'seo_description', true FROM eligible
    ON CONFLICT (id) DO UPDATE SET slug=EXCLUDED.slug, name_zh=EXCLUDED.name_zh,
      name_en=EXCLUDED.name_en, district_slug=EXCLUDED.district_slug, developer=EXCLUDED.developer,
      year_completed=EXCLUDED.year_completed, phases=EXCLUDED.phases, total_units=EXCLUDED.total_units,
      area_min=EXCLUDED.area_min, area_max=EXCLUDED.area_max, description=EXCLUDED.description,
      hero_image=EXCLUDED.hero_image, facilities=EXCLUDED.facilities, seo_title=EXCLUDED.seo_title,
      seo_description=EXCLUDED.seo_description, published=true, updated_at=now() RETURNING id`;
  if (resourceType === "article") return `${common}
    INSERT INTO articles (id, slug, title, excerpt, content, cover_image, category,
      reading_minutes, published, published_at, seo_title, seo_description)
    SELECT resource_id, payload->>'slug', payload->>'title', payload->>'excerpt', payload->>'content',
      payload->>'cover_image', payload->>'category', COALESCE((payload->>'reading_minutes')::int, 5),
      true, now(), payload->>'seo_title', payload->>'seo_description' FROM eligible
    ON CONFLICT (id) DO UPDATE SET slug=EXCLUDED.slug, title=EXCLUDED.title, excerpt=EXCLUDED.excerpt,
      content=EXCLUDED.content, cover_image=EXCLUDED.cover_image, category=EXCLUDED.category,
      reading_minutes=EXCLUDED.reading_minutes, published=true, published_at=now(),
      seo_title=EXCLUDED.seo_title, seo_description=EXCLUDED.seo_description, updated_at=now() RETURNING id`;
  if (resourceType === "video") return `${common}
    INSERT INTO cms_videos (id, title, video_url, description, sort_order, published)
    SELECT resource_id, payload->>'title', payload->>'video_url', payload->>'description',
      COALESCE((payload->>'sort_order')::int, 0), true FROM eligible
    ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, video_url=EXCLUDED.video_url,
      description=EXCLUDED.description, sort_order=EXCLUDED.sort_order, published=true, updated_at=now()
    RETURNING id`;
  if (resourceType === "faq") return `${common}
    INSERT INTO faqs (id, scope, question, answer, sort_order, published)
    SELECT resource_id, payload->>'scope', payload->>'question', payload->>'answer',
      COALESCE((payload->>'sort_order')::int, 0), true FROM eligible
    ON CONFLICT (id) DO UPDATE SET scope=EXCLUDED.scope, question=EXCLUDED.question,
      answer=EXCLUDED.answer, sort_order=EXCLUDED.sort_order, published=true RETURNING id`;
  return `${common}
    INSERT INTO media_assets (id, url, pathname, content_type, size_bytes, alt_text,
      owner_type, owner_id, created_by, archived_at)
    SELECT resource_id, payload->>'url', payload->>'pathname', payload->>'content_type',
      (payload->>'size_bytes')::bigint, payload->>'alt_text', COALESCE(payload->>'owner_type', 'property'),
      NULLIF(payload->>'owner_id', '')::uuid, created_by, null FROM eligible
    ON CONFLICT (id) DO UPDATE SET url=EXCLUDED.url, pathname=EXCLUDED.pathname,
      content_type=EXCLUDED.content_type, size_bytes=EXCLUDED.size_bytes, alt_text=EXCLUDED.alt_text,
      owner_type=EXCLUDED.owner_type, owner_id=EXCLUDED.owner_id, archived_at=null RETURNING id`;
}

export async function publishAdminCmsRevision(input: CmsPublishInput, request: Request) {
  const actor = await requireStaffAccess(request, ["admin", "manager"]);
  const revisionRows = await queryRows<RevisionRow>(
    `SELECT id, resource_type, resource_id, version_number, state, payload,
      base_published_version, created_at, created_by
     FROM cms_content_revisions WHERE id = $1 LIMIT 1`,
    [input.revisionId],
  );
  const revision = revisionRows[0];
  if (!revision || revision.state !== "draft") throw new Error("CMS_REVISION_NOT_FOUND");
  assertResourceType(revision.resource_type);
  if (revision.resource_type !== input.resourceType || String(revision.resource_id) !== input.resourceId) {
    throw new Error("CMS_REVISION_MISMATCH");
  }
  validatePayload(revision.resource_type, payloadRecord(revision.payload));
  const result = await getSql().query(projectorSql(revision.resource_type), [
    input.revisionId,
    input.resourceType,
    input.resourceId,
  ]);
  if (!Array.isArray(result) || !result[0]) {
    return { ok: false, code: "CMS_REVISION_CONFLICT" as const };
  }
  await writeAudit(actor.staffId, "cms_published", input.resourceType, input.resourceId, {
    revisionId: input.revisionId,
  });
  return { ok: true, revisionId: input.revisionId, publishedAt: new Date().toISOString() };
}

export async function restoreAdminCmsRevision(input: CmsRestoreInput, request: Request) {
  const actor = await requireStaffAccess(request, ["admin", "manager"]);
  const rows = await queryRows<RevisionRow>(
    `SELECT id, resource_type, resource_id, version_number, state, payload,
      base_published_version, created_at, created_by
     FROM cms_content_revisions WHERE id = $1 LIMIT 1`,
    [input.revisionId],
  );
  const revision = rows[0];
  if (!revision) throw new Error("CMS_REVISION_NOT_FOUND");
  assertResourceType(revision.resource_type);
  const draft = makeRestoreDraft({
    id: stringOrEmpty(revision.id),
    resource_type: revision.resource_type,
    resource_id: stringOrEmpty(revision.resource_id),
    version_number: Number(revision.version_number),
    payload: payloadRecord(revision.payload),
  });
  const saved = await saveDraftForActor(draft, actor);
  await writeAudit(actor.staffId, "cms_restored", draft.resourceType, draft.resourceId, {
    revisionId: saved.revisionId,
    restoredFromRevisionId: input.revisionId,
  });
  return saved;
}

async function mediaIsReferenced(resourceId: string) {
  const rows = await queryRows(
    `SELECT EXISTS (
       SELECT 1 FROM media_assets media
       WHERE media.id = $1 AND (
         EXISTS (SELECT 1 FROM estates WHERE hero_image = media.url)
         OR EXISTS (SELECT 1 FROM articles WHERE cover_image = media.url)
         OR EXISTS (SELECT 1 FROM properties WHERE media.url = ANY(images))
       )
     ) AS referenced`,
    [resourceId],
  );
  return rows[0]?.referenced === true;
}

export async function archiveAdminCmsResource(input: CmsArchiveInput, request: Request) {
  const actor = await requireStaffAccess(request, ["admin", "manager"]);
  assertResourceType(input.resourceType);
  if (input.resourceType === "media" && (await mediaIsReferenced(input.resourceId))) {
    return { ok: false, code: "CMS_MEDIA_IN_USE" as const };
  }
  const sourceRows = await queryRows<RevisionRow>(
    `SELECT id, resource_type, resource_id, version_number, state, payload,
      base_published_version, created_at, created_by
     FROM cms_content_revisions
     WHERE resource_type = $1 AND resource_id = $2
     ORDER BY version_number DESC LIMIT 1`,
    [input.resourceType, input.resourceId],
  );
  const source = sourceRows[0];
  if (!source) return { ok: false, code: "CMS_RESOURCE_NOT_FOUND" as const };
  await queryRows(
    `INSERT INTO cms_content_revisions (
       resource_type, resource_id, version_number, state, payload, created_by
     )
     SELECT $1, $2, COALESCE(MAX(version_number), 0) + 1, 'archived', $3::jsonb, $4
     FROM cms_content_revisions WHERE resource_type = $1 AND resource_id = $2`,
    [input.resourceType, input.resourceId, JSON.stringify(source.payload), actor.staffId],
  );
  const visibilitySql: Record<CmsResourceType, string> = {
    estate: "UPDATE estates SET published = false, updated_at = now() WHERE id = $1",
    article: "UPDATE articles SET published = false, updated_at = now() WHERE id = $1",
    video: "UPDATE cms_videos SET published = false, updated_at = now() WHERE id = $1",
    faq: "UPDATE faqs SET published = false WHERE id = $1",
    media: "UPDATE media_assets SET archived_at = now() WHERE id = $1",
  };
  await queryRows(visibilitySql[input.resourceType], [input.resourceId]);
  await queryRows(
    `UPDATE cms_content_revisions SET state = 'superseded'
     WHERE resource_type = $1 AND resource_id = $2 AND state = 'published'`,
    [input.resourceType, input.resourceId],
  );
  await writeAudit(actor.staffId, "cms_archived", input.resourceType, input.resourceId);
  return { ok: true };
}
