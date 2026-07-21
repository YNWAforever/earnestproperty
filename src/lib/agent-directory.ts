import { SITE_TEAM, type TeamMemberPlaceholder } from "@/config/site-team";
import type { NeonPublicAgentProfile } from "@/lib/neon/public-data.types";

/**
 * Normalized shape both real Neon `staff_users` profiles and the placeholder
 * team manifest can be rendered as, so agent cards don't need to know which
 * source a record came from.
 */
export type DisplayAgent = {
  id: string;
  slug: string | null;
  nameZh: string | null;
  nameEn: string | null;
  jobTitle: string | null;
  branch: string | null;
  phone: string | null;
  whatsapp: string | null;
  licenceNo: string | null;
  photo: string | null;
  isPlaceholder: boolean;
};

function fromDbProfile(profile: NeonPublicAgentProfile): DisplayAgent {
  return {
    id: profile.id,
    slug: profile.public_slug,
    nameZh: profile.name_zh,
    nameEn: profile.name_en,
    jobTitle: profile.job_title,
    branch: profile.branch,
    phone: profile.phone,
    whatsapp: profile.whatsapp,
    licenceNo: profile.licence_no,
    photo: profile.avatar_url,
    isPlaceholder: false,
  };
}

function fromPlaceholder(member: TeamMemberPlaceholder): DisplayAgent {
  return {
    id: member.slug,
    // Placeholders have no verified individual profile page yet.
    slug: null,
    nameZh: member.nameZh,
    nameEn: member.nameEn,
    jobTitle: member.jobTitle,
    branch: member.branch,
    phone: member.phone,
    whatsapp: member.whatsapp,
    licenceNo: member.licenceNo,
    photo: member.photo,
    isPlaceholder: true,
  };
}

/**
 * Resolve which agents to display: real Neon profiles when any are published
 * (`show_on_website = true`), otherwise the placeholder studio-headshot
 * manifest — so the directory and homepage preview never render empty while
 * real profiles are still being entered in the admin panel.
 */
export function resolveDisplayAgents(
  dbProfiles: NeonPublicAgentProfile[],
  limit?: number,
): DisplayAgent[] {
  const source =
    dbProfiles.length > 0 ? dbProfiles.map(fromDbProfile) : SITE_TEAM.map(fromPlaceholder);
  return typeof limit === "number" ? source.slice(0, limit) : source;
}
