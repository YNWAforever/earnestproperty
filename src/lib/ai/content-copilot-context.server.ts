import "@tanstack/react-start/server-only";

import {
  allowedContentCopilotFields,
  contentCopilotRequestSchema,
  normalizeCitationUrl,
  type ContentCopilotEvidence,
  type ContentCopilotRequest,
  type ContentCopilotResourceType,
} from "./content-copilot.ts";
import type { StaffAccess } from "../neon/auth.server.ts";

type Row = Record<string, unknown>;
type QueryRows = (sql: string, params?: unknown[]) => Promise<Row[]>;
type SearchPublicKnowledge = (input: { query: string; limit?: number }) => Promise<unknown[]>;

export type LoadedContentContext = {
  resource: Record<string, unknown>;
  internalEvidence: ContentCopilotEvidence[];
  query: string;
};

export type ContentCopilotContextDeps = {
  queryRows?: QueryRows;
  searchPublicKnowledge?: SearchPublicKnowledge;
};

export function createContentCopilotContextLoader(deps: ContentCopilotContextDeps = {}) {
  const queryRows = deps.queryRows ?? defaultQueryRows;
  const searchPublicKnowledge = deps.searchPublicKnowledge ?? defaultSearchPublicKnowledge;

  return {
    async load(request: ContentCopilotRequest, actor: StaffAccess): Promise<LoadedContentContext> {
      const parsed = contentCopilotRequestSchema.safeParse(request);
      if (!parsed.success) throw copilotError("COPILOT_REQUEST_INVALID");
      assertAccess(parsed.data, actor);

      const row = await fetchResource(queryRows, parsed.data, actor);
      if (!row) throw copilotError("COPILOT_RESOURCE_NOT_FOUND");

      const resource = mapResource(parsed.data.resourceType, row);
      const query = buildSearchQuery(parsed.data.resourceType, resource);
      let internalEvidence: ContentCopilotEvidence[] = [];
      try {
        const chunks = await searchPublicKnowledge({ query, limit: 6 });
        internalEvidence = mapKnowledgeEvidence(chunks);
      } catch {
        internalEvidence = [];
      }

      return { resource, internalEvidence, query };
    },
  };
}

export async function loadContentCopilotContext(
  request: ContentCopilotRequest,
  actor: StaffAccess,
  deps: ContentCopilotContextDeps = {},
) {
  return createContentCopilotContextLoader(deps).load(request, actor);
}

async function fetchResource(
  queryRows: QueryRows,
  request: ContentCopilotRequest,
  actor: StaffAccess,
) {
  const privileged = actor.roles.includes("admin") || actor.roles.includes("manager");
  if (request.resourceType === "estate") {
    return first(
      queryRows(
        `SELECT id, slug, name_zh, name_en, district_slug, developer, year_completed,
        phases, total_units, area_min, area_max, description, facilities,
        seo_title, seo_description, updated_at
       FROM estates
       WHERE id = $1
       LIMIT 1`,
        [request.resourceId],
      ),
    );
  }
  if (request.resourceType === "article") {
    return first(
      queryRows(
        `SELECT id, slug, title, excerpt, content, category, reading_minutes,
        published, published_at, seo_title, seo_description, updated_at
       FROM articles
       WHERE id = $1
       LIMIT 1`,
        [request.resourceId],
      ),
    );
  }
  if (request.resourceType === "faq") {
    return first(
      queryRows(
        `SELECT id, scope, question, answer, sort_order, created_at
       FROM faqs
       WHERE id = $1
       LIMIT 1`,
        [request.resourceId],
      ),
    );
  }
  if (request.resourceType === "video") {
    return first(
      queryRows(
        `SELECT id, title, video_url, description, sort_order, published, created_at, updated_at
       FROM cms_videos
       WHERE id = $1
       LIMIT 1`,
        [request.resourceId],
      ),
    );
  }
  const ownership = privileged
    ? "p.id = $1"
    : "p.id = $1 AND p.agent_id = $2 AND p.status = 'active'";
  const params = privileged ? [request.resourceId] : [request.resourceId, actor.staffId];
  return first(
    queryRows(
      `SELECT
       p.id, p.listing_no, p.title_zh, p.title_en, p.deal_type, p.price, p.rent,
       p.saleable_area, p.gross_area, p.bedrooms, p.bathrooms, p.description,
       p.features, p.status, p.district_slug, p.estate_id, p.seo_title,
       p.seo_description, p.updated_at, e.slug AS estate_slug,
       e.name_zh AS estate_name_zh, e.district_slug AS estate_district_slug,
       s.name_zh AS agent_name_zh, s.name_en AS agent_name_en
     FROM properties p
     LEFT JOIN estates e ON e.id = p.estate_id
     LEFT JOIN staff_users s ON s.id = p.agent_id\n       AND s.active = true\n       AND COALESCE((to_jsonb(s)->>'show_on_website')::boolean, false) = true
     WHERE ${ownership}
     LIMIT 1`,
      params,
    ),
  );
}

