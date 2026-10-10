import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { callStaffServerFn } from "./staff-server-fn";
import type {
  IdentityReviewAction,
  IdentityReviewPage,
  IdentityReviewResolution,
} from "./contact-identity-review.types";

// FX-12 Task 4: the 「可能重複客戶」 list and its resolution. Admin and manager only; the
// server functions check the role and every .server function checks it again.
const listInput = z
  .object({
    status: z.enum(["open", "resolved"]),
    cursor: z.string().max(120).nullable().optional(),
  })
  .strict();
const resolveInput = z
  .object({
    id: z.string().uuid(),
    action: z.enum(["link_a", "link_b", "link_new", "same_person", "different_people", "dismiss"]),
    note: z.string().max(500).nullable().optional(),
  })
  .strict();

const list = createServerFn({ method: "GET" })
  .inputValidator(listInput)
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server.ts");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
    const { listContactIdentityReviews } = await import("./contact-identity-review.server.ts");
    return listContactIdentityReviews(data, actor);
  });
export const fetchContactIdentityReviews = async (
  data: z.infer<typeof listInput>,
): Promise<IdentityReviewPage> => callStaffServerFn(list, { data });

const resolve = createServerFn({ method: "POST" })
  .inputValidator(resolveInput)
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server.ts");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
    const { resolveContactIdentityReview } = await import("./contact-identity-review.server.ts");
    return resolveContactIdentityReview(data, actor);
  });
export const resolveContactIdentityReviewItem = async (data: {
  id: string;
  action: IdentityReviewAction;
  note?: string | null;
}): Promise<IdentityReviewResolution> => callStaffServerFn(resolve, { data });
