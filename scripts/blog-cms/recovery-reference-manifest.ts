import { z } from "zod";
import { canonical, fingerprint } from "../../src/lib/blog/reconcile";
import { decodeReferenceValue, parseMediaSources } from "./recovery-media-syntax";

export const referenceTables = [
  "media_upload_intents",
  "media_assets",
  "articles",
  "cms_content_revisions",
] as const;
const text = z
  .string()
  .min(1)
  .refine((v) => v.trim() === v);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const referenceManifestSchema = z.array(
  z
    .object({
      source: z.enum(referenceTables),
      rowId: text,
      rowSha256: hash,
      references: z.array(
        z
          .object({
            path: text,
            value: z.string().min(1),
            storeId: text.nullable(),
            objectKey: text.nullable(),
            disposition: z.enum(["inventory", "reviewed-external"]),
          })
          .strict(),
      ),
    })
    .strict(),
);
export const uploadReferenceSchema = z
  .object({
    uploadId: text,
    pathname: text,
    state: z.enum(["completed", "held"]),
    objectKey: text.nullable(),
    disposition: z.enum(["completed-object", "pending-object-held", "pending-absent-held"]),
  })
  .strict();
const rowSchemas = {
  media_upload_intents: z
    .object({ id: text, pathname: text, url: text.nullable(), completed_at: text.nullable() })
    .passthrough(),
  media_assets: z
    .object({ id: text, pathname: text.nullable(), url: text, upload_intent_id: text.nullable() })
    .passthrough(),
  articles: z
    .object({
      id: text,
      cover_image: z.string().nullable(),
      content: z.string().nullable(),
      content_format: z.enum(["legacy-text", "editor-json-v1"]),
    })
    .passthrough(),
  cms_content_revisions: z
    .object({ id: text, resource_type: text, payload: z.record(z.unknown()) })
    .passthrough(),
};
const requireEvidence = (condition: boolean, code: string) => {
  if (!condition) throw new Error("RECOVERY_REFERENCE_" + code);
};
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Conservative enumeration across ALL row fields, including every revision resource/state.
 * JSON-in-text is recursively inspected. Legacy HTML/Markdown media and absolute URLs
 * are retained; external/static references require an exact reviewed exclusion.
 */
function sourceValues(row: Record<string, unknown>) {
  const found: { path: string; value: string; decoded: string }[] = [];
  function visit(value: unknown, path: string, field: string, depth: number) {
    requireEvidence(depth < 80, "DEPTH");
    if (Array.isArray(value)) {
      value.forEach((v, i) => visit(v, path + "/" + i, field, depth + 1));
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value).sort(([a], [b]) => compare(a, b)))
        visit(v, path + "/" + k.replace(/~/g, "~0").replace(/\//g, "~1"), k, depth + 1);
    } else if (typeof value === "string" && value.length) {
      if (["{", "["].includes(value.trimStart()[0])) {
        let nested: unknown;
        try {
          nested = JSON.parse(value);
        } catch {
          /* Legacy text is scanned below. */
        }
        if (nested && typeof nested === "object") {
          visit(nested, path + "/@json", field, depth + 1);
          return;
        }
      }
      for (const candidate of parseMediaSources(value, field)) found.push({ path, ...candidate });
    }
  }
  visit(row, "", "", 0);
  return found;
}

