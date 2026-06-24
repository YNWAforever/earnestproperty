export function canUseChunkForPublicAnswer(input: {
  visibility?: string;
  stale?: boolean;
  published?: boolean;
}) {
  return input.visibility === "public" && input.stale !== true && input.published !== false;
}

export function shouldOfferHumanHandoff(input: { confidence: number; userAskedForHuman: boolean }) {
  return input.userAskedForHuman || input.confidence < 0.45;
}

export function buildLiveAgentLeadInput(input: {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  intent?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
  preferred_estates?: string[] | null;
  source_path?: string | null;
  opt_in_whatsapp?: boolean | null;
}) {
  return {
    name: input.name ?? null,
    phone: input.phone ?? null,
    normalized_phone: normalizePhone(input.phone ?? null),
    email: input.email ?? null,
    intent: input.intent ?? "buyer",
    budget_min: input.budget_min ?? null,
    budget_max: input.budget_max ?? null,
    preferred_estates: input.preferred_estates ?? [],
    source: "live_agent",
    source_path: input.source_path ?? null,
    opt_in_whatsapp: input.opt_in_whatsapp === true,
  };
}

function normalizePhone(phone: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D+/g, "");
  return digits || null;
}
