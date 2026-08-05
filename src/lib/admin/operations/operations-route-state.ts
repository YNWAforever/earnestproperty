import { allowedOperationTabs, resolveOperationTab } from "./operations-permissions.ts";
import type { HealthData, OperationTab } from "./operations-types.ts";

export type OperationsHealthState = {
  health: HealthData | null;
  error: string | null;
  /** True when `health` is a preserved snapshot from before `error` -- the
   * panels are still rendered but the figures in them may be out of date. */
  stale: boolean;
};

type OperationsHealthResult =
  | { type: "success"; health: HealthData }
  | { type: "failure"; error: string };

type HealthFetchResult = { data: HealthData; requestId: string };

export function transitionOperationsHealthState(
  current: OperationsHealthState,
  result: OperationsHealthResult,
): OperationsHealthState {
  if (result.type === "success") {
    return { health: result.health, error: null, stale: false };
  }

  // The last good health is preserved rather than dropped to null. Dropping it
  // unmounted every panel on a single transient poll failure -- 30s ticks meant
  // one network blip destroyed the operator's job filters, every extra page
  // they had loaded, expanded audit metadata and any open dialog, replacing the
  // page with a bare error line.
  //
  // This is safe because the client capability flags are an affordance, not the
  // security boundary: every /api/admin/control-plane/* handler calls
  // requireStaffPermission on each request, so a capability revoked between
  // polls yields a 403 on the next call rather than being silently granted here.
  return { health: current.health, error: result.error, stale: current.health !== null };
}

export function getOperationsSearchCorrection(searchTab: unknown, activeTab: OperationTab) {
  if (typeof searchTab !== "string" || searchTab === activeTab) return null;
  return { tab: activeTab === "overview" ? undefined : activeTab };
}

export function resolveOperationsRouteState(searchTab: unknown, health: HealthData | null) {
  const allowedTabs: OperationTab[] = health
    ? allowedOperationTabs(health.capabilities)
    : ["overview"];
  const activeTab = health ? resolveOperationTab(searchTab, health.capabilities) : "overview";

  return {
    allowedTabs,
    activeTab,
    correction: getOperationsSearchCorrection(searchTab, activeTab),
  };
}

export function createOperationsHealthLoader({
  fetchHealth,
  setState,
}: {
  fetchHealth: () => Promise<HealthFetchResult>;
  setState: (updater: (current: OperationsHealthState) => OperationsHealthState) => void;
}) {
  return {
    async load() {
      try {
        const result = await fetchHealth();
        setState((current) =>
          transitionOperationsHealthState(current, { type: "success", health: result.data }),
        );
      } catch (error) {
        setState((current) =>
          transitionOperationsHealthState(current, { type: "failure", error: errorText(error) }),
        );
      }
    },
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load operations health.";
}
