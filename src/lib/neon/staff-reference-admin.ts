import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { withStaffAuthHeaders } from "@/auth";
const list = createServerFn({ method: "GET" }).handler(async () => {
  const { requireStaffAccess } = await import("./auth.server");
  return (await import("./staff-reference-admin.server")).listStaffReferences(
    await requireStaffAccess(getRequest(), ["admin", "manager"]),
  );
});
const save = createServerFn({ method: "POST" })
  .inputValidator(
    z
      .object({
        namespace: z.string().min(1).max(160),
        externalReference: z.string().min(1).max(160),
        staffId: z.string().uuid(),
        verificationRef: z.string().min(1).max(160),
      })
      .strict(),
  )
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    return (await import("./staff-reference-admin.server")).saveStaffReference(
      data,
      await requireStaffAccess(getRequest(), ["admin", "manager"]),
    );
  });
const retire = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    return (await import("./staff-reference-admin.server")).retireStaffReference(
      data,
      await requireStaffAccess(getRequest(), ["admin", "manager"]),
    );
  });
export const fetchStaffReferences = async () => list(await withStaffAuthHeaders({}));
export const createStaffReference = async (data: Parameters<typeof save>[0]["data"]) =>
  save(await withStaffAuthHeaders({ data }));
export const disableStaffReference = async (data: { id: string }) =>
  retire(await withStaffAuthHeaders({ data }));
