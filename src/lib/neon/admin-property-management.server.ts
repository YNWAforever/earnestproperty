import "@tanstack/react-start/server-only";
import type { StaffAccess } from "./auth.server";
import { propertyManagementSchema, type PropertyManagementInput } from "./admin-properties.types";
import { queryRows } from "./db.server";

/** All validation, current-offer locks, permissions, overrides and audit share one DB transaction. */
export async function saveAdminPropertyManagement(
  input: PropertyManagementInput,
  actor: StaffAccess,
): Promise<{ ok: true }> {
  if (!input || typeof input.propertyNo !== "string" || typeof input.expectedVersion !== "string") {
    throw new Response("Invalid property patch", { status: 400 });
  }
  const validated = propertyManagementSchema.safeParse(input);
  if (!validated.success) throw new Response("Invalid property patch", { status: 400 });
  input = validated.data;
  try {
    await queryRows("SELECT admin_property_manage($1,$2,$3,$4::jsonb,$5::uuid) AS result", [
      input.propertyNo,
      input.expectedVersion,
      input.scope,
      JSON.stringify(input.payload),
      actor.staffId,
    ]);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("ADMIN_PROPERTY_CONFLICT") ||
      /deadlock detected|could not serialize access/.test(message)
    )
      throw new Response("物業資料已被更新。請重新載入並核對後再儲存。", { status: 409 });
    if (message.includes("FORBIDDEN")) throw new Response("Forbidden", { status: 403 });
    if (message.includes("PROPERTY_NOT_FOUND"))
      throw new Response("Property not found", { status: 404 });
    if (message.includes("INVALID_PROPERTY") || /invalid input syntax|out of range/.test(message))
      throw new Response("Invalid property patch", { status: 400 });
    if (/does not exist/.test(message))
      throw new Response("物業管理功能尚未準備完成，暫時未能儲存。", { status: 503 });
    throw error;
  }
}
