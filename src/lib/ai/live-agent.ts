import { normalizeAdminPhone } from "../neon/admin-workflow.ts";
import { hkLocalNumber, normalizePhone } from "../phone.js";

export function canUseChunkForPublicAnswer(input: {
  visibility?: string;
  stale?: boolean;
  published?: boolean;
}) {
  return input.visibility === "public" && input.stale !== true && input.published !== false;
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
    normalized_phone: normalizeAdminPhone(input.phone ?? null),
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

export type LiveAgentPhoneErrorCode = "LIVE_AGENT_PHONE_REQUIRED" | "LIVE_AGENT_PHONE_INVALID";

export type HandoffPhoneCheck =
  | { ok: true; normalized: string }
  | { ok: false; code: LiveAgentPhoneErrorCode };

const LIVE_AGENT_PHONE_ERROR_MESSAGES: Record<LiveAgentPhoneErrorCode, string> = {
  LIVE_AGENT_PHONE_REQUIRED: "請輸入電話號碼，方便代理聯絡你。",
  LIVE_AGENT_PHONE_INVALID: "電話號碼格式不正確，請輸入 8 位香港手機號碼，或連國家碼的號碼。",
};

function isLiveAgentPhoneErrorCode(value: unknown): value is LiveAgentPhoneErrorCode {
  return value === "LIVE_AGENT_PHONE_REQUIRED" || value === "LIVE_AGENT_PHONE_INVALID";
}

// The shared normaliser (src/lib/phone.js) decides what number was typed, so the handoff and
// every other customer path agree. On top of it the live agent is stricter: only digits,
// spaces, hyphens and one leading "+" may be typed; a Hong Kong number must be a mobile (4-9
// lead digit), including "+" before 8 digits (FX-12 owner decision); and any other country
// needs a leading "+". The normalised value is digits only.
export function validateHandoffPhone(raw: string | null | undefined): HandoffPhoneCheck {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, code: "LIVE_AGENT_PHONE_REQUIRED" };

  const compact = text.replace(/[\s-]/g, "");
  const canonical = /^\+?\d+$/.test(compact) ? normalizePhone(text) : null;
  if (!canonical) return { ok: false, code: "LIVE_AGENT_PHONE_INVALID" };
  const local = hkLocalNumber(canonical);
  if (local) {
    return /^[4-9]/.test(local)
      ? { ok: true, normalized: canonical }
      : { ok: false, code: "LIVE_AGENT_PHONE_INVALID" };
  }
  return compact.startsWith("+")
    ? { ok: true, normalized: canonical }
    : { ok: false, code: "LIVE_AGENT_PHONE_INVALID" };
}

export function liveAgentPhoneErrorMessage(code: LiveAgentPhoneErrorCode): string {
  return LIVE_AGENT_PHONE_ERROR_MESSAGES[code];
}

export function formatHandoffPhoneForDisplay(normalized: string): string {
  const digits = normalized.replace(/\D/g, "");
  if (/^852\d{8}$/.test(digits)) return `+852 ${digits.slice(3, 7)} ${digits.slice(7)}`;
  return `+${digits}`;
}

// Maps only the two known phone codes to client-side copy. Server text in `error` is never
// returned, so raw server or exception text cannot reach the visitor.
export function liveAgentPhoneErrorFromBody(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const code = (body as { code?: unknown }).code;
  return isLiveAgentPhoneErrorCode(code) ? liveAgentPhoneErrorMessage(code) : null;
}