type Scope = { storeId: string; host: string; prefix: string };
type Table = { name: string; rows: number; sha256: string };
export function validateReferenceManifest(input: {
  tables: Table[];
  artifacts: ReadonlyMap<string, Uint8Array>;
  source: Scope;
  objects: { key: string }[];
  excludedReferenceValues: string[];
  manifest: z.infer<typeof referenceManifestSchema>;
  uploads: {
    rowsSha256: string;
    references: z.infer<typeof uploadReferenceSchema>[];
    pending: number;
  };
}) {
  const inventory = new Set(input.objects.map((o) => o.key));
  function resolve(value: string, decoded = decodeReferenceValue(value)) {
    let url: URL | undefined;
    try {
      url = new URL(decoded.startsWith("//") ? "https:" + decoded : decoded);
    } catch {
      /* Only exact reviewed exclusions may be non-URLs. */
    }
    // A source-host reference can NEVER be hidden behind an exclusion or a different prefix.
    if (url?.hostname === input.source.host) {
      const pathname = url.pathname.slice(1);
      requireEvidence(
        url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          !url.port &&
          !url.search &&
          !url.hash &&
          decoded === `https://${input.source.host}/${pathname}` &&
          pathname.startsWith(input.source.prefix) &&
          inventory.has(pathname),
        "OBJECT",
      );
      return {
        storeId: input.source.storeId,
        objectKey: pathname,
        disposition: "inventory" as const,
      };
    }
    requireEvidence(input.excludedReferenceValues.includes(value), "UNREVIEWED_EXTERNAL");
    return { storeId: null, objectKey: null, disposition: "reviewed-external" as const };
  }
  const expected: z.infer<typeof referenceManifestSchema> = [];
  const uploads: z.infer<typeof uploadReferenceSchema>[] = [];
  const archiveHashes: string[] = [];
  for (const source of referenceTables) {
    const table = input.tables.find((t) => t.name === "public." + source)!;
    const bytes = input.artifacts.get(table.sha256);
    requireEvidence(bytes instanceof Uint8Array, "CAPTURE_MISSING");
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.from(bytes!).toString("utf8"));
    } catch {
      throw new Error("RECOVERY_REFERENCE_CAPTURE_JSON");
    }
    const rows = z.array(rowSchemas[source]).safeParse(raw);
    requireEvidence(rows.success, "CAPTURE_SCHEMA");
    if (!rows.success) throw new Error("RECOVERY_REFERENCE_CAPTURE_SCHEMA");
    requireEvidence(
      canonical(rows.data) === canonical(raw) &&
        canonical(raw) === Buffer.from(bytes!).toString("utf8") &&
        fingerprint(raw) === table.sha256 &&
        rows.data.length === table.rows &&
        rows.data.every((r, i) => i === 0 || compare(rows.data[i - 1].id, r.id) < 0),
      "CAPTURE_BINDING",
    );
    archiveHashes.push(table.sha256);
    if (source === "media_upload_intents")
      requireEvidence(input.uploads.rowsSha256 === table.sha256, "UPLOAD_DIGEST");
    for (const row of rows.data) {
      const refs = sourceValues(row).map(({ path, value, decoded }) => ({
        path,
        value,
        ...resolve(value, decoded),
      }));
      expected.push({ source, rowId: row.id, rowSha256: fingerprint(row), references: refs });
      if (source === "media_upload_intents") {
        const intent = rowSchemas.media_upload_intents.parse(row);
        requireEvidence(
          intent.pathname.startsWith(input.source.prefix) &&
            !/[\\%?#]/.test(intent.pathname) &&
            intent.pathname.split("/").every((v) => !!v && v !== "." && v !== ".."),
          "UPLOAD_PATH",
        );
        const exists = inventory.has(intent.pathname),
          completed = intent.url !== null;
        requireEvidence(completed === (intent.completed_at !== null), "UPLOAD_STATE");
        if (completed)
          requireEvidence(resolve(intent.url!).objectKey === intent.pathname, "UPLOAD_PATH");
        uploads.push({
          uploadId: intent.id,
          pathname: intent.pathname,
          state: completed ? "completed" : "held",
          objectKey: exists ? intent.pathname : null,
          disposition: completed
            ? "completed-object"
            : exists
              ? "pending-object-held"
              : "pending-absent-held",
        });
      }
      if (source === "media_assets") {
        const asset = rowSchemas.media_assets.parse(row),
          resolved = resolve(asset.url);
        if (resolved.objectKey !== null && asset.pathname !== null)
          requireEvidence(asset.pathname === resolved.objectKey, "ASSET_PATH");
      }
      if (source === "articles" && row.content_format === "editor-json-v1") {
        try {
          requireEvidence(typeof JSON.parse(String(row.content)) === "object", "EDITOR_CONTENT");
        } catch {
          throw new Error("RECOVERY_REFERENCE_EDITOR_CONTENT");
        }
      }
    }
  }
  requireEvidence(canonical(expected) === canonical(input.manifest), "MANIFEST");
  requireEvidence(
    canonical(uploads) === canonical(input.uploads.references) &&
      input.uploads.pending === uploads.filter((r) => r.state === "held").length,
    "UPLOAD_ROWS",
  );
  return archiveHashes;
}
