import { allowedOperationTabs, resolveOperationTab } from "./operations-permissions.ts";
import type { HealthData, OperationTab } from "./operations-types.ts";

export type OperationsHealthState = {
  health: HealthData | null;
  error: string | null;
};

type OperationsHealthResult =
  | { type: "success"; health: HealthData }
  | { type: "failure"; error: string };

type HealthFetchResult = { data: HealthData; requestId: string };

export function transitionOperationsHealthState(
  _current: OperationsHealthState,
  result: OperationsHealthResult,
): OperationsHealthState {
  if (result.type === "success") {
    return { health: result.health, error: null };
  }

  return { health: null, error: result.error };
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
