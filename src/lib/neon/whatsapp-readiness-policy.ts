import type {
  Capability,
  ReadinessReason,
  StaffEndpointEvidence,
  StaffReadinessInput,
  StaffWhatsappReadiness,
  WhatsappRuntimeStatus,
} from "./whatsapp-readiness.types.ts";

const messages: Record<string, string> = {
  staff_inactive: "同事帳戶未啟用",
  role_ineligible: "同事沒有可接單角色",
  mapping_missing: "尚未連接 Inbox 映射",
  mapping_unverified: "Inbox 映射未核實",
  mapping_retired: "Inbox 映射已停用",
  mapping_changed: "Inbox 映射版本已更新，通知目的地需要重新核實",
  channel_mismatch: "公司頻道不符",
  endpoint_missing: "尚未設定通知目的地",
  endpoint_unverified: "通知目的地未核實",
  endpoint_disabled: "通知目的地已停用",
  permission_missing: "通知權限未核實",
  outside_message_window: "已超出 24 小時訊息窗口",
  template_unverified: "訊息模板合約未核實",
  runtime_disabled: "通知運作模式未啟用",
  schema_unavailable: "資料表尚未就緒",
  provider_unverified: "供應商能力未核實",
};
const issue = (code: string): ReadinessReason => ({ code, message: messages[code] ?? code });
const blocked = (...codes: string[]): Capability => ({
  state: codes.length ? "blocked" : "ready",
  reasons: codes.map(issue),
});
export const unknownCapability = (code = "schema_unavailable"): Capability => ({
  state: "unknown",
  reasons: [issue(code)],
});

function endpointReasons(
  endpoint: StaffEndpointEvidence | null,
  transport: "inbox_private_note" | "staff_whatsapp",
  channelId: string | null,
): string[] {
  if (!endpoint) return ["endpoint_missing"];
  const reasons: string[] = [];
  if (endpoint.transport !== transport || endpoint.channelId !== channelId)
    reasons.push("channel_mismatch");
  if (endpoint.retiredAt || !endpoint.enabled) reasons.push("endpoint_disabled");
  if (!endpoint.verifiedAt || !endpoint.destinationReference.trim())
    reasons.push("endpoint_unverified");
  if (!endpoint.permissionGranted || !endpoint.permissionRef) reasons.push("permission_missing");
  if (!endpoint.quietHoursApproved) reasons.push("permission_missing");
  return [...new Set(reasons)];
}

export function maskStaffDestination(value: string | null | undefined): string | null {
  if (!value) return null;
  const tail = value.replace(/\s/g, "").slice(-4);
  return tail ? `••••${tail}` : null;
}

function withRepairActions(capability: Capability, staffId: string): Capability {
  const target = (code: string) => {
    const step =
      code === "mapping_missing" || code === "mapping_retired" || code === "channel_mismatch"
        ? 1
        : code === "mapping_unverified"
          ? 3
          : null;
    if (step !== null)
      return `/admin/whatsapp-settings?staffId=${encodeURIComponent(staffId)}&step=${step}`;
    if (
      code.startsWith("endpoint_") ||
      code === "mapping_changed" ||
      code === "permission_missing" ||
      code === "outside_message_window" ||
      code === "template_unverified"
    )
      return `/admin/whatsapp-settings?staffId=${encodeURIComponent(staffId)}&step=3#staff-notifications`;
    return "/admin/operations";
  };
  return {
    ...capability,
    reasons: capability.reasons.map((reason) => ({ ...reason, actionHref: target(reason.code) })),
  };
}

