import { SITE_BRANCHES, SITE_CONTACT, type SiteBranch } from "@/config/site";
import type { NeonBranchRecord } from "@/lib/neon/public-data.types";
import { normaliseWhatsapp } from "@/lib/staff/licence";

export type AgentContact = {
  /** null when the agent has no branch, or when their branch matches no configured one. */
  homeBranch: SiteBranch | NeonBranchRecord | null;
  phone: string | null;
  whatsapp: string | null;
  /** The rendered phone number is not the agent's own. */
  phoneIsFallback: boolean;
  /** The rendered WhatsApp number is not the agent's own. */
  whatsappIsFallback: boolean;
};

type AgentBranchFields = {
  branch: string | null;
  branch_id?: string | null;
};

/**
 * Resolves the branch an agent belongs to, for CONTACT purposes (a phone
 * number to fall back to, a name for the disclosure note). Prefers a real
 * `branch_id` match against `branches` (the real, admin-editable table --
 * see 20260830160000_branches_entity.sql) over the legacy free-text
 * `branch` string matched against the static SITE_BRANCHES seed config, and
 * returns null when NEITHER resolves -- never a guessed default.
 *
 * This is the single place that preference is coded; resolveAgentContact()
 * and agentBranchName() below both call this rather than each carrying
 * their own copy of the same two-step lookup.
 *
 * `branches.find(...)` returning undefined must become null here, never
 * `branches[0]` or `SITE_BRANCHES[0]` -- see CHANGELOG.md:79-87: a
 * `branch ?? DEFAULT_AGENT_BRANCH.name` fallback silently claimed 15 of 23
 * real agents worked at 麗都分行 when they didn't, simply because a missing
 * branch defaulted to the first configured one.
 */
export function resolveAgentHomeBranch(
  profile: AgentBranchFields,
  branches: readonly NeonBranchRecord[] = [],
): SiteBranch | NeonBranchRecord | null {
  if (profile.branch_id) {
    const linked = branches.find((candidate) => candidate.id === profile.branch_id);
    if (linked) return linked;
  }
  return SITE_BRANCHES.find((entry) => entry.name === profile.branch) ?? null;
}

/**
 * The branch NAME to display/filter/group by -- distinct from
 * resolveAgentHomeBranch() above, which needs a real SITE_BRANCHES/branches
 * match (for its phone number). Here the free-text `branch` fallback is
 * rendered exactly as typed, with no SITE_BRANCHES validation -- matching
 * every display site's pre-existing behaviour of showing `agent.branch`
 * verbatim. Neither existing resolves to null, never a guessed default.
 */
export function agentBranchName(
  profile: AgentBranchFields,
  branches: readonly NeonBranchRecord[] = [],
): string | null {
  if (profile.branch_id) {
    const linked = branches.find((candidate) => candidate.id === profile.branch_id);
    if (linked) return linked.name;
  }
  return profile.branch ?? null;
}

/**
 * Derive the contact details an agent card renders. Shared by /agents and
 * /agents/<slug>, which previously each carried their own copy -- so a fix landed
 * on one and the two pages told a visitor different things about the same person.
 *
 * There is deliberately no fallback to SITE_BRANCHES[0]: defaulting a missing
 * branch printed 麗都分行 on agents based elsewhere, and on 董事, who has none.
 */
export function resolveAgentContact(
  profile: AgentBranchFields & {
    phone: string | null;
    whatsapp: string | null;
  },
  branches: readonly NeonBranchRecord[] = [],
): AgentContact {
  const homeBranch = resolveAgentHomeBranch(profile, branches);
  // Only a mobile number can receive WhatsApp. Both columns are free text in the
  // admin form, and `phone` is promoted to WhatsApp when the agent has no
  // WhatsApp of their own -- so without this check a branch DID typed into 電話
  // renders a wa.me link that answers "not on WhatsApp", presented as the
  // agent's own number with the disclosure suppressed.
  const ownWhatsapp = normaliseWhatsapp(profile.whatsapp) ?? normaliseWhatsapp(profile.phone);
  return {
    homeBranch,
    // `||` not `??`: SITE_CONTACT.phoneTel is `import.meta.env.VITE_CONTACT_PHONE_TEL ?? ""`,
    // so it is an empty string when unset. `??` would pass "" through and produce a
    // `tel:+` href with no number behind it.
    phone: profile.phone || homeBranch?.phone || SITE_CONTACT.phoneTel || null,
    whatsapp: ownWhatsapp || SITE_CONTACT.whatsappPhone || null,
    phoneIsFallback: !profile.phone,
    whatsappIsFallback: !ownWhatsapp,
  };
}

/** The disclosure line, or null when both rendered numbers are the agent's own. */
export function agentContactNote(contact: AgentContact): string | null {
  if (!contact.phoneIsFallback) return null;
  const branch = contact.homeBranch;
  if (contact.whatsappIsFallback) {
    return branch
      ? `代理未有提供直接聯絡方式，電話查詢將由${branch.name}跟進。`
      : "代理未有提供直接聯絡方式，請使用一般查詢。";
  }
  return branch
    ? `WhatsApp 為代理直綫，電話查詢將由${branch.name}跟進。`
    : "WhatsApp 為代理直綫，電話查詢請使用一般查詢。";
}
