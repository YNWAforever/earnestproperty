import "@tanstack/react-start/server-only";

import { getRequest } from "@tanstack/react-start/server";

import type {
  CmsArchiveInput,
  CmsCategoryResult,
  CmsDraftSaveInput,
  CmsEditorResult,
  CmsHubRow,
  CmsHubView,
  CmsPayloadValue,
  CmsPublishInput,
  CmsRestoreInput,
} from "./admin-cms.types";
import { requireStaffAccess, type StaffAccess } from "./auth.server";
import { dateOrNull, queryRows, stringOrEmpty, stringOrNull } from "./db.server";
import { CMS_RESOURCE_TYPES, type CmsResourceType, type CmsRevisionState } from "./cms-revisions";
import { isMissingCmsVideosTableError } from "./cms-videos-schema";

const ALL_CMS_ROLES = ["admin", "manager", "agent"] as const;
const PUBLISH_ROLES = ["admin", "manager"] as const;

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

async function listHubRows(
  input: {
    view?: CmsHubView;
    query?: string;
    resourceType?: CmsResourceType;
  },
  actor: StaffAccess,
) {
  const params: unknown[] = [actor.staffId];
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
    filters.push(
      `(COALESCE(latest.payload->>'title', latest.payload->>'name_zh', latest.payload->>'question', latest.payload->>'pathname', '') ILIKE $${params.length} OR COALESCE(latest.payload->>'slug', '') ILIKE $${params.length})`,
    );
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  return queryRows(
    `
    WITH latest AS (
      SELECT DISTINCT ON (r.resource_type, r.resource_id)
        r.*
      FROM cms_content_revisions r
      WHERE r.draft_retired_at IS NULL AND (r.state <> 'draft' OR r.created_by = $1::uuid)
      ORDER BY r.resource_type, r.resource_id, (r.state = 'draft') DESC, r.version_number DESC
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
    if (input.resourceType === "video" && isMissingCmsVideosTableError(error)) {
      return { rows: [], unavailableReason: "影片資料表尚未建立" };
    }
    throw error;
  }
}

export async function fetchAdminCmsEditor(input: {
  resourceType: CmsResourceType;
  resourceId: string;
  reviewDraftRevisionId?: string;
}): Promise<CmsEditorResult> {
  assertResourceType(input.resourceType);
  const actor = await staffForRead();
  if (input.reviewDraftRevisionId && !PUBLISH_ROLES.some((role) => actor.roles.includes(role)))
    throw new Error("CMS_REVIEW_FORBIDDEN");
  const selected = await queryRows(
    `SELECT * FROM cms_content_revisions WHERE resource_type = $1 AND resource_id = $2 AND state = 'draft' AND draft_retired_at IS NULL
       AND (($4::uuid IS NULL AND created_by = $3::uuid) OR id = $4::uuid)
     ORDER BY version_number DESC LIMIT 1`,
    [input.resourceType, input.resourceId, actor.staffId, input.reviewDraftRevisionId ?? null],
  );
  if (input.reviewDraftRevisionId && !selected[0]) throw new Error("CMS_REVISION_NOT_FOUND");
  const publication = await queryRows(
    `SELECT * FROM cms_content_revisions WHERE resource_type = $1 AND resource_id = $2 AND state = 'published'
     ORDER BY version_number DESC LIMIT 1`,
    [input.resourceType, input.resourceId],
  );
  const latest = selected[0] ?? publication[0];
  const tables: Record<CmsResourceType, string> = {
    estate: "estates",
    article: "articles",
    video: "cms_videos",
    faq: "faqs",
    media: "media_assets",
  };
  // Table names are allowlisted; never use a capped summary for edit recovery.
  const live = latest
    ? []
    : await queryRows(`SELECT * FROM ${tables[input.resourceType]} WHERE id = $1`, [
        input.resourceId,
      ]);
  const raw = latest?.payload ?? live[0];
  const payload: Record<string, CmsPayloadValue> | null = raw
    ? (Object.fromEntries(
        Object.entries(raw as Record<string, unknown>)
          .filter(([key]) => !["created_by", "updated_by"].includes(key))
          .map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
      ) as Record<string, CmsPayloadValue>)
    : null;
  const currentPublishedVersion = publication[0] ? Number(publication[0].version_number) : null;
  const rows = await queryRows(
    `SELECT id, version_number, state, created_at, created_by FROM cms_content_revisions
     WHERE resource_type = $1 AND resource_id = $2 AND draft_retired_at IS NULL AND (state <> 'draft' OR created_by = $3::uuid OR id = $4::uuid)
     ORDER BY version_number DESC LIMIT 20`,
    [input.resourceType, input.resourceId, actor.staffId, input.reviewDraftRevisionId ?? null],
  );
  return {
    publishedPayload: publication[0]?.payload
      ? (publication[0].payload as Record<string, CmsPayloadValue>)
      : null,
    editState: payload
      ? {
          resourceId: input.resourceId,
          draftRevisionId: selected[0] ? stringOrEmpty(selected[0].id) : null,
          draftVersion: selected[0] ? Number(selected[0].version_number) : null,
          draftEditVersion:
            selected[0]?.draft_edit_version == null ? null : Number(selected[0].draft_edit_version),
          currentPublishedVersion,
          basePublishedVersion: selected[0]
            ? selected[0].base_published_version == null
              ? null
              : Number(selected[0].base_published_version)
            : currentPublishedVersion,
          payload,
          restoredFromRevisionId: stringOrNull(selected[0]?.restored_from_revision_id),
        }
      : null,
    row: latest
      ? hubRow({
          ...latest,
          title: payload?.title ?? payload?.name_zh ?? "Untitled",
          slug: payload?.slug,
          latest_revision_id: latest.id,
          latest_version: latest.version_number,
          published_version: currentPublishedVersion,
          updated_at: latest.created_at,
          updated_by: latest.created_by,
        })
      : null,
    revisions: rows.map((revision) => ({
      id: stringOrEmpty(revision.id),
      versionNumber: Number(revision.version_number),
      state: String(revision.state) as CmsRevisionState,
      createdAt: dateOrNull(revision.created_at) ?? new Date(0).toISOString(),
      createdBy: stringOrNull(revision.created_by),
    })),
    payload,
  };
}

// One database invocation owns lock, checks, revision, projection and audit.
async function mutateCms(
  op: string,
  input: {
    resourceType: CmsResourceType;
    resourceId: string;
    payload?: Record<string, unknown>;
    basePublishedVersion?: number | null;
    draftEditVersion?: number | null;
    revisionId?: string;
    draftRevisionId?: string | null;
  },
  actor: StaffAccess,
) {
  assertResourceType(input.resourceType);
  const rows = await queryRows(
    "SELECT cms_mutate($1, $2, $3::uuid, $4::uuid, $5::jsonb, $6::integer, $7::integer, $8::uuid) AS revision",
    [
      op,
      input.resourceType,
      input.resourceId,
      actor.staffId,
      input.payload ? JSON.stringify(input.payload) : null,
      input.basePublishedVersion ?? null,
      input.draftEditVersion ?? null,
      input.revisionId ?? input.draftRevisionId ?? null,
    ],
  );
  const revision = rows[0]?.revision as Record<string, unknown> | undefined;
  if (!revision?.id) throw new Error("CMS_MUTATION_FAILED");
  return revision;
}
function savedResult(row: Record<string, unknown>) {
  const resourceId = stringOrEmpty(row.resource_id);
  return {
    resourceId,
    revisionId: stringOrEmpty(row.id),
    versionNumber: Number(row.version_number),
    savedAt: dateOrNull(row.created_at)!,
    editState: {
      resourceId,
      draftRevisionId: stringOrEmpty(row.id),
      draftVersion: Number(row.version_number),
      draftEditVersion: Number(row.draft_edit_version),
      currentPublishedVersion:
        row.current_published_version == null ? null : Number(row.current_published_version),
      basePublishedVersion:
        row.base_published_version == null ? null : Number(row.base_published_version),
      payload: row.payload as Record<string, CmsPayloadValue>,
      restoredFromRevisionId: stringOrNull(row.restored_from_revision_id),
    },
  };
}
export async function saveAdminCmsDraft(input: CmsDraftSaveInput, request: Request) {
  const actor = await requireStaffAccess(request, ["admin", "manager", "agent"]);
  assertResourceType(input.resourceType);
  const payload = payloadRecord(input.payload);
  validatePayload(input.resourceType, payload);
  if (input.restoredFromRevisionId) throw new Error("CMS_USE_RESTORE_OPERATION");
  const resourceId =
    input.resourceId ?? stringOrEmpty((await queryRows("SELECT gen_random_uuid() AS id"))[0]?.id);
  return savedResult(await mutateCms("save", { ...input, resourceId, payload }, actor));
}
export async function publishAdminCmsRevision(input: CmsPublishInput, request: Request) {
  const actor = await requireStaffAccess(request, ["admin", "manager"]);
  try {
    const revision = await mutateCms("publish", input, actor);
    return {
      ok: true,
      revisionId: input.revisionId,
      publishedAt: dateOrNull(revision.published_at)!,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("CMS_REVISION_CONFLICT"))
      return { ok: false, code: "CMS_REVISION_CONFLICT" as const };
    throw error;
  }
}
export async function restoreAdminCmsRevision(input: CmsRestoreInput, request: Request) {
  const actor = await requireStaffAccess(request, ["admin", "manager"]);
  // Identity only; the locked SQL operation re-reads the historical snapshot and current publication.
  const [source] = await queryRows(
    "SELECT resource_type, resource_id FROM cms_content_revisions WHERE id = $1 LIMIT 1",
    [input.revisionId],
  );
  if (!source) throw new Error("CMS_REVISION_NOT_FOUND");
  assertResourceType(source.resource_type);
  return savedResult(
    await mutateCms(
      "restore",
      {
        resourceType: source.resource_type,
        resourceId: stringOrEmpty(source.resource_id),
        revisionId: input.revisionId,
      },
      actor,
    ),
  );
}
export async function archiveAdminCmsResource(input: CmsArchiveInput, request: Request) {
  const actor = await requireStaffAccess(request, ["admin", "manager"]);
  try {
    await mutateCms("archive", input, actor);
    return { ok: true };
  } catch (error) {
    for (const code of ["CMS_MEDIA_IN_USE", "CMS_RESOURCE_NOT_FOUND"] as const)
      if (error instanceof Error && error.message.includes(code)) return { ok: false, code };
    throw error;
  }
}
