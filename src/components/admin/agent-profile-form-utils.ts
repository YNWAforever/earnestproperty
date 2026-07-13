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
  show_on_website: boolean;
  display_order: number;
  active: boolean;
};

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
    show_on_website: data.show_on_website,
    display_order: data.display_order,
    ...(canManageIdentity
      ? {
          auth_user_id: data.auth_user_id || null,
          email: data.email || null,
          active: data.active,
        }
      : {}),
  };
}
