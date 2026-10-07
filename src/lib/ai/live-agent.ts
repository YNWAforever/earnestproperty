import { normalizeAdminPhone } from "../neon/admin-workflow.ts";

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

// Deliberately small and local to the live agent: HK 8-digit mobiles (4-9 lead digit) with an
// optional +852 / 00852 / 852 prefix, or a +country-code number of 8-15 digits. The normalised
// value is digits only.
export function validateHandoffPhone(raw: string | null | undefined): HandoffPhoneCheck {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, code: "LIVE_AGENT_PHONE_REQUIRED" };

  const compact = text.replace(/[\s-]/g, "");
  if (/^[4-9]\d{7}$/.test(compact)) return { ok: true, normalized: `852${compact}` };

  const hongKong = /^(?:\+852|00852|852)([4-9]\d{7})$/.exec(compact);
  if (hongKong) return { ok: true, normalized: `852${hongKong[1]}` };
  // Landlines and wrong-length Hong Kong numbers must not fall through to the generic
  // international rule below.
  if (compact.startsWith("+852") || compact.startsWith("00852")) {
    return { ok: false, code: "LIVE_AGENT_PHONE_INVALID" };
  }

  const international = /^\+([1-9]\d{7,14})$/.exec(compact);
  if (international) return { ok: true, normalized: international[1] };

  return { ok: false, code: "LIVE_AGENT_PHONE_INVALID" };
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
