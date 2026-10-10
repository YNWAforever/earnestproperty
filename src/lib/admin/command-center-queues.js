// Pure and dependency-free: imported by the 跟進工作台 page, by the server that
// computes its KPI tiles, and by `node --test`. A KPI tile and the queue it opens
// share one predicate, so the number on the tile is the number of rows shown.

export const COMMAND_CENTER_QUEUES = [
  { key: "today", label: "今日要跟" },
  { key: "high_score", label: "AI 高分查詢" },
  { key: "overdue", label: "逾期跟進" },
  { key: "unassigned", label: "未指派" },
  { key: "live_agent", label: "問樓助手" },
  { key: "whatsapp_blocked", label: "WhatsApp 受阻" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "all", label: "全部" },
];

export function matchesCommandCenterQueue(row, key) {
  switch (key) {
    case "today":
      return row.has_overdue_followup || row.priority.bucket <= 2;
    case "high_score":
      return (row.lead_score ?? 0) >= 60;
    case "overdue":
      return row.has_overdue_followup === true;
    case "unassigned":
      return row.assigned_agent_id == null;
    case "live_agent":
      return row.handoff_status != null;
    case "whatsapp_blocked":
      return row.whatsapp.linked === false || row.whatsapp.canReply === false;
    case "whatsapp":
      return row.whatsapp.linked === true;
    case "all":
    default:
      return true;
  }
}

export function commandCenterKpis(rows) {
  const count = (key) => rows.filter((row) => matchesCommandCenterQueue(row, key)).length;
  return {
    hot: count("high_score"),
    overdue: count("overdue"),
    unassigned: count("unassigned"),
    handoffs: count("live_agent"),
    whatsapp_blocked: count("whatsapp_blocked"),
  };
}
