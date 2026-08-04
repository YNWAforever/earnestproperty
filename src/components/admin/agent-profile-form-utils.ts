import type { AdminAgentProfileMutationInput } from "@/lib/neon/admin-data.types";

export type AgentProfilePayloadData = {
  auth_user_id: string;
  email: string;
  name_zh: string;
  name_en: string;
  job_title: string;
  phone: string;
  whatsapp: string;
  licence_no: string;
  avatar_url: string;
  branch: string;
  bio: string;
  public_slug: string;
  // Newline/comma-separated free text in form state, same convention as
  // admin.cms.tsx's estate facilities field -- split into an array below.
  specialties: string;
  served_estate_slugs: string;
  show_on_website: boolean;
  // Matches agentProfileSchema's post-parse output (z.union([z.literal(""), z.coerce.number()...])):
  // "" means the field was left blank, a number means the user set an explicit value. This is
  // neither the raw form state (strings) nor the mutation payload (number | null) -- it's what
  // zod produces from the form state, which buildAgentProfilePayload below then maps to the
  // mutation payload's number | null.
  display_order: number | "";
  active: boolean;
};

function splitList(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildAgentProfilePayload({
  profileId,
  data,
  canManageIdentity,
}: {
  profileId?: string;
  data: AgentProfilePayloadData;
  canManageIdentity: boolean;
}): AdminAgentProfileMutationInput {
  return {
    id: profileId,
    name_zh: data.name_zh || null,
    name_en: data.name_en || null,
    job_title: data.job_title || null,
    phone: data.phone || null,
    whatsapp: data.whatsapp || null,
    licence_no: data.licence_no || null,
    avatar_url: data.avatar_url || null,
    branch: data.branch || null,
    bio: data.bio || null,
    public_slug: data.public_slug || null,
    specialties: splitList(data.specialties),
    served_estate_slugs: splitList(data.served_estate_slugs),
    show_on_website: data.show_on_website,
    display_order: data.display_order === "" ? null : Number(data.display_order),
    ...(canManageIdentity
      ? {
          auth_user_id: data.auth_user_id || null,
          email: data.email || null,
          active: data.active,
        }
      : {}),
  };
}
