/**
 * Optimistic-concurrency token for a FAQ or CMS video row (FX-18a, C-12).
 *
 * faqs has no updated_at, and cms_videos.updated_at moves on every YouTube sync
 * run, so neither can be the token. The version is an md5 over the staff-editable
 * fields only: it changes when a colleague changes what staff edit, and never
 * because the sync touched youtube_* columns or updated_at. Postgres generates,
 * compares (under FOR UPDATE) and returns it with the same expression; callers
 * treat it as opaque.
 *
 * Pure module with no server-only import, so the client can share the constants.
 */

export type CmsRowResource = "faq" | "video";

/** Staff-editable fields only. faq: scope, question, answer, sort_order, published.
 *  video: title, video_url, description, sort_order, published, category. */
export const CMS_ROW_VERSION_FIELDS: Readonly<Record<CmsRowResource, readonly string[]>> =
  Object.freeze({
    faq: Object.freeze(["scope", "question", "answer", "sort_order", "published"]),
    video: Object.freeze([
      "title",
      "video_url",
      "description",
      "sort_order",
      "published",
      "category",
    ]),
  });

/** `jsonb_build_object('<field>', <alias>.<field>, …)` over the staff fields. */
export function cmsRowFieldsJsonSql(resource: CmsRowResource, alias: string): string {
  if (!/^[a-z_]+$/.test(alias)) throw new Error("cmsRowVersionSql: unsafe alias");
  if (!Object.prototype.hasOwnProperty.call(CMS_ROW_VERSION_FIELDS, resource)) {
    throw new Error("cmsRowVersionSql: unknown resource");
  }
  const pairs = CMS_ROW_VERSION_FIELDS[resource].map((field) => `'${field}',${alias}.${field}`);
  return `jsonb_build_object(${pairs.join(",")})`;
}

/** md5(jsonb_build_object(<field>, <alias>.<field>, …)::text). alias must match /^[a-z_]+$/ or it throws. */
export function cmsRowVersionSql(resource: CmsRowResource, alias: string): string {
  return `md5(${cmsRowFieldsJsonSql(resource, alias)}::text)`;
}

export const CMS_ROW_VERSION_PATTERN = /^[0-9a-f]{32}$/;

export function isCmsRowVersion(value: unknown): value is string {
  return typeof value === "string" && CMS_ROW_VERSION_PATTERN.test(value);
}

/** 409 body: a colleague saved this FAQ or video since it was read. */
export const CMS_ROW_CHANGED = "CMS_ROW_CHANGED";
/** 400 body: the save carried no valid version (e.g. a pre-deploy bundle). */
export const CMS_ROW_VERSION_REQUIRED = "CMS_ROW_VERSION_REQUIRED";
/** 409 body / returned error: the FAQ is archived (published = false). */
export const FAQ_ARCHIVED = "FAQ_ARCHIVED";
/** Returned error: a new FAQ matches an archived question in the same scope. */
export const FAQ_ARCHIVED_DUPLICATE = "FAQ_ARCHIVED_DUPLICATE";
