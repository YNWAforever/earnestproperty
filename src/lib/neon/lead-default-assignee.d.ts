export const LEAD_DEFAULT_ASSIGNEE_ENV: string;

export function parseDefaultLeadAssignee(value: unknown): string | null;

export function readDefaultLeadAssignee(env?: Record<string, string | undefined>): string | null;

export function resolveAssignedAgentId(input?: {
  chosenAgentId?: string | null;
  /** The 負責經紀 shown on the listing page, from property_agents. */
  correspondentAgentId?: string | null;
  listingAgentId?: string | null;
  listingAgentActive?: boolean;
  defaultAssigneeId?: string | null;
}): string | null;
