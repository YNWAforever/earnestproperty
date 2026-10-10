import type { AdminCampaignInput } from "@/lib/neon/admin-data.types";
export function isCampaignDraftDirty(
  current: AdminCampaignInput,
  saved: AdminCampaignInput | null,
) {
  if (!saved) return true;
  const signature = (campaign: AdminCampaignInput) =>
    JSON.stringify({
      id: campaign.id ?? "",
      name: campaign.name.trim(),
      templateId: campaign.template_id ?? "",
      audienceId: campaign.audience_id ?? "",
      status: campaign.status,
      scheduledAt: campaign.scheduled_at ?? "",
    });
  return signature(current) !== signature(saved);
}
/**
 * What the campaign form sends to saveAdminCampaign. FX-17a D-13: there is no
 * schedule field, so scheduled_at is passed back exactly as it was loaded and a
 * stored value (an old 已排期 row's) is never cleared or rewritten.
 */
export function campaignSavePayload(draft: AdminCampaignInput): AdminCampaignInput {
  return { ...draft, name: draft.name.trim() };
}
export function reviewAudienceRows(
  rows: Record<string, unknown>[],
  normalizePhone: (phone: unknown) => string | null,
) {
  const seen = new Set<string>();
  const eligibleIds = new Set<unknown>();
  let missingPhone = 0,
    optedOut = 0,
    notOptedIn = 0,
    identityUnsafe = 0,
    duplicatePhone = 0;
  for (const row of rows) {
    const phone = row.normalized_phone ? normalizePhone(row.normalized_phone) : null;
    if (!phone) missingPhone++;
    if (row.opted_out_whatsapp === true) optedOut++;
    if (row.opt_in_whatsapp !== true) notOptedIn++;
    if (row.identity_safe === false) identityUnsafe++;
    if (
      !phone ||
      row.opt_in_whatsapp !== true ||
      row.opted_out_whatsapp === true ||
      row.identity_safe === false
    )
      continue;
    if (seen.has(phone)) {
      duplicatePhone++;
      continue;
    }
    seen.add(phone);
    eligibleIds.add(row.id);
  }
  return {
    total: rows.length,
    eligible: eligibleIds.size,
    uniqueExcluded: rows.length - eligibleIds.size,
    missingPhone,
    optedOut,
    notOptedIn,
    identityUnsafe,
    duplicatePhone,
  };
}

export async function resolveAudienceSelection<T>(
  input: { audience_id?: string; filters?: T },
  lookup: (id: string) => Promise<unknown | null>,
): Promise<unknown> {
  if (input.filters && !input.audience_id) return input.filters;
  if (!input.audience_id || input.filters) throw new Error("INVALID_AUDIENCE_PREVIEW");
  const saved = await lookup(input.audience_id);
  if (saved === null || saved === undefined) throw new Error("AUDIENCE_NOT_FOUND");
  return saved;
}
