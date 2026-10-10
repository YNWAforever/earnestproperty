import { expect, test } from "bun:test";
import {
  CMS_ROW_CHANGED,
  CMS_ROW_VERSION_FIELDS,
  CMS_ROW_VERSION_PATTERN,
  CMS_ROW_VERSION_REQUIRED,
  cmsRowVersionSql,
  isCmsRowVersion,
} from "./cms-row-version";

test("emits the exact md5 expression over the staff fields and rejects unsafe aliases", () => {
  expect(cmsRowVersionSql("faq", "f")).toBe(
    "md5(jsonb_build_object('scope',f.scope,'question',f.question,'answer',f.answer," +
      "'sort_order',f.sort_order,'published',f.published)::text)",
  );
  expect(cmsRowVersionSql("video", "old_row")).toBe(
    "md5(jsonb_build_object('title',old_row.title,'video_url',old_row.video_url," +
      "'description',old_row.description,'sort_order',old_row.sort_order," +
      "'published',old_row.published,'category',old_row.category)::text)",
  );
  for (const alias of ["f; drop", "", "F", "f.x", "f1"]) {
    expect(() => cmsRowVersionSql("faq", alias)).toThrow();
  }
  expect(() => cmsRowVersionSql("estate" as never, "f")).toThrow();
  expect(CMS_ROW_CHANGED).toBe("CMS_ROW_CHANGED");
  expect(CMS_ROW_VERSION_REQUIRED).toBe("CMS_ROW_VERSION_REQUIRED");
});

test("video fields exclude youtube_* and updated_at", () => {
  expect([...CMS_ROW_VERSION_FIELDS.video]).toEqual([
    "title",
    "video_url",
    "description",
    "sort_order",
    "published",
    "category",
  ]);
  expect([...CMS_ROW_VERSION_FIELDS.faq]).toEqual([
    "scope",
    "question",
    "answer",
    "sort_order",
    "published",
  ]);
  for (const fields of Object.values(CMS_ROW_VERSION_FIELDS)) {
    for (const field of fields) {
      expect(field.startsWith("youtube_")).toBe(false);
      expect(["updated_at", "created_at", "id"]).not.toContain(field);
    }
  }
  const sql = cmsRowVersionSql("video", "v");
  expect(sql).not.toContain("youtube_");
  expect(sql).not.toContain("updated_at");
});

test("isCmsRowVersion accepts only a lowercase 32-hex md5", () => {
  expect(isCmsRowVersion("0123456789abcdef0123456789abcdef")).toBe(true);
  expect(CMS_ROW_VERSION_PATTERN.test("0123456789abcdef0123456789abcdef")).toBe(true);
  for (const value of [
    "0123456789ABCDEF0123456789ABCDEF",
    "0123456789abcdef0123456789abcde",
    "0123456789abcdef0123456789abcdef0",
    "2026-10-06T03:04:05.123456Z",
    "",
    null,
    undefined,
    123,
  ]) {
    expect(isCmsRowVersion(value)).toBe(false);
  }
});
