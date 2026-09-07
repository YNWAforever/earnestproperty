import type {
  ManagedOffering,
  ManagedPropertySummary,
  PropertyManagementInput,
} from "@/lib/neon/admin-properties.types";
export const propertyStatusLabels: Record<string, string> = {
  active: "公開",
  draft: "草稿",
  offline: "已下架",
  inactive: "來源已下架",
  sold: "已售",
  rented: "已租",
};
export function neutralPropertyTitle(title: string) {
  return title.replace(/\s*[租售]盤\s*#[A-Za-z0-9-]+\s*$/, "").trim();
}
export function changedFields<T extends object>(baseline: T, draft: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(draft).filter(
      ([key, value]) => JSON.stringify(value) !== JSON.stringify(baseline[key as keyof T]),
    ),
  ) as Partial<T>;
}
export type OfferingDraft = {
  amount: string;
  status: string;
  description: string;
  agentId: string;
};
export function offeringDraft(offer: ManagedOffering | null): OfferingDraft {
  return {
    amount: offer ? String((offer.dealType === "sale" ? offer.price : offer.rent) ?? "") : "",
    status: offer?.status ?? "draft",
    description: offer?.description ?? "",
    agentId: offer?.agentId ?? "",
  };
}
export function offeringPatch(
  offer: ManagedOffering | null,
  draft: OfferingDraft,
  deal: "sale" | "rent",
): PropertyManagementInput["payload"] {
  const amount = draft.amount.trim() === "" ? null : Number(draft.amount);
  if (amount !== null && (!Number.isFinite(amount) || amount < 0))
    throw new Error("請輸入有效的非負金額");
  const value = {
    [deal === "sale" ? "price" : "rent"]: amount,
    status: draft.status,
    description: draft.description || null,
    agentId: draft.agentId || null,
  } as PropertyManagementInput["payload"];
  if (!offer) return value;
  const baseline = {
    [deal === "sale" ? "price" : "rent"]: deal === "sale" ? offer.price : offer.rent,
    status: offer.status,
    description: offer.description,
    agentId: offer.agentId,
  };
  return changedFields<Record<string, unknown>>(
    baseline,
    value,
  ) as PropertyManagementInput["payload"];
}
export function offeringPrice(offer: ManagedOffering | null) {
  if (!offer) return "—";
  const amount = offer.dealType === "sale" ? offer.price : offer.rent;
  return amount === null
    ? "未填價格"
    : `$${Number(amount).toLocaleString("en-HK")}${offer.dealType === "rent" ? "／月" : ""}`;
}

export function existingOfferingDeals(offerings: {
  sale: ManagedOffering | null;
  rent: ManagedOffering | null;
}) {
  return (["sale", "rent"] as const).filter((deal) => offerings[deal] != null);
}

export function canSelectProperty(row: ManagedPropertySummary) {
  return (
    !row.unlinked &&
    existingOfferingDeals(row.offerings).some((deal) => row.offerings[deal]?.editable)
  );
}
