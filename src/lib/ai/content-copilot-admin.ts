import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { withStaffAuthHeaders } from "@/auth";
import { contentCopilotRequestSchema, type ContentCopilotRequest } from "./content-copilot.ts";

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
  return callStaffServerFn(() => generateServer(withStaffAuthHeaders(options)));
}

export async function decideAdminContentProposal(options: { data: z.infer<typeof decisionSchema> }) {
  return callStaffServerFn(() => decideServer(withStaffAuthHeaders(options)));
}

async function requireStaffAccess(request: Request, roles: Array<"admin" | "manager" | "agent">) {
  const auth = await import("../neon/auth.server");
  return auth.requireStaffAccess(request, roles);
}

async function callStaffServerFn<T>(call: () => Promise<T>) {
  try {
    return await call();
  } catch (error) {
    if (error instanceof Response && (error.status === 401 || error.status === 403)) {
      return { ok: false, proposal: null, error: error.status === 401 ? "COPILOT_UNAUTHORIZED" : "COPILOT_FORBIDDEN" } as T;
    }
    throw error;
  }
}