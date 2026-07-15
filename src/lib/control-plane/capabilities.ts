import type { StaffRole } from "../neon/auth.server.ts";
import { hasPermission } from "./permissions.ts";

export type OperationsCapabilities = {
  jobsRead: boolean;
  jobsRetry: boolean;
  jobsCancel: boolean;
  auditRead: boolean;
  migrationsPlan: boolean;
  migrationsApply: boolean;
};

export function operationsCapabilitiesForRoles(
  roles: readonly (StaffRole | string)[],
): OperationsCapabilities {
  return {
    jobsRead: hasPermission(roles, "system.jobs.read"),
    jobsRetry: hasPermission(roles, "system.jobs.retry"),
    jobsCancel: hasPermission(roles, "system.jobs.cancel"),
    auditRead: hasPermission(roles, "audit.read"),
    migrationsPlan: hasPermission(roles, "system.migrations.plan"),
    migrationsApply: hasPermission(roles, "system.migrations.apply"),
  };
}
