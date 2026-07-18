import type { OperationsCapabilities } from "../../control-plane/capabilities.ts";
import type { OperationTab } from "./operations-types.ts";

export function allowedOperationTabs(capabilities: OperationsCapabilities): OperationTab[] {
  const tabs: OperationTab[] = ["overview"];
  if (capabilities.jobsRead) tabs.push("jobs");
  if (capabilities.auditRead) tabs.push("audit");
  if (capabilities.migrationsPlan) tabs.push("migrations");
  return tabs;
}

export function resolveOperationTab(
  value: unknown,
  capabilities: OperationsCapabilities,
): OperationTab {
  const allowed = allowedOperationTabs(capabilities);
  return typeof value === "string" && allowed.includes(value as OperationTab)
    ? (value as OperationTab)
    : allowed[0];
}
