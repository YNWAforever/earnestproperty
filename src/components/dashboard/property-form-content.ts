import type { ContentCopilotValue } from "@/lib/ai/content-copilot";
import type { AdminPropertyInput } from "@/lib/neon/admin-data.types";

export type PropertyFormContentState = {
  title_zh: string;
  title_en: string;
  description: string;
  features: string;
  seo_title: string;
  seo_description: string;
};

export type PropertyAuthoritativeSnapshot = Partial<AdminPropertyInput> & {
  id?: string;
  gross_area?: unknown;
  estate_slug?: unknown;
  estate_name_zh?: unknown;
  estate_district_slug?: unknown;
  agent_name_zh?: unknown;
  agent_name_en?: unknown;
  updated_at?: unknown;
};

type PropertyFormContentInput = {
  title_zh?: string | null;
  title_en?: string | null;
  description?: string | null;
  features?: string | readonly string[] | null;
  seo_title?: string | null;
  seo_description?: string | null;
};

export function normalizePropertyFeatures(value: string | readonly string[] | null | undefined) {
  const lines = Array.isArray(value)
    ? value.flatMap((item) => String(item).split(/\r?\n/))
    : String(value ?? "").split(/\r?\n/);
  return lines.map((item) => item.trim()).filter(Boolean);
}

export function buildPropertyContentCopilotFields(
  value: PropertyFormContentInput,
): Record<string, ContentCopilotValue> {
  return {
    title_zh: value.title_zh?.trim() ?? "",
    title_en: nullableText(value.title_en),
    description: nullableText(value.description),
    features: normalizePropertyFeatures(value.features),
    seo_title: nullableText(value.seo_title),
    seo_description: nullableText(value.seo_description),
  };
}

export function applyPropertyContentCopilotPatch<T extends PropertyFormContentState>(
  current: T,
  patch: Record<string, ContentCopilotValue>,
): T {
  const next = { ...current };

  assignTextPatch(next, patch, "title_zh");
  assignTextPatch(next, patch, "title_en");
  assignTextPatch(next, patch, "description");
  assignTextPatch(next, patch, "seo_title");
  assignTextPatch(next, patch, "seo_description");

  const features = patch.features;
  if (features === null || typeof features === "string" || Array.isArray(features)) {
    next.features = normalizePropertyFeatures(features).join("\n");
  }

  return next;
}

export function buildPropertyContentCopilotFingerprintValues(
  snapshot: PropertyAuthoritativeSnapshot,
): Record<string, unknown> {
  const fields = buildPropertyContentCopilotFields({
    title_zh: snapshot.title_zh,
    title_en: snapshot.title_en,
    description: snapshot.description,
    features: snapshot.features,
    seo_title: snapshot.seo_title,
    seo_description: snapshot.seo_description,
  });

  return {
    id: snapshot.id ?? "",
    ...fields,
    listing_no: snapshot.listing_no ?? null,
    deal_type: snapshot.deal_type ?? null,
    price: snapshot.price ?? null,
    rent: snapshot.rent ?? null,
    saleable_area: snapshot.saleable_area ?? null,
    gross_area: snapshot.gross_area ?? null,
    bedrooms: snapshot.bedrooms ?? null,
    bathrooms: snapshot.bathrooms ?? null,
    status: snapshot.status ?? null,
    district_slug: snapshot.district_slug ?? null,
    estate_id: snapshot.estate_id ?? null,
    estate_slug: snapshot.estate_slug ?? null,
    estate_name_zh: snapshot.estate_name_zh ?? null,
    estate_district_slug: snapshot.estate_district_slug ?? null,
    agent_name_zh: snapshot.agent_name_zh ?? null,
    agent_name_en: snapshot.agent_name_en ?? null,
    updated_at: snapshot.updated_at ?? null,
  };
}

function nullableText(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function assignTextPatch(
  next: PropertyFormContentState,
  patch: Record<string, ContentCopilotValue>,
  field: keyof Pick<PropertyFormContentState, "title_zh" | "title_en" | "description" | "seo_title" | "seo_description">,
) {
  const value = patch[field];
  if (typeof value === "string" || value === null) next[field] = value ?? "";
}