export function assessStaffReadiness(input: StaffReadinessInput): StaffWhatsappReadiness {
  const { mapping, runtime, inboxEndpoint, staffEndpoint } = input;
  const base: string[] = [];
  if (!input.active) base.push("staff_inactive");
  if (!input.roles.some((role) => role === "admin" || role === "manager" || role === "agent"))
    base.push("role_ineligible");
  if (!runtime.assignmentEnabled || !runtime.channelId) base.push("runtime_disabled");
  if (!runtime.inboxProviderVerified) base.push("provider_unverified");
  if (!mapping) base.push("mapping_missing");
  else {
    if (mapping.channelId !== runtime.channelId) base.push("channel_mismatch");
    if (mapping.retiredAt) base.push("mapping_retired");
    if (
      mapping.reviewEnforced &&
      (mapping.reviewBasis !== "provider_verified" || !mapping.reviewEvidenceId)
    )
      base.push("mapping_unverified");
    if (
      !mapping.eligible ||
      !mapping.verifiedAt ||
      !mapping.verificationRef ||
      !mapping.inboxUserId ||
      !mapping.folderId
    )
      base.push("mapping_unverified");
  }
  const assignment = blocked(...base);
  const inboxReasons = [
    ...base,
    ...endpointReasons(inboxEndpoint, "inbox_private_note", runtime.channelId),
  ];
  if (!runtime.notificationsEnabled) inboxReasons.push("runtime_disabled");
  if (!runtime.inboxProviderVerified) inboxReasons.push("provider_unverified");
  if (mapping && inboxEndpoint && mapping.inboxUserId !== inboxEndpoint.destinationReference)
    inboxReasons.push("endpoint_unverified");
  if (mapping?.reviewEnforced && inboxEndpoint?.mappingVersion !== mapping.version)
    inboxReasons.push("mapping_changed");
  const staffReasons = [
    ...base,
    ...endpointReasons(staffEndpoint, "staff_whatsapp", runtime.channelId),
  ];
  if (!runtime.notificationsEnabled || !runtime.staffWhatsAppEnabled)
    staffReasons.push("runtime_disabled");
  if (!runtime.staffTransportVerified) staffReasons.push("provider_unverified");
  if (mapping?.reviewEnforced && staffEndpoint?.mappingVersion !== mapping.version)
    staffReasons.push("mapping_changed");
  if (staffEndpoint) {
    const lastInbound = staffEndpoint.lastInboundAt
      ? new Date(staffEndpoint.lastInboundAt).getTime()
      : Number.NaN;
    const now = new Date(input.checkedAt).getTime();
    if (
      !Number.isFinite(lastInbound) ||
      lastInbound > now ||
      now - lastInbound >= 24 * 60 * 60 * 1000
    ) {
      staffReasons.push("outside_message_window");
      // The approved template name alone cannot establish the payload contract.
      if (
        !runtime.templateContractVerified ||
        !staffEndpoint.templateName ||
        !staffEndpoint.templateLanguage ||
        !staffEndpoint.templateVerifiedAt
      )
        staffReasons.push("template_unverified");
    }
  }
  return {
    staffId: input.staffId,
    displayName: input.displayName,
    active: input.active,
    assignment: withRepairActions(assignment, input.staffId),
    inboxPrivateNote: withRepairActions(blocked(...new Set(inboxReasons)), input.staffId),
    staffWhatsapp: withRepairActions(blocked(...new Set(staffReasons)), input.staffId),
    maskedDestination: maskStaffDestination(staffEndpoint?.destinationReference),
    mappingVersion: mapping?.version ?? null,
    endpointVersion: staffEndpoint?.version ?? null,
    checkedAt: input.checkedAt,
  };
}

export function assessWhatsappRuntime(input: {
  mode: string;
  serviceEnabled: boolean;
  channelId: string | null;
  inboxProviderVerified: boolean;
  staffTransportVerified: boolean;
  staffWhatsappEnabled: boolean;
  checkedAt: string;
}): WhatsappRuntimeStatus {
  const active = input.mode === "active" && input.serviceEnabled;
  const assignment = blocked(
    ...(!active || !input.channelId ? ["runtime_disabled"] : []),
    ...(!input.inboxProviderVerified ? ["provider_unverified"] : []),
  );
  const customerReply =
    active && input.channelId
      ? unknownCapability("provider_unverified")
      : blocked("runtime_disabled");
  const staffWhatsappText = blocked(
    ...(!active || !input.staffWhatsappEnabled ? ["runtime_disabled"] : []),
    ...(!input.staffTransportVerified ? ["provider_unverified"] : []),
  );
  return {
    mode: input.mode,
    serviceEnabled: input.serviceEnabled,
    assignment,
    customerReply,
    staffWhatsappText,
    staffWhatsappTemplate: blocked("template_unverified"),
    approvedPolicyVersion: null,
    checkedAt: input.checkedAt,
  };
}
