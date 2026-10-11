import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { STAFF_ROLES } from "../control-plane/role-permissions";
import { callStaffServerFn } from "./staff-server-fn";

const ALL_STAFF = STAFF_ROLES;
const noInput = z.object({}).strict();

const readServer = createServerFn({ method: "GET" })
  .inputValidator(noInput)
  .handler(async () => {
    const { requireStaffAccess } = await import("./auth.server");
    const actor = await requireStaffAccess(getRequest(), [...ALL_STAFF]);
    return (await import("./staff-checklist.server")).fetchFirstLoginChecklistDoneForStaff(actor);
  });
const confirmServer = createServerFn({ method: "POST" })
  .inputValidator(noInput)
  .handler(async () => {
    const { requireStaffAccess } = await import("./auth.server");
    const actor = await requireStaffAccess(getRequest(), [...ALL_STAFF]);
    return (await import("./staff-checklist.server")).confirmFirstLoginChecklistForStaff(actor);
  });

export async function fetchFirstLoginChecklistDone(): Promise<boolean> {
  return callStaffServerFn(readServer, { data: {} });
}
export async function confirmFirstLoginChecklist(): Promise<{ ok: true }> {
  return callStaffServerFn(confirmServer, { data: {} });
}
