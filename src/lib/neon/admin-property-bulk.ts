import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { withStaffAuthHeaders } from "@/auth";
import { unwrapServerFnResponse } from "./server-fn-response.ts";
import {
  bulkPropertyManagementSchema,
  type BulkPropertyManagementInput,
  type BulkPropertyResult,
} from "./admin-property-bulk.types";

const applyServer = createServerFn({ method: "POST" })
  .inputValidator(bulkPropertyManagementSchema)
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager", "agent"]);
    const { runAdminPropertyBulk } = await import("./admin-property-bulk.server");
    return runAdminPropertyBulk(data, actor);
  });

export async function applyAdminPropertyBulk(input: {
  data: BulkPropertyManagementInput;
}): Promise<BulkPropertyResult[]> {
  return unwrapServerFnResponse(applyServer(await withStaffAuthHeaders(input)));
}
