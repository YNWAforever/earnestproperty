/**
 * Outcome classifier for public enquiry forms (contact, property enquiry, valuation,
 * listing alert). No React, no DOM, no network; its only side effect is a console.error with the
 * failure cause (see `failureWithLog`).
 *
 * Why it exists: a rate-limited public server function throws `new Response(..., { status:
 * 429 })`, and TanStack Start RESOLVES the client call with that `Response` instead of
 * rejecting (see `neon/server-fn-response.ts`). A caller that only checks `"error" in result`
 * or `try/catch` therefore reports a lead that was never saved as a success. Success here
 * means exactly one thing: the call resolved to an object carrying a non-empty string `id`.
 *
 * The visitor-facing `message` is always fixed copy keyed by error code. Raw thrown or
 * returned text (SQL errors, stack fragments, upstream prose) is never passed through.
 */

export type PublicFormErrorCode = "RATE_LIMITED" | "VALIDATION" | "NETWORK" | "SERVER";

export type PublicSubmitOutcome =
  | { status: "success"; id: string }
  | { status: "error"; code: PublicFormErrorCode; message: string };

const PUBLIC_FORM_ERROR_MESSAGES: Record<PublicFormErrorCode, string> = {
  RATE_LIMITED: "提交次數太多，請一分鐘後再試，或直接 WhatsApp 我們。",
  VALIDATION: "資料格式有誤，請檢查你填寫的資料後再試。",
  NETWORK: "網絡連線出現問題，請檢查網絡後再試，或直接 WhatsApp 我們。",
  SERVER: "未能提交，請再試一次，或直接 WhatsApp 我們。",
};

export function publicFormErrorMessage(code: PublicFormErrorCode): string {
  return PUBLIC_FORM_ERROR_MESSAGES[code];
}

function codeForStatus(status: number): PublicFormErrorCode {
  if (status === 429) return "RATE_LIMITED";
  if (status === 400 || status === 422) return "VALIDATION";
  return "SERVER";
}

function looksLikeSerializedZodIssues(message: string): boolean {
  try {
    const parsed: unknown = JSON.parse(message);
    const first: unknown = Array.isArray(parsed) ? parsed[0] : undefined;
    return typeof first === "object" && first !== null && "code" in first && "path" in first;
  } catch {
    return false;
  }
}

function codeForThrown(error: unknown): PublicFormErrorCode {
  if (typeof error === "object" && error !== null) {
    const { status, name, message } = error as {
      status?: unknown;
      name?: unknown;
      message?: unknown;
    };
    if (typeof status === "number") return codeForStatus(status);
    if (error instanceof TypeError) return "NETWORK";
    if (name === "ZodError") return "VALIDATION";
    if (typeof message === "string" && looksLikeSerializedZodIssues(message)) return "VALIDATION";
  }
  return "SERVER";
}

function failure(code: PublicFormErrorCode): PublicSubmitOutcome {
  return { status: "error", code, message: publicFormErrorMessage(code) };
}

/**
 * The visitor only ever sees fixed copy, so the real cause must go to the console or it is lost
 * (a swallowed 429 and a swallowed TypeError look identical to support). `cause` is the thrown
 * value, or a short description of a resolved value -- never the resolved value itself and
 * never the form payload (this module cannot see the payload; the caller owns it).
 */
function failureWithLog(
  code: PublicFormErrorCode,
  detail: { status?: number; name?: string; cause: unknown },
): PublicSubmitOutcome {
  console.error("PUBLIC_FORM_SUBMIT_FAILED", {
    code,
    status: detail.status,
    name: detail.name,
    cause: detail.cause,
  });
  return failure(code);
}

function describeResolved(result: unknown): string {
  if (result === null) return "null";
  if (typeof result === "object") return "object without a string id";
  return typeof result;
}

export async function submitPublicForm(call: () => Promise<unknown>): Promise<PublicSubmitOutcome> {
  let result: unknown;
  try {
    result = await call();
  } catch (error) {
    const { status, name } =
      typeof error === "object" && error !== null
        ? (error as { status?: unknown; name?: unknown })
        : { status: undefined, name: undefined };
    return failureWithLog(codeForThrown(error), {
      status: typeof status === "number" ? status : undefined,
      name: typeof name === "string" ? name : undefined,
      cause: error,
    });
  }

  if (result instanceof Response) {
    return failureWithLog(codeForStatus(result.status), {
      status: result.status,
      cause: "Response",
    });
  }

  if (typeof result === "object" && result !== null) {
    const { id } = result as { id?: unknown };
    if (typeof id === "string" && id.length > 0) return { status: "success", id };
  }
  return failureWithLog("SERVER", { cause: describeResolved(result) });
}
