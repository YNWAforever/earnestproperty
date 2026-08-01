import { describe, expect, test } from "bun:test";

import { SITE_TEAM } from "@/config/site-team";

import { agentContactNote, resolveAgentContact, resolveDisplayAgents } from "./agent-directory";

function dbProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: "db-1",
    public_slug: "tommy-yiu",
    name_zh: null,
    name_en: "Tommy Yiu",
    job_title: "高級營業經理",
    phone: "26882883",
    whatsapp: "26882883",
    licence_no: "E-123456",
    avatar_url: "/team/tommy-yiu.png",
    branch: "青山公路豪景分行",
    bio: null,
    display_order: 2,
    ...overrides,
  };
}

describe("resolveDisplayAgents", () => {
  test("falls back to the full static roster when the database is empty", () => {
    expect(resolveDisplayAgents([])).toHaveLength(SITE_TEAM.length);
  });

  // The regression that motivated this change: the old implementation used the DB
  // wholesale as soon as one row existed, so publishing a single agent in the
  // admin panel dropped the public team page from 23 people to 1.
  test("one published profile never truncates the roster", () => {
    expect(resolveDisplayAgents([dbProfile()])).toHaveLength(SITE_TEAM.length);
  });

  test("a database value wins over the static entry for the same agent", () => {
    const agents = resolveDisplayAgents([dbProfile({ branch: "海韻分行" })]);
    const tommy = agents.find((agent) => agent.nameEn === "Tommy Yiu");
    expect(tommy?.branch).toBe("海韻分行");
    expect(tommy?.licenceNo).toBe("E-123456");
    expect(tommy?.isPlaceholder).toBe(false);
  });

  test("a null database field falls through to the static entry", () => {
    const staticTommy = SITE_TEAM.find((member) => member.slug === "tommy-yiu");
    const agents = resolveDisplayAgents([dbProfile({ branch: null, job_title: null })]);
    const tommy = agents.find((agent) => agent.nameEn === "Tommy Yiu");
    expect(tommy?.branch).toBe(staticTommy!.branch);
    expect(tommy?.jobTitle).toBe(staticTommy!.jobTitle);
  });

  test("an agent only in the database still renders — new hires need no deploy", () => {
    const agents = resolveDisplayAgents([
      dbProfile({ id: "db-99", public_slug: "new-hire", name_en: "New Hire", display_order: 99 }),
    ]);
    expect(agents).toHaveLength(SITE_TEAM.length + 1);
    expect(agents.some((agent) => agent.nameEn === "New Hire")).toBe(true);
  });

  test("a database row with no public_slug cannot collide with a static entry", () => {
    // Production holds exactly this: an admin account and a leftover "test" row,
    // both with public_slug null. Neither may overwrite a real agent's card.
    const agents = resolveDisplayAgents([
      dbProfile({ id: "db-admin", public_slug: null, name_en: "Earnest Admin" }),
    ]);
    expect(agents).toHaveLength(SITE_TEAM.length);
    expect(agents.some((agent) => agent.nameEn === "Earnest Admin")).toBe(false);
  });

  test("keeps the client's approved order and applies the limit last", () => {
    const agents = resolveDisplayAgents([], 3);
    expect(agents.map((agent) => agent.nameEn)).toEqual(
      SITE_TEAM.slice(0, 3).map((member) => member.nameEn),
    );
  });

  test("a merged agent exposes its slug so the card can link to a real profile", () => {
    // Static-only entries keep slug null on purpose — they have no profile page,
    // and a link to /agents/<slug> would 404.
    const [staticOnly] = resolveDisplayAgents([]);
    expect(staticOnly.slug).toBeNull();

    const merged = resolveDisplayAgents([dbProfile()]).find(
      (agent) => agent.nameEn === "Tommy Yiu",
    );
    expect(merged?.slug).toBe("tommy-yiu");
  });
});

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
