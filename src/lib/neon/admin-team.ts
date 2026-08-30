import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import type { StaffAccess, StaffRole } from "./auth.server.ts";
import { unwrapServerFnResponse } from "./server-fn-response.ts";
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
const staffRoleSchema = z.enum(["admin", "manager", "agent", "viewer"]);
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
    // max(4): one array slot per StaffRole value, now that viewer exists.
    roles: z.array(staffRoleSchema).min(1).max(4),
  })
  .strict() as z.ZodType<InviteStaffMemberInput>;
export const resendStaffInvitationSchema = z
  .object({ staffId: staffIdSchema })
  .strict() as z.ZodType<ResendStaffInvitationInput>;
export const sendStaffPasswordResetSchema = z
  .object({ staffId: staffIdSchema })
  .strict() as z.ZodType<SendStaffPasswordResetInput>;
export const changeStaffRolesSchema = z
  .object({ staffId: staffIdSchema, roles: z.array(staffRoleSchema).min(1).max(4) })
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

type LifecycleService = {
  inviteStaffMember(
    input: InviteStaffMemberInput,
    actor: StaffAccess,
    request: Request,
  ): Promise<{
    memberId: string;
    invitationState: "pending" | "sent" | "expired" | "failed";
    requestId: string;
  }>;
  resendStaffInvitation(
    input: ResendStaffInvitationInput,
    actor: StaffAccess,
    request: Request,
  ): Promise<StaffLifecycleResult>;
  sendStaffPasswordReset(
    input: SendStaffPasswordResetInput,
    actor: StaffAccess,
    request: Request,
  ): Promise<StaffLifecycleResult>;
  changeStaffRoles(
    input: ChangeStaffRolesInput,
    actor: StaffAccess,
    request: Request,
  ): Promise<{ ok: true; roles: StaffRole[]; requestId: string }>;
  changeStaffActive(
    input: ChangeStaffActiveInput,
    actor: StaffAccess,
    request: Request,
  ): Promise<{ ok: true; reassigned: Record<string, number> | null; requestId: string }>;
};

type AdminTeamServerBoundaryDependencies = {
  requireStaffAccess?: (request: Request, roles: StaffRole[]) => Promise<StaffAccess>;
  loadReadModel?: () => Promise<ReadModel>;
  loadLifecycleService?: () => Promise<LifecycleService>;
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
  const loadLifecycleService =
    dependencies.loadLifecycleService ??
    (async () => (await import("./staff-lifecycle.server.ts")).getStaffLifecycleService());

  async function withReadAccess<T>(
    request: Request,
    operation: (model: ReadModel, actor: StaffAccess) => Promise<T>,
  ) {
    // Authentication happens before the data module is imported. This keeps
    // unauthenticated and Agent callers from reaching any Team projection.
    const actor = await requireAccess(request, ["admin", "manager"]);
    return operation(await loadReadModel(), actor);
  }

  async function withRequest<T>(
    request: Request,
    operation: (service: LifecycleService, actor: StaffAccess) => Promise<T>,
  ) {
    // Mutations fail closed before the lifecycle/provider/store modules are
    // loaded. This is deliberately stricter than the read-only Team boundary.
    const actor = await requireAccess(request, ["admin"]);
    return operation(await loadLifecycleService(), actor);
  }

  return {
    listAdminTeam(input: AdminTeamListInput, request: Request) {
      return withReadAccess(request, (model, actor) => model.listAdminTeam(input, actor));
    },
    getAdminTeamMember(input: { staffId: string }, request: Request) {
      return withReadAccess(request, (model, actor) => model.getAdminTeamMember(input, actor));
    },
    inviteStaffMember(input: InviteStaffMemberInput, request: Request) {
      return withRequest(request, (service, actor) =>
        service.inviteStaffMember(input, actor, request),
      );
    },
    resendStaffInvitation(input: ResendStaffInvitationInput, request: Request) {
      return withRequest(request, (service, actor) =>
        service.resendStaffInvitation(input, actor, request),
      );
    },
    sendStaffPasswordReset(input: SendStaffPasswordResetInput, request: Request) {
      return withRequest(request, (service, actor) =>
        service.sendStaffPasswordReset(input, actor, request),
      );
    },
    changeStaffRoles(input: ChangeStaffRolesInput, request: Request) {
      return withRequest(request, (service, actor) =>
        service.changeStaffRoles(input, actor, request),
      );
    },
    changeStaffActive(input: ChangeStaffActiveInput, request: Request) {
      return withRequest(request, (service, actor) =>
        service.changeStaffActive(input, actor, request),
      );
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
const inviteStaffMemberServer = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inviteStaffMemberSchema.parse(data))
  .handler(({ data }) => boundary.inviteStaffMember(data, getRequest()));
const resendStaffInvitationServer = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => resendStaffInvitationSchema.parse(data))
  .handler(({ data }) => boundary.resendStaffInvitation(data, getRequest()));
const sendStaffPasswordResetServer = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => sendStaffPasswordResetSchema.parse(data))
  .handler(({ data }) => boundary.sendStaffPasswordReset(data, getRequest()));
const changeStaffRolesServer = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => changeStaffRolesSchema.parse(data))
  .handler(({ data }) => boundary.changeStaffRoles(data, getRequest()));
const changeStaffActiveServer = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => changeStaffActiveSchema.parse(data))
  .handler(({ data }) => boundary.changeStaffActive(data, getRequest()));

async function withStaffHeaders<T extends { data: unknown }>(options: T) {
  // Keep the browser auth client out of the server boundary module's eager
  // dependency graph; this file contains no provider/store orchestration.
  const { withStaffAuthHeaders } = await import("../../auth.ts");
  return withStaffAuthHeaders(options);
}

// Every call is unwrapped: TanStack Start resolves rather than rejects when a
// handler throws a Response, so without this a 401/403/404/409 would arrive as a
// resolved value -- reported to the admin as a successful mutation. See
// unwrapServerFnResponse.
export const listAdminTeam = async (options: { data: AdminTeamListInput }) =>
  unwrapServerFnResponse(listAdminTeamServer(await withStaffHeaders(options)));
export const getAdminTeamMember = async (options: { data: { staffId: string } }) =>
  unwrapServerFnResponse(getAdminTeamMemberServer(await withStaffHeaders(options)));
export const inviteStaffMember = async (options: { data: InviteStaffMemberInput }) =>
  unwrapServerFnResponse(inviteStaffMemberServer(await withStaffHeaders(options)));
export const resendStaffInvitation = async (options: { data: ResendStaffInvitationInput }) =>
  unwrapServerFnResponse(resendStaffInvitationServer(await withStaffHeaders(options)));
export const sendStaffPasswordReset = async (options: { data: SendStaffPasswordResetInput }) =>
  unwrapServerFnResponse(sendStaffPasswordResetServer(await withStaffHeaders(options)));
export const changeStaffRoles = async (options: { data: ChangeStaffRolesInput }) =>
  unwrapServerFnResponse(changeStaffRolesServer(await withStaffHeaders(options)));
export const changeStaffActive = async (options: { data: ChangeStaffActiveInput }) =>
  unwrapServerFnResponse(changeStaffActiveServer(await withStaffHeaders(options)));

export type { AdminTeamFilterState };
