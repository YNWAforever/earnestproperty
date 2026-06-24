import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { requireStaffAccess } from "@/lib/neon/auth.server";
import { queryRows } from "@/lib/neon/db.server";

export const Route = createFileRoute("/api/admin/media/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const staff = await requireStaffAccess(request, ["admin", "manager", "agent"]);
        const form = await request.formData();
        const file = form.get("file");
        const ownerType = String(form.get("ownerType") ?? "property");
        if (!(file instanceof File)) {
          return Response.json({ ok: false, error: "file is required" }, { status: 400 });
        }

        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        const blob = await putPublicBlob(
          `${ownerType}/${staff.staffId}/${crypto.randomUUID()}-${safeName}`,
          file,
        );

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

async function putPublicBlob(pathname: string, file: File) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not configured");

  const storeId = token.split("_")[3];
  if (!storeId) throw new Error("BLOB_READ_WRITE_TOKEN is invalid");

  const params = new URLSearchParams({ pathname });
  const response = await fetch(`https://vercel.com/api/blob/?${params.toString()}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "x-api-version": "12",
      "x-vercel-blob-store-id": storeId,
      "x-vercel-blob-access": "public",
      "x-content-type": file.type || "application/octet-stream",
    },
    body: file,
  });

  if (!response.ok) {
    throw new Error(`Vercel Blob upload failed: ${response.status}`);
  }

  const result = (await response.json()) as {
    url?: unknown;
    pathname?: unknown;
    contentType?: unknown;
    etag?: unknown;
  };

  if (typeof result.url !== "string" || typeof result.pathname !== "string") {
    throw new Error("Vercel Blob upload returned an invalid response");
  }

  return {
    url: result.url,
    pathname: result.pathname,
    contentType: typeof result.contentType === "string" ? result.contentType : file.type,
    etag: typeof result.etag === "string" ? result.etag : null,
  };
}
