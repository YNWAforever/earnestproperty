import { describe, expect, test } from "bun:test";

import { agentContactNote, resolveAgentContact } from "./agent-directory";

function contactInput(overrides: Partial<Parameters<typeof resolveAgentContact>[0]> = {}) {
  return { branch: "海韻分行", phone: null, whatsapp: null, ...overrides };
}

describe("resolveAgentContact", () => {
  test("routes to the agent's own branch, not SITE_BRANCHES[0]", () => {
    const contact = resolveAgentContact(contactInput({ branch: "海韻分行" }));
    expect(contact.homeBranch?.name).toBe("海韻分行");
    expect(contact.phone).toBe("26886996");
  });

  test("a null branch resolves to no branch, never to a default", () => {
    // 董事 Kenneth Chang has no branch. The card deliberately renders no branch
    // label; naming 麗都分行 in the follow-up note contradicted that blank.
    const contact = resolveAgentContact(contactInput({ branch: null }));
    expect(contact.homeBranch).toBeNull();
  });

  test("a branch string matching no configured branch resolves to null", () => {
    const contact = resolveAgentContact(contactInput({ branch: "海韻分行 " }));
    expect(contact.homeBranch).toBeNull();
  });

  test("the agent's own number wins over the branch line", () => {
    const contact = resolveAgentContact(contactInput({ phone: "91234567" }));
    expect(contact.phone).toBe("91234567");
    expect(contact.phoneIsFallback).toBe(false);
  });

  test("a WhatsApp-only agent is still flagged as dialling a fallback", () => {
    // The 電話聯絡 button dials the branch switchboard here, so the disclosure
    // must render even though the agent supplied a WhatsApp number.
    const contact = resolveAgentContact(contactInput({ whatsapp: "91234567" }));
    expect(contact.phoneIsFallback).toBe(true);
    expect(contact.whatsappIsFallback).toBe(false);
    expect(contact.whatsapp).toBe("91234567");
  });

  test("a landline is never promoted to WhatsApp", () => {
    // 26882883 is the 青山公路豪景分行 switchboard. Promoting it would render a
    // wa.me link that answers "not on WhatsApp", shown as the agent's own number
    // with the disclosure suppressed.
    const contact = resolveAgentContact(contactInput({ phone: "26882883" }));
    expect(contact.phone).toBe("26882883");
    expect(contact.phoneIsFallback).toBe(false);
    expect(contact.whatsappIsFallback).toBe(true);
    expect(contact.whatsapp).not.toBe("26882883");
  });

  test("a landline typed straight into the WhatsApp field is rejected too", () => {
    const contact = resolveAgentContact(contactInput({ whatsapp: "26886996" }));
    expect(contact.whatsappIsFallback).toBe(true);
    expect(contact.whatsapp).not.toBe("26886996");
  });

  test("WhatsApp falls back to the agent's own phone and is not a fallback", () => {
    const contact = resolveAgentContact(contactInput({ phone: "91234567" }));
    expect(contact.whatsapp).toBe("91234567");
    expect(contact.whatsappIsFallback).toBe(false);
  });
});

describe("agentContactNote", () => {
  test("says nothing when both numbers are the agent's own", () => {
    expect(agentContactNote(resolveAgentContact(contactInput({ phone: "91234567" })))).toBeNull();
  });

  test("names the agent's branch when they supplied no contact details", () => {
    expect(agentContactNote(resolveAgentContact(contactInput()))).toBe(
      "代理未有提供直接聯絡方式，電話查詢將由海韻分行跟進。",
    );
  });

  test("names no branch for an agent who has none", () => {
    expect(agentContactNote(resolveAgentContact(contactInput({ branch: null })))).toBe(
      "代理未有提供直接聯絡方式，請使用一般查詢。",
    );
  });

  test("distinguishes a real WhatsApp line from a fallback phone", () => {
    expect(agentContactNote(resolveAgentContact(contactInput({ whatsapp: "91234567" })))).toBe(
      "WhatsApp 為代理直綫，電話查詢將由海韻分行跟進。",
    );
  });

  test("handles a WhatsApp-only agent with no branch", () => {
    expect(
      agentContactNote(resolveAgentContact(contactInput({ branch: null, whatsapp: "91234567" }))),
    ).toBe("WhatsApp 為代理直綫，電話查詢請使用一般查詢。");
  });
});
