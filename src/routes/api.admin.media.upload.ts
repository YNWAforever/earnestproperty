import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { createVercelBlobStore } from "@/lib/media/vercel-blob.mjs";
import { requireStaffAccess } from "@/lib/neon/auth.server";
import { createMediaUploadService } from "@/lib/media/media-upload-service";
import { mediaUploadRepository } from "@/lib/media/media-upload-repository.server";

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
        const length = Number(request.headers.get("content-length"));
        if (length > MAX_UPLOAD_BYTES + 65536)
          return Response.json({ ok: false, error: "FILE_TOO_LARGE" }, { status: 413 });
        let form: FormData;
        try {
          const reader = request.body?.getReader();
          if (!reader) throw new Error("EMPTY_BODY");
          const chunks: Uint8Array<ArrayBuffer>[] = [];
          let bytes = 0;
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            bytes += next.value.byteLength;
            if (bytes > MAX_UPLOAD_BYTES + 65536) {
              await reader.cancel();
              return Response.json({ ok: false, error: "FILE_TOO_LARGE" }, { status: 413 });
            }
            chunks.push(new Uint8Array(next.value));
          }
          form = await new Response(new Blob(chunks), {
            headers: { "content-type": request.headers.get("content-type") ?? "" },
          }).formData();
        } catch {
          return Response.json({ ok: false, error: "INVALID_UPLOAD_BODY" }, { status: 400 });
        }
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

        const uploadId = String(form.get("uploadId") ?? "");
        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)
        ) {
          return Response.json({ ok: false, error: "UPLOAD_ID_REQUIRED" }, { status: 400 });
        }
        const token = process.env.BLOB_READ_WRITE_TOKEN;
        if (!token || !token.split("_")[3])
          return Response.json({ ok: false, error: "UPLOAD_UNAVAILABLE" }, { status: 503 });
        try {
          const blobStore = createVercelBlobStore({ token });
          const upload = createMediaUploadService({
            repo: mediaUploadRepository,
            put: blobStore.put,
            secret: token,
          });
          const result = await upload({
            file,
            ownerType,
            staffId: staff.staffId,
            uploadId,
            receipt: String(form.get("receipt") ?? ""),
          });
          return Response.json(result, { status: result.ok ? 200 : result.status });
        } catch {
          return Response.json(
            { ok: false, error: "UPLOAD_UNAVAILABLE", uploadId },
            { status: 503 },
          );
        }
      },
    },
  },
});
