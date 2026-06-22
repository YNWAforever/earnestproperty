import "@tanstack/react-start/server-only";

import { put } from "@vercel/blob";
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
        const blob = await put(
          `${ownerType}/${staff.staffId}/${crypto.randomUUID()}-${safeName}`,
          file,
          {
            access: "public",
            contentType: file.type,
          },
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
