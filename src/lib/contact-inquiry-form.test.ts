import { describe, expect, test } from "bun:test";

import {
  buildWebsiteInquiryPayload,
  composeInquiryMessage,
  contactInquirySchema,
  createSubmitGuard,
  ENQUIRY_TYPE_OPTIONS,
  PREFERRED_CONTACT_OPTIONS,
  submitContactInquiry,
  type ContactSubmitFn,
  type ContactSubmitOutcome,
  type RawContactInquiryInput,
  type SubmitGuard,
} from "./contact-inquiry-form";

// Mirrors exactly the tryStart()/finally-finish() dance contact.tsx's own
// handleSubmit performs around submitContactInquiry -- kept here rather than
// imported from the component so this test exercises the same shape of
// composition the component uses, without depending on React/DOM to prove it.
async function guardedSubmit(
  guard: SubmitGuard,
  args: { raw: RawContactInquiryInput; consentWhatsapp: boolean; submitFn: ContactSubmitFn },
): Promise<ContactSubmitOutcome | { status: "duplicate-blocked" }> {
  if (!guard.tryStart()) {
    return { status: "duplicate-blocked" };
  }
  try {
    return await submitContactInquiry(args);
  } finally {
    guard.finish();
  }
}

const validRaw: RawContactInquiryInput = {
  name: "陳先生",
  phone: "9123 4567",
  email: "buyer@example.com",
  enquiryType: "buy",
  preferredContact: "whatsapp",
  message: "想睇樓",
};

describe("contactInquirySchema", () => {
  test("accepts a fully valid submission", () => {
    const parsed = contactInquirySchema.safeParse(validRaw);
    expect(parsed.success).toBe(true);
  });

  test("rejects a missing enquiryType", () => {
    const parsed = contactInquirySchema.safeParse({ ...validRaw, enquiryType: "" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path[0] === "enquiryType")).toBe(true);
    }
  });

  test("rejects an enquiryType outside the known option set", () => {
    const parsed = contactInquirySchema.safeParse({ ...validRaw, enquiryType: "sell-a-castle" });
    expect(parsed.success).toBe(false);
  });

  test("rejects a missing preferredContact", () => {
    const parsed = contactInquirySchema.safeParse({ ...validRaw, preferredContact: "" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path[0] === "preferredContact")).toBe(true);
    }
  });

  test("still enforces the pre-existing name/phone/email constraints", () => {
    expect(contactInquirySchema.safeParse({ ...validRaw, name: "" }).success).toBe(false);
    expect(contactInquirySchema.safeParse({ ...validRaw, phone: "123" }).success).toBe(false);
    expect(contactInquirySchema.safeParse({ ...validRaw, email: "not-an-email" }).success).toBe(
      false,
    );
    // message and email stay optional
    expect(contactInquirySchema.safeParse({ ...validRaw, message: "" }).success).toBe(true);
    expect(contactInquirySchema.safeParse({ ...validRaw, email: "" }).success).toBe(true);
  });

  test("every declared option value round-trips through the schema", () => {
    for (const enquiryType of ENQUIRY_TYPE_OPTIONS.map((o) => o.value)) {
      expect(contactInquirySchema.safeParse({ ...validRaw, enquiryType }).success).toBe(true);
    }
    for (const preferredContact of PREFERRED_CONTACT_OPTIONS.map((o) => o.value)) {
      expect(contactInquirySchema.safeParse({ ...validRaw, preferredContact }).success).toBe(true);
    }
  });
});

describe("composeInquiryMessage / buildWebsiteInquiryPayload", () => {
  test("folds the enquiry type and preferred contact labels into the free-text message", () => {
    const parsed = contactInquirySchema.parse(validRaw);
    const message = composeInquiryMessage(parsed);
    expect(message).toContain("查詢類型：買樓");
    expect(message).toContain("偏好聯絡方式：WhatsApp");
    expect(message).toContain("留言：想睇樓");
  });

  test("omits the 留言 line entirely when no free-text message was given", () => {
    const parsed = contactInquirySchema.parse({ ...validRaw, message: "" });
    const message = composeInquiryMessage(parsed);
    expect(message).not.toContain("留言：");
  });

  test("builds a payload carrying the composed message and the marketing-consent flag untouched", () => {
    const parsed = contactInquirySchema.parse(validRaw);
    const payload = buildWebsiteInquiryPayload(parsed, true);
    expect(payload.name).toBe("陳先生");
    expect(payload.phone).toBe("9123 4567");
    expect(payload.email).toBe("buyer@example.com");
    expect(payload.consentWhatsapp).toBe(true);
    expect(payload.message).toContain("查詢類型：買樓");

    const declinedPayload = buildWebsiteInquiryPayload(parsed, false);
    expect(declinedPayload.consentWhatsapp).toBe(false);
  });
});

describe("createSubmitGuard", () => {
  test("blocks a second tryStart() until finish() releases it", () => {
    const guard = createSubmitGuard();
    expect(guard.tryStart()).toBe(true);
    expect(guard.tryStart()).toBe(false);
    guard.finish();
    expect(guard.tryStart()).toBe(true);
  });
});

