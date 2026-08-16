import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import type { StaffAccess, StaffRole } from "./auth.server.ts";
import type {
  AdminTeamFilterState,
  AdminTeamList,
  AdminTeamListInput,
  AdminTeamMemberDetail,
  ChangeStaffActiveInput,
  ChangeStaffRolesInput,
  InviteStaffMemberInput,
  ResendStaffInvitationInput,
  SendStaffPasswordResetInput,
  StaffLifecycleResult,
} from "./admin-team.types.ts";

const staffIdSchema = z.string().uuid();
const staffRoleSchema = z.enum(["admin", "manager", "agent"]);
const teamStateSchema = z.enum(["active", "suspended", "invited", "attention"]);

export const listAdminTeamSchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    role: staffRoleSchema.optional(),
    state: teamStateSchema.optional(),
    cursor: z.string().min(1).max(500).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();
export const getAdminTeamMemberSchema = z.object({ staffId: staffIdSchema }).strict();

// Lifecycle schemas are declarative only in Task 3. Task 4 connects them to
// the server-only service after provider and audit orchestration are covered.
export const inviteStaffMemberSchema = z
  .object({
    email: z.string().trim().email().max(320),
    name: z.string().trim().max(200).nullable().optional(),
    roles: z.array(staffRoleSchema).min(1).max(3),
  })
  .strict() as z.ZodType<InviteStaffMemberInput>;
export const resendStaffInvitationSchema = z
  .object({ staffId: staffIdSchema })
  .strict() as z.ZodType<ResendStaffInvitationInput>;
export const sendStaffPasswordResetSchema = z
  .object({ staffId: staffIdSchema })
  .strict() as z.ZodType<SendStaffPasswordResetInput>;
export const changeStaffRolesSchema = z
  .object({ staffId: staffIdSchema, roles: z.array(staffRoleSchema).min(1).max(3) })
  .strict() as z.ZodType<ChangeStaffRolesInput>;
export const changeStaffActiveSchema = z
  .object({
    staffId: staffIdSchema,
    active: z.boolean(),
    reassignToStaffId: staffIdSchema.nullable().optional(),
  })
  .strict() as z.ZodType<ChangeStaffActiveInput>;
export type AdminTeamLifecycleResult = StaffLifecycleResult;

type ReadModel = {
  listAdminTeam(input: AdminTeamListInput, actor: StaffAccess): Promise<AdminTeamList>;
  getAdminTeamMember(
    input: { staffId: string },
    actor: StaffAccess,
  ): Promise<AdminTeamMemberDetail>;
};

type AdminTeamServerBoundaryDependencies = {
  requireStaffAccess?: (request: Request, roles: StaffRole[]) => Promise<StaffAccess>;
  loadReadModel?: () => Promise<ReadModel>;
};

export function createAdminTeamServerBoundary(
  dependencies: AdminTeamServerBoundaryDependencies = {},
) {
  const requireAccess =
    dependencies.requireStaffAccess ??
    (async (request: Request, roles: StaffRole[]) =>
      (await import("./auth.server.ts")).requireStaffAccess(request, roles));
  const loadReadModel =
    dependencies.loadReadModel ??
    (async () => {
      const module = await import("./admin-team.server.ts");
      return { listAdminTeam: module.listAdminTeam, getAdminTeamMember: module.getAdminTeamMember };
    });

  async function withReadAccess<T>(
    request: Request,
    operation: (model: ReadModel, actor: StaffAccess) => Promise<T>,
  ) {
    // Authentication happens before the data module is imported. This keeps
    // unauthenticated and Agent callers from reaching any Team projection.
    const actor = await requireAccess(request, ["admin", "manager"]);
    return operation(await loadReadModel(), actor);
  }

  return {
    listAdminTeam(input: AdminTeamListInput, request: Request) {
      return withReadAccess(request, (model, actor) => model.listAdminTeam(input, actor));
    },
    getAdminTeamMember(input: { staffId: string }, request: Request) {
      return withReadAccess(request, (model, actor) => model.getAdminTeamMember(input, actor));
    },
  };
}

const boundary = createAdminTeamServerBoundary();

const listAdminTeamServer = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => listAdminTeamSchema.parse(data))
  .handler(({ data }) => boundary.listAdminTeam(data, getRequest()));
const getAdminTeamMemberServer = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => getAdminTeamMemberSchema.parse(data))
  .handler(({ data }) => boundary.getAdminTeamMember(data, getRequest()));

async function withStaffHeaders<T extends { data: unknown }>(options: T) {
  // Keep the browser auth client out of the server boundary module's eager
  // dependency graph; this file contains no provider/store orchestration.
  const { withStaffAuthHeaders } = await import("../../auth.ts");
  return withStaffAuthHeaders(options);
}

export const listAdminTeam = async (options: { data: AdminTeamListInput }) =>
  listAdminTeamServer(await withStaffHeaders(options));
export const getAdminTeamMember = async (options: { data: { staffId: string } }) =>
  getAdminTeamMemberServer(await withStaffHeaders(options));

export type { AdminTeamFilterState };
