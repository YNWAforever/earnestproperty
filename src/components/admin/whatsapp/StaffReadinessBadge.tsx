import type { Capability } from "@/lib/neon/whatsapp-readiness.types";

export function StaffReadinessBadge({
  label,
  capability,
}: {
  label: string;
  capability: Capability;
}) {
  const state =
    capability.state === "ready" ? "可用" : capability.state === "unknown" ? "待核實" : "阻擋";
  return (
    <div className="text-sm">
      <strong>
        {label}：{state}
      </strong>
      {capability.reasons.length ? (
        <p className="text-xs text-muted-foreground">
          {capability.reasons.map((reason) => reason.message).join("、")}
        </p>
      ) : null}
    </div>
  );
}
