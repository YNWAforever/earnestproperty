import { describe, expect, test } from "bun:test";

import {
  agentBranchName,
  agentContactNote,
  resolveAgentContact,
  resolveAgentHomeBranch,
} from "./agent-directory";

const FIXTURE_BRANCHES = [
  {
    id: "branch-uuid-1",
    slug: "rhine",
    name: "海韻分行",
    address: "深井海韻花園地下G3舖",
    phone: "26886996",
    whatsapp: null,
    photo: "/branches/rhine.jpg",
  },
];

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

describe("resolveAgentHomeBranch / agentBranchName -- branch_id preferred over free text", () => {
  test("a resolved branch_id wins over a stale/different free-text branch string", () => {
    const profile = { branch: "麗都分行", branch_id: "branch-uuid-1" };
    expect(resolveAgentHomeBranch(profile, FIXTURE_BRANCHES)?.name).toBe("海韻分行");
    expect(agentBranchName(profile, FIXTURE_BRANCHES)).toBe("海韻分行");
  });

  test("branch_id resolves the real contact phone number too, not just the display name", () => {
    const contact = resolveAgentContact(
      { branch: "麗都分行", branch_id: "branch-uuid-1", phone: null, whatsapp: null },
      FIXTURE_BRANCHES,
    );
    expect(contact.homeBranch?.name).toBe("海韻分行");
    expect(contact.phone).toBe("26886996");
  });

  test("a branch_id that resolves to nothing in the fetched list falls back to the free-text branch, never branches[0]", () => {
    const profile = { branch: "麗都分行", branch_id: "not-in-the-list" };
    expect(resolveAgentHomeBranch(profile, FIXTURE_BRANCHES)?.name).toBe("麗都分行");
    expect(agentBranchName(profile, FIXTURE_BRANCHES)).toBe("麗都分行");
  });

  test("an empty branches list (fetch failed/not yet loaded) falls back to the free-text branch", () => {
    const profile = { branch: "麗都分行", branch_id: "branch-uuid-1" };
    expect(agentBranchName(profile, [])).toBe("麗都分行");
    expect(agentBranchName(profile)).toBe("麗都分行");
  });

  // The regression case that matters most: neither branch_id nor branch set
  // must render/resolve to nothing -- never SITE_BRANCHES[0], never
  // branches[0], never a guessed default. See CHANGELOG.md:79-87.
  test("neither branch_id nor branch set resolves to null everywhere, never a guessed default", () => {
    const profile = { branch: null, branch_id: null };
    expect(resolveAgentHomeBranch(profile, FIXTURE_BRANCHES)).toBeNull();
    expect(agentBranchName(profile, FIXTURE_BRANCHES)).toBeNull();

    const contact = resolveAgentContact(
      { ...profile, phone: null, whatsapp: null },
      FIXTURE_BRANCHES,
    );
    expect(contact.homeBranch).toBeNull();
    expect(agentContactNote(contact)).toBe("代理未有提供直接聯絡方式，請使用一般查詢。");
  });
});
