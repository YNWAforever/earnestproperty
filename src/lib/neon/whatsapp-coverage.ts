import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { withStaffAuthHeaders } from "@/auth";
import { z } from "zod";

const filterSchema = z
  .object({
    dealType: z.enum(["sale", "rent"]).optional(),
    q: z.string().trim().max(100).optional(),
    missingOnly: z.boolean().optional(),
  })
  .strict();
const coverage = createServerFn({ method: "GET" })
  .inputValidator(filterSchema)
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    return (await import("./whatsapp-coverage.server")).getWebsiteTrackingCoverage(
      data,
      await requireStaffAccess(getRequest(), ["admin", "manager"]),
    );
  });
const preview = createServerFn({ method: "POST" })
  .inputValidator(z.object({ propertyIds: z.array(z.string().uuid()).min(1).max(1000) }).strict())
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    return (await import("./whatsapp-coverage.server")).previewCoverageBackfill(
      data,
      await requireStaffAccess(getRequest(), ["admin", "manager"]),
    );
  });
export const getWebsiteTrackingCoverage = async (filters: z.infer<typeof filterSchema> = {}) =>
  coverage(await withStaffAuthHeaders({ data: filters }));
export const previewCoverageBackfill = async (propertyIds: string[]) =>
  preview(await withStaffAuthHeaders({ data: { propertyIds } }));