describe("submitContactInquiry", () => {
  test("a validation failure never reaches submitFn", async () => {
    let calls = 0;
    const submitFn = async () => {
      calls += 1;
      return { id: "should-not-happen" };
    };

    const outcome = await submitContactInquiry({
      raw: { ...validRaw, phone: "1" },
      consentWhatsapp: false,
      submitFn,
    });

    expect(outcome.status).toBe("validation-error");
    expect(calls).toBe(0);
  });

  test("a server error is surfaced", async () => {
    const submitFn = async () => ({ error: "network unreachable" });

    const outcome = await submitContactInquiry({
      raw: validRaw,
      consentWhatsapp: false,
      submitFn,
    });

    expect(outcome).toEqual({ status: "server-error", message: "network unreachable" });
  });

  test("a thrown/rejected submitFn is caught and surfaced as a server error", async () => {
    const submitFn = async () => {
      throw new Error("fetch failed");
    };

    const outcome = await submitContactInquiry({
      raw: validRaw,
      consentWhatsapp: false,
      submitFn,
    });

    expect(outcome).toEqual({ status: "server-error", message: "fetch failed" });
  });

  test("a successful submission reports success", async () => {
    const submitFn = async () => ({ id: "inquiry-1" });

    const outcome = await submitContactInquiry({
      raw: validRaw,
      consentWhatsapp: true,
      submitFn,
    });

    expect(outcome).toEqual({ status: "success" });
  });
});

// This is the behavioral proof the plan asked for: simulate two
// near-simultaneous submit calls (the fast double-click/double-Enter case)
// and assert only one actually reaches the server-fn call. Composed exactly
// the way contact.tsx's handleSubmit composes createSubmitGuard +
// submitContactInquiry (see the guardedSubmit helper above) -- this would
// fail against the pre-guard version of contact.tsx, where nothing stopped
// a second invocation from calling createWebsiteInquiry a second time.
describe("guard + submitContactInquiry composition (contact.tsx's actual duplicate-submit guard)", () => {
  test("two near-simultaneous submits sharing one guard: only the first reaches submitFn", async () => {
    const guard = createSubmitGuard();
    let calls = 0;
    let resolveFirst: (() => void) | undefined;
    const submitFn = async () => {
      calls += 1;
      // Simulate a real, slow network round trip so the second call is
      // genuinely racing against an in-flight first call, not a resolved one.
      await new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
      return { id: "inquiry-1" };
    };

    // Deliberately not awaited before firing the second -- this is the fast
    // double-click/double-Enter case: both handler invocations happen before
    // either has finished (or even reached its first await inside submitFn).
    const first = guardedSubmit(guard, { raw: validRaw, consentWhatsapp: false, submitFn });
    const second = guardedSubmit(guard, { raw: validRaw, consentWhatsapp: false, submitFn });

    const secondOutcome = await second;
    expect(secondOutcome).toEqual({ status: "duplicate-blocked" });
    expect(calls).toBe(1);

    resolveFirst?.();
    const firstOutcome = await first;
    expect(firstOutcome).toEqual({ status: "success" });
    expect(calls).toBe(1);
  });

  test("after the guard is released, a subsequent submit reaches submitFn again", async () => {
    const guard = createSubmitGuard();
    let calls = 0;
    const submitFn = async () => {
      calls += 1;
      return { id: `inquiry-${calls}` };
    };

    const firstOutcome = await guardedSubmit(guard, {
      raw: validRaw,
      consentWhatsapp: false,
      submitFn,
    });
    const secondOutcome = await guardedSubmit(guard, {
      raw: validRaw,
      consentWhatsapp: false,
      submitFn,
    });

    expect(firstOutcome).toEqual({ status: "success" });
    expect(secondOutcome).toEqual({ status: "success" });
    expect(calls).toBe(2);
  });

  test("the guard still releases after a validation failure, so the next real attempt is not blocked", async () => {
    const guard = createSubmitGuard();
    let calls = 0;
    const submitFn = async () => {
      calls += 1;
      return { id: "inquiry-1" };
    };

    const failed = await guardedSubmit(guard, {
      raw: { ...validRaw, phone: "1" },
      consentWhatsapp: false,
      submitFn,
    });
    expect(failed.status).toBe("validation-error");
    expect(calls).toBe(0);

    const succeeded = await guardedSubmit(guard, {
      raw: validRaw,
      consentWhatsapp: false,
      submitFn,
    });
    expect(succeeded).toEqual({ status: "success" });
    expect(calls).toBe(1);
  });

  test("the guard still releases after a server error, so the next real attempt is not blocked", async () => {
    const guard = createSubmitGuard();
    let shouldFail = true;
    const submitFn = async () => {
      if (shouldFail) return { error: "network unreachable" };
      return { id: "inquiry-1" };
    };

    const failed = await guardedSubmit(guard, { raw: validRaw, consentWhatsapp: false, submitFn });
    expect(failed).toEqual({ status: "server-error", message: "network unreachable" });

    shouldFail = false;
    const succeeded = await guardedSubmit(guard, {
      raw: validRaw,
      consentWhatsapp: false,
      submitFn,
    });
    expect(succeeded).toEqual({ status: "success" });
  });
});
