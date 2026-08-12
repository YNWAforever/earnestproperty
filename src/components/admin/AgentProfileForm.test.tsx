import { describe, expect, test } from "bun:test";
import { load } from "cheerio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentProfileForm } from "./AgentProfileForm";
import { agentProfileSchema, buildAgentProfilePayload } from "./agent-profile-form-utils";

// agentProfileSchema is `z.object({...}).superRefine(...)`, which wraps the object in
// ZodEffects -- ZodEffects has no `.shape` of its own, so we unwrap with `.innerType()`
// to reach the underlying ZodObject's field schemas.
const avatarUrlSchema = agentProfileSchema.innerType().shape.avatar_url;

// AdminAgentProfileInput (the `profile` prop AgentProfileForm accepts) stores
// specialties/served_estate_slugs as arrays; AgentProfilePayloadData (what
// buildAgentProfilePayload consumes) stores them as the form's newline-joined
// text, same convention as admin.cms.tsx's estate facilities field. These two
// shapes agreed on every other field until this pair, so both are needed here.
const profileData = {
  auth_user_id: "11111111-1111-4111-8111-111111111111",
  email: "agent@example.com",
  name_zh: "陳大文",
  name_en: "Tai Man Chan",
  job_title: "物業顧問",
  phone: "26882988",
  whatsapp: "91234567",
  licence_no: "E-123456",
  avatar_url: "https://example.com/agent.jpg",
  branch: "麗都分行",
  bio: "專責深井物業。",
  specialties: ["上車盤", "租務"],
  served_estate_slugs: ["bellagio"],
  public_slug: "tai-man-chan",
  show_on_website: true,
  display_order: 2,
  active: false,
};

const formData = {
  ...profileData,
  specialties: profileData.specialties.join("\n"),
  served_estate_slugs: profileData.served_estate_slugs.join("\n"),
};

function renderForm(canManageIdentity: boolean) {
  return load(
    renderToStaticMarkup(
      createElement(AgentProfileForm, {
        profile: { id: "agent-1", ...profileData },
        canManageIdentity,
        onSaved: () => undefined,
      }),
    ),
  );
}

describe("AgentProfileForm identity capability", () => {
  test("manager rendering omits identity and account-active controls", () => {
    const $ = renderForm(false);

    expect($('[name="email"]')).toHaveLength(0);
    expect($('[name="auth_user_id"]')).toHaveLength(0);
    expect($('[name="active"]')).toHaveLength(0);
    expect($('[name="show_on_website"]')).toHaveLength(1);
  });

  test("admin rendering retains identity and account-active controls", () => {
    const $ = renderForm(true);

    expect($('[name="email"]')).toHaveLength(1);
    expect($('[name="auth_user_id"]')).toHaveLength(1);
    expect($('[name="active"]')).toHaveLength(1);
    expect($('[name="show_on_website"]')).toHaveLength(1);
  });

  test("manager payload omits privileged fields while admin payload includes them", () => {
    const managerPayload = buildAgentProfilePayload({
      profileId: "agent-1",
      data: formData,
      canManageIdentity: false,
    });
    const adminPayload = buildAgentProfilePayload({
      profileId: "agent-1",
      data: formData,
      canManageIdentity: true,
    });

    expect(managerPayload).not.toHaveProperty("auth_user_id");
    expect(managerPayload).not.toHaveProperty("email");
    expect(managerPayload).not.toHaveProperty("active");
    expect(managerPayload).toMatchObject({ show_on_website: true, public_slug: "tai-man-chan" });
    // Newline-joined form text is split back into arrays for the mutation payload.
    expect(managerPayload).toMatchObject({
      specialties: ["上車盤", "租務"],
      served_estate_slugs: ["bellagio"],
    });
    expect(adminPayload).toMatchObject({
      auth_user_id: formData.auth_user_id,
      email: formData.email,
      active: false,
    });
  });
});

test("accepts the root-relative photo paths the seed script writes", () => {
  expect(avatarUrlSchema.safeParse("/team/tommy-yiu.jpg").success).toBe(true);
  expect(avatarUrlSchema.safeParse("https://cdn.example.com/a.jpg").success).toBe(true);
  expect(avatarUrlSchema.safeParse("").success).toBe(true);
  // Every other optional field in this schema (see `optionalText`) trims first and treats
  // whitespace-only input as empty, so avatar_url does the same for consistency.
  expect(avatarUrlSchema.safeParse("  ").success).toBe(true);
});

test("rejects a photo value that is neither a path nor an http(s) URL", () => {
  for (const input of [
    "javascript:alert(1)",
    "team/tommy-yiu.jpg",
    "ftp://x/a.jpg",
    "//evil.example/x.jpg",
  ]) {
    expect(avatarUrlSchema.safeParse(input).success).toBe(false);
  }
});

const accessSummary = {
  staffId: "22222222-2222-4222-8222-222222222222",
  roles: ["agent"] as ("admin" | "manager" | "agent")[],
  active: true,
  isSelf: false,
  isLastAdmin: false,
  isProtected: false,
  owned: {
    properties: 4,
    crm_contacts: 2,
    crm_leads: 12,
    inquiries: 1,
    whatsapp_conversations: 3,
    live_agent_sessions: 0,
  },
  ownedTotal: 22,
};

describe("權限 section", () => {
  test("renders role controls when an access summary is supplied", () => {
    const html = renderToStaticMarkup(
      createElement(AgentProfileForm, {
        profile: profileData,
        canManageIdentity: true,
        access: accessSummary,
        activeStaffOptions: [{ id: "33333333-3333-4333-8333-333333333333", label: "李小明" }],
        onSaved: () => {},
      }),
    );
    const $ = load(html);

    expect($("#access-heading").text()).toContain("權限");
    for (const label of ["管理員", "主管", "經紀"]) {
      expect($(`[aria-label="${label}"]`).length).toBe(1);
    }
    expect(html).toContain("停用帳戶");
  });

  test("a protected account explains why it cannot be demoted or deactivated", () => {
    const html = renderToStaticMarkup(
      createElement(AgentProfileForm, {
        profile: profileData,
        canManageIdentity: true,
        access: { ...accessSummary, roles: ["admin"], isProtected: true },
        onSaved: () => {},
      }),
    );

    expect(html).toContain("ADMIN_BOOTSTRAP_EMAILS");
    // The deactivate control is present but disabled rather than hidden, so the
    // reason is visible instead of the button silently vanishing.
    const $ = load(html);
    const deactivate = $("button").filter((_, el) => $(el).text().includes("停用帳戶"));
    expect(deactivate.attr("disabled")).toBeDefined();
  });

  // Managers may edit an agent's public profile but must never see a path to
  // escalate anyone. The route passes access: null for non-admins.
  test("is absent entirely when no access summary is supplied", () => {
    const html = renderToStaticMarkup(
      createElement(AgentProfileForm, {
        profile: profileData,
        canManageIdentity: false,
        access: null,
        onSaved: () => {},
      }),
    );

    expect(html).not.toContain("access-heading");
    expect(html).not.toContain("停用帳戶");
  });
});
