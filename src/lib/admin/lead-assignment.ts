import type { AdminAgentRow } from "@/lib/neon/admin-data.types";

/** Active agents, plus the current assignee when inactive (flagged) so the Select still shows the value. Order preserved. */
export function assignableAgents(
  agents: readonly AdminAgentRow[],
  currentAssigneeId: string | null,
): { agent: AdminAgentRow; inactiveCurrent: boolean }[] {
  const out: { agent: AdminAgentRow; inactiveCurrent: boolean }[] = [];
  for (const agent of agents) {
    if (agent.active) out.push({ agent, inactiveCurrent: false });
    else if (currentAssigneeId !== null && agent.id === currentAssigneeId) {
      out.push({ agent, inactiveCurrent: true });
    }
  }
  return out;
}

/** Bulk targets: active agents only. */
export function bulkAssignableAgents(agents: readonly AdminAgentRow[]): AdminAgentRow[] {
  return agents.filter((agent) => agent.active);
}
