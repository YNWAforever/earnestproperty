import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { withStaffAuthHeaders } from "@/auth";
import { contentCopilotRequestSchema, type ContentCopilotRequest } from "./content-copilot.ts";
import { unwrapServerFnResponse } from "../neon/server-fn-response.ts";

const decisionSchema = z.object({
  proposalId: z.string().uuid(),
  decision: z.enum(["apply", "reject"]),
  acceptedFields: z.array(z.string()).max(6),
});

const contentCopilotServer = () => import("./content-copilot.server");

const generateServer = createServerFn({ method: "POST" })
  .inputValidator((data: ContentCopilotRequest) => contentCopilotRequestSchema.parse(data))
  .handler(async ({ data }) => {
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager", "agent"]);
    const service = (await contentCopilotServer()).createContentCopilotService();
    return service.generateContentProposal(data, actor);
  });

const decideServer = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => decisionSchema.parse(data))
  .handler(async ({ data }) => {
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager", "agent"]);
    const service = (await contentCopilotServer()).createContentCopilotService();
    return service.decideContentProposal(data, actor);
  });

export async function generateAdminContentProposal(options: { data: ContentCopilotRequest }) {
  return callStaffServerFn(async () => generateServer(await withStaffAuthHeaders(options)));
}

export async function decideAdminContentProposal(options: {
  data: z.infer<typeof decisionSchema>;
}) {
  return callStaffServerFn(async () => decideServer(await withStaffAuthHeaders(options)));
}

async function requireStaffAccess(request: Request, roles: Array<"admin" | "manager" | "agent">) {
  const auth = await import("../neon/auth.server");
  return auth.requireStaffAccess(request, roles);
}

async function callStaffServerFn<T>(call: () => Promise<T>) {
  try {
    // TanStack Start resolves rather than rejects when a server function
    // handler throws a Response (requireStaffAccess throws Response(401/403)),
    // so unwrap first -- otherwise the `error instanceof Response` branch below
    // is unreachable and a 401/403 is returned to the caller as if it were a
    // real ContentCopilot result.
    return await unwrapServerFnResponse(call());
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error
        ? Number((error as { status?: unknown }).status)
        : 0;
    if (status === 401 || status === 403) {
      return {
        ok: false,
        proposal: null,
        error: status === 401 ? "COPILOT_UNAUTHORIZED" : "COPILOT_FORBIDDEN",
      } as T;
    }
    throw error;
  }
}
