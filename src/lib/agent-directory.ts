import { SITE_BRANCHES, SITE_CONTACT, type SiteBranch } from "@/config/site";
import { normaliseWhatsapp } from "@/lib/staff/licence";

export type AgentContact = {
  /** null when the agent has no branch, or when their branch matches no configured one. */
  homeBranch: SiteBranch | null;
  phone: string | null;
  whatsapp: string | null;
  /** The rendered phone number is not the agent's own. */
  phoneIsFallback: boolean;
  /** The rendered WhatsApp number is not the agent's own. */
  whatsappIsFallback: boolean;
};

/**
 * Derive the contact details an agent card renders. Shared by /agents and
 * /agents/<slug>, which previously each carried their own copy -- so a fix landed
 * on one and the two pages told a visitor different things about the same person.
 *
 * There is deliberately no fallback to SITE_BRANCHES[0]: defaulting a missing
 * branch printed 麗都分行 on agents based elsewhere, and on 董事, who has none.
 */
export function resolveAgentContact(profile: {
  branch: string | null;
  phone: string | null;
  whatsapp: string | null;
}): AgentContact {
  const homeBranch = SITE_BRANCHES.find((entry) => entry.name === profile.branch) ?? null;
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
