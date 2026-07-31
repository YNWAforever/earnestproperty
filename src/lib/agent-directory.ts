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
/** A non-null database value wins; null falls through to the static entry. */
function preferLive(live: DisplayAgent, fallback: DisplayAgent): DisplayAgent {
  const merged = { ...fallback };
  for (const key of Object.keys(live) as (keyof DisplayAgent)[]) {
    const value = live[key];
    if (value !== null && value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

export function resolveDisplayAgents(
  dbProfiles: NeonPublicAgentProfile[],
  limit?: number,
): DisplayAgent[] {
  // This used to pick one source wholesale: any published profile meant the static
  // manifest was ignored entirely. With 23 agents in the manifest and 2 rows in the
  // database, publishing a single agent in the admin panel would have dropped the
  // public team page to one person. Merging per agent and per field means the
  // rendered roster can never be shorter than the static one.
  //
  // Rows without a public_slug — the admin account, and a leftover test row — have
  // no static counterpart to merge onto and are skipped rather than rendered as
  // phantom agents.
  const bySlug = new Map<string, NeonPublicAgentProfile>();
  for (const profile of dbProfiles) {
    if (profile.public_slug) bySlug.set(profile.public_slug, profile);
  }

  const ordered = SITE_TEAM.map((member, index) => {
    const profile = bySlug.get(member.slug);
    if (!profile) return { agent: fromPlaceholder(member), order: index };
    return {
      agent: preferLive(fromDbProfile(profile), fromPlaceholder(member)),
      order: profile.display_order ?? index,
    };
  });

  // An agent present only in the database still renders: a new hire must not need
  // a code change to appear.
  const extras = dbProfiles
    .filter(
      (profile) =>
        profile.public_slug && !SITE_TEAM.some((member) => member.slug === profile.public_slug),
    )
    .map((profile, index) => ({
      agent: fromDbProfile(profile),
      order: profile.display_order ?? SITE_TEAM.length + index,
    }));

  const source = [...ordered, ...extras]
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.agent);

  return typeof limit === "number" ? source.slice(0, limit) : source;
}
