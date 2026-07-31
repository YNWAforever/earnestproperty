import { describe, expect, test } from "bun:test";

import { SITE_TEAM } from "@/config/site-team";

import { resolveDisplayAgents } from "./agent-directory";

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