function assertAccess(request: ContentCopilotRequest, actor: StaffAccess) {
  const privileged = actor.roles.includes("admin") || actor.roles.includes("manager");
  if (!privileged && !(request.resourceType === "listing" && actor.roles.includes("agent"))) {
    throw new Response("Forbidden", { status: 403 });
  }
}

function mapResource(type: ContentCopilotResourceType, row: Row) {
  const fields = new Set(allowedContentCopilotFields(type));
  const resource: Record<string, unknown> = { id: stringValue(row.id) };
  for (const field of fields) resource[field] = row[field] ?? null;

  if (type === "estate") {
    Object.assign(
      resource,
      pick(row, [
        "slug",
        "district_slug",
        "developer",
        "year_completed",
        "phases",
        "total_units",
        "area_min",
        "area_max",
        "facilities",
        "updated_at",
      ]),
    );
  } else if (type === "article") {
    Object.assign(
      resource,
      pick(row, ["slug", "category", "reading_minutes", "published", "published_at", "updated_at"]),
    );
  } else if (type === "faq") {
    Object.assign(resource, pick(row, ["scope", "sort_order", "created_at"]));
  } else if (type === "video") {
    Object.assign(
      resource,
      pick(row, ["video_url", "sort_order", "published", "created_at", "updated_at"]),
    );
  } else {
    Object.assign(
      resource,
      pick(row, [
        "listing_no",
        "title_en",
        "deal_type",
        "price",
        "rent",
        "saleable_area",
        "gross_area",
        "bedrooms",
        "bathrooms",
        "status",
        "district_slug",
        "estate_id",
        "estate_slug",
        "estate_name_zh",
        "estate_district_slug",
        "agent_name_zh",
        "agent_name_en",
        "updated_at",
      ]),
    );
  }
  return resource;
}

function buildSearchQuery(type: ContentCopilotResourceType, resource: Record<string, unknown>) {
  const values = [
    resource.title,
    resource.title_zh,
    resource.name_zh,
    resource.question,
    resource.estate_name_zh,
    resource.district_slug,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim().slice(0, 160));
  return `${type} ${values.join(" ")}`.trim().slice(0, 500);
}

function mapKnowledgeEvidence(chunks: unknown[]) {
  if (!Array.isArray(chunks)) return [];
  const evidence: ContentCopilotEvidence[] = [];
  for (const chunk of chunks.slice(0, 6)) {
    if (!chunk || typeof chunk !== "object") continue;
    const row = chunk as Row;
    const title = stringValue(row.title).slice(0, 300);
    const excerpt = stringValue(row.excerpt ?? row.chunk_text ?? row.summary).slice(0, 1000);
    if (!title || !excerpt) continue;
    const rawUrl =
      typeof row.url === "string"
        ? row.url
        : typeof row.url_path === "string"
          ? row.url_path
          : null;
    evidence.push({
      id: `internal-${evidence.length + 1}`,
      type: "internal",
      title,
      url: rawUrl && normalizeCitationUrl(rawUrl) ? normalizeCitationUrl(rawUrl) : null,
      excerpt,
    });
  }
  return evidence;
}

function pick(row: Row, keys: string[]) {
  return Object.fromEntries(keys.filter((key) => key in row).map((key) => [key, row[key] ?? null]));
}

function stringValue(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function first(rowsPromise: Promise<Row[]>) {
  return rowsPromise.then((rows) => rows[0] ?? null);
}

async function defaultQueryRows(sql: string, params: unknown[] = []) {
  const module = await import("../neon/db.server.ts");
  return module.queryRows(sql, params) as Promise<Row[]>;
}

async function defaultSearchPublicKnowledge(input: { query: string; limit?: number }) {
  const module = await import("./knowledge.server.ts");
  return module.searchPublicKnowledge(input) as Promise<unknown[]>;
}

function copilotError(code: string) {
  return Object.assign(new Error(code), { code });
}
