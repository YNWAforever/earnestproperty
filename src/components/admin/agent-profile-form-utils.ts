import { z } from "zod";

import type { AdminAgentProfileMutationInput } from "@/lib/neon/admin-data.types";

/** Validation for the agent profile form. Lives here rather than in
 * AgentProfileForm.tsx so that file exports only components
 * (react-refresh/only-export-components); buildAgentProfilePayload below
 * consumes this schema's post-parse output, so the two belong together.
 */
const optionalText = (max: number) => z.string().trim().max(max).or(z.literal(""));

export const agentProfileSchema = z
  .object({
    auth_user_id: z.string().trim().uuid("請輸入有效 Neon Auth 使用者 ID").or(z.literal("")),
    email: z.string().trim().email("請輸入有效電郵").max(320).or(z.literal("")),
    name_zh: optionalText(100),
    name_en: optionalText(100),
    job_title: optionalText(100),
    phone: optionalText(40),
    whatsapp: optionalText(40),
    licence_no: optionalText(80),
    // seed-staff.mjs writes root-relative paths (/team/<slug>.jpg) for all 23
    // roster agents, and z.url() rejects them -- which blocked every admin edit to
    // every seeded agent, because safeParse validates the whole object. Schemes are
    // still restricted so an <img src> cannot be pointed anywhere arbitrary.
    avatar_url: z
      .string()
      .trim()
      .max(500)
      .refine(
        // `//host/x.jpg` is protocol-relative and loads from an arbitrary origin,
        // so a leading `/` alone is not enough to keep this same-origin.
        (value) =>
          value === "" ||
          (value.startsWith("/") && !value.startsWith("//")) ||
          /^https?:\/\/\S+$/.test(value),
        "請輸入有效相片網址，或以 / 開頭的路徑",
      ),
    branch: optionalText(120),
    bio: optionalText(2000),
    specialties: optionalText(2000),
    served_estate_slugs: optionalText(2000),
    public_slug: z
      .string()
      .trim()
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "請使用小寫英文、數字及連字號")
      .or(z.literal("")),
    show_on_website: z.boolean(),
    // Every other rule in this schema carries a Chinese message; without these,
    // typing "1.5" into 顯示排序 surfaced the raw "Expected integer, received float"
    // inline, in the file the audit certifies as the reference implementation.
    display_order: z.union([
      z.literal(""),
      z.coerce
        .number({ invalid_type_error: "請輸入數字" })
        .int("請輸入整數，不要小數點")
        .min(0, "請輸入 0 或以上的數字")
        .max(9999, "請輸入 9999 或以下的數字"),
    ]),
    active: z.boolean(),
  })
  .superRefine((data, context) => {
    if (!data.name_zh && !data.name_en) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "請輸入中文或英文名稱",
        path: ["name_zh"],
      });
    }
  });

export type AgentProfilePayloadData = {
  auth_user_id: string;
  email: string;
  name_zh: string;
  name_en: string;
  job_title: string;
  phone: string;
  whatsapp: string;
  licence_no: string;
  avatar_url: string;
  branch: string;
  bio: string;
  public_slug: string;
  // Newline/comma-separated free text in form state, same convention as
  // admin.cms.tsx's estate facilities field -- split into an array below.
  specialties: string;
  served_estate_slugs: string;
  show_on_website: boolean;
  // Matches agentProfileSchema's post-parse output (z.union([z.literal(""), z.coerce.number()...])):
  // "" means the field was left blank, a number means the user set an explicit value. This is
  // neither the raw form state (strings) nor the mutation payload (number | null) -- it's what
  // zod produces from the form state, which buildAgentProfilePayload below then maps to the
  // mutation payload's number | null.
  display_order: number | "";
  active: boolean;
};

function splitList(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildAgentProfilePayload({
  profileId,
  data,
  canManageIdentity,
}: {
  profileId?: string;
  data: AgentProfilePayloadData;
  canManageIdentity: boolean;
}): AdminAgentProfileMutationInput {
  return {
    id: profileId,
    name_zh: data.name_zh || null,
    name_en: data.name_en || null,
    job_title: data.job_title || null,
    phone: data.phone || null,
    whatsapp: data.whatsapp || null,
    licence_no: data.licence_no || null,
    avatar_url: data.avatar_url || null,
    branch: data.branch || null,
    bio: data.bio || null,
    public_slug: data.public_slug || null,
    specialties: splitList(data.specialties),
    served_estate_slugs: splitList(data.served_estate_slugs),
    show_on_website: data.show_on_website,
    display_order: data.display_order === "" ? null : Number(data.display_order),
    ...(canManageIdentity
      ? {
          auth_user_id: data.auth_user_id || null,
          email: data.email || null,
          active: data.active,
        }
      : {}),
  };
}
