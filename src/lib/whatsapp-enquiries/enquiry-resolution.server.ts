import "@tanstack/react-start/server-only";
import { z } from "zod";
import { queryRows } from "../neon/db.server.ts";
import type { StaffAccess } from "../neon/auth.server.ts";

const correctionSchema = z
  .object({
    inquiryId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    propertyId: z.string().uuid().nullable().optional(),
    requestedStaffId: z.string().uuid().nullable().optional(),
    ownerStaffId: z.string().uuid().nullable().optional(),
    reason: z.string().trim().min(3).max(300),
  })
  .strict()
  .refine(
    (value) =>
      value.propertyId !== undefined ||
      value.requestedStaffId !== undefined ||
      value.ownerStaffId !== undefined,
    "ENQUIRY_CHANGE_REQUIRED",
  );
export type ResolutionCommand = z.infer<typeof correctionSchema>;
export type ResolutionResult = {
  inquiryId: string;
  version: number;
  ownerStaffId: string | null;
  resolution: { propertyId?: string | null; requestedStaffId?: string | null };
  providerThreadReview: boolean;
  associationReview: boolean;
};

/** The SQL function performs ACL, version, source and staff rechecks atomically. */
export async function resolveEnquiry(
  value: unknown,
  actor: Pick<StaffAccess, "staffId" | "roles">,
  query: typeof queryRows = queryRows,
): Promise<ResolutionResult> {
  const input = correctionSchema.parse(value);
  if (!actor.roles.some((role) => role === "admin" || role === "manager"))
    throw new Response("Forbidden", { status: 403 });
  const change = Object.fromEntries(
    (["propertyId", "requestedStaffId", "ownerStaffId"] as const)
      .filter((key) => input[key] !== undefined)
      .map((key) => [key, input[key]]),
  );
  try {
    const [row] = await query<{ result: ResolutionResult }>(
      "SELECT wa_correct_enquiry($1::uuid,$2::uuid,$3::bigint,$4::jsonb,$5) AS result",
      [actor.staffId, input.inquiryId, input.expectedVersion, JSON.stringify(change), input.reason],
    );
    if (!row?.result) throw new Error("WA_ENQUIRY_CORRECTION_NO_READBACK");
    return row.result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("WA_ENQUIRY_FORBIDDEN")
      ? 403
      : message.includes("WA_ENQUIRY_NOT_FOUND")
        ? 404
        : message.includes("WA_ENQUIRY_CORRECTION_INVALID")
          ? 400
          : /WA_ENQUIRY_(VERSION_STALE|OWNER_UNAVAILABLE|PUBLICATION_STALE|REQUESTED_STAFF_UNAVAILABLE|STAFF_MAPPING_STALE)/.test(
                message,
              )
            ? 409
            : null;
    if (status !== null)
      throw new Response(message.match(/WA_ENQUIRY_[A-Z_]+/)?.[0] ?? "WA_ENQUIRY_ERROR", {
        status,
      });
    throw error;
  }
}
