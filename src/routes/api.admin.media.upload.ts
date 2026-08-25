import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { createVercelBlobStore } from "@/lib/media/vercel-blob.mjs";
import { requireStaffAccess } from "@/lib/neon/auth.server";
import { queryRows } from "@/lib/neon/db.server";

/**
 * Both uploaders in the app (ImageUploader.tsx and the CMS media picker in
 * admin.cms.tsx) already restrict to exactly these four types and 5 MB -- but
 * only in the browser. Any agent-role token could POST here directly with an
 * arbitrary MIME type and size, and the value went straight through to a
 * PUBLIC blob whose content-type the caller controlled. Enforcing it here is
 * what actually makes the client-side checks true.
 */
const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** media_assets.owner_type is a bare TEXT column with no CHECK constraint. */
const ALLOWED_OWNER_TYPES = ["property", "estate", "article", "agent", "cms"];

export const Route = createFileRoute("/api/admin/media/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const staff = await requireStaffAccess(request, ["admin", "manager", "agent"]);
        const form = await request.formData();
        const file = form.get("file");
        const requestedOwnerType = String(form.get("ownerType") ?? "property");
        const ownerType = ALLOWED_OWNER_TYPES.includes(requestedOwnerType)
          ? requestedOwnerType
          : "property";
        if (!(file instanceof File)) {
          return Response.json({ ok: false, error: "file is required" }, { status: 400 });
        }

        if (!ALLOWED_CONTENT_TYPES.includes(file.type)) {
          return Response.json(
            { ok: false, error: "UNSUPPORTED_MEDIA_TYPE", allowed: ALLOWED_CONTENT_TYPES },
            { status: 415 },
          );
        }

        // Distinct from the size cap: a 0-byte part is a malformed upload, not
        // an oversized one, and answering 413 FILE_TOO_LARGE told the user to
        // shrink a file that was already empty.
        if (file.size <= 0) {
          return Response.json({ ok: false, error: "EMPTY_FILE" }, { status: 400 });
        }

        if (file.size > MAX_UPLOAD_BYTES) {
          return Response.json(
            { ok: false, error: "FILE_TOO_LARGE", maxBytes: MAX_UPLOAD_BYTES },
            { status: 413 },
          );
        }

        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        const token = process.env.BLOB_READ_WRITE_TOKEN;
        if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
        const storeId = token.split("_")[3];
        if (!storeId) throw new Error("BLOB_READ_WRITE_TOKEN is invalid");
        // The shared adapter owns the existing https://vercel.com/api/blob endpoint and headers.
        const blobStore = createVercelBlobStore({ token });
        const blob = await blobStore.put({
          pathname: `${ownerType}/${staff.staffId}/${crypto.randomUUID()}-${safeName}`,
          body: file,
          contentType: file.type,
        });

        await queryRows(
          `
          INSERT INTO media_assets (url, pathname, content_type, size_bytes, owner_type, created_by)
          VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [blob.url, blob.pathname, file.type, file.size, ownerType, staff.staffId],
        );

        return Response.json({ ok: true, url: blob.url, pathname: blob.pathname });
      },
    },
  },
});
