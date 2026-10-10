import type {
  CommandCenterFilterKey,
  CommandCenterKpis,
  CommandCenterRow,
} from "../neon/admin-data.types";

export const COMMAND_CENTER_QUEUES: readonly {
  key: CommandCenterFilterKey;
  label: string;
}[];

export function matchesCommandCenterQueue(
  row: Pick<
    CommandCenterRow,
    | "has_overdue_followup"
    | "priority"
    | "lead_score"
    | "assigned_agent_id"
    | "handoff_status"
    | "whatsapp"
  >,
  key: CommandCenterFilterKey,
): boolean;

export function commandCenterKpis(rows: readonly CommandCenterRow[]): CommandCenterKpis;
