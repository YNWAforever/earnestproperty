# Admin CMS CRM WhatsApp MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Neon-only `/admin` MVP with functional CMS editors, listing workflows, lead CRM actions, WhatsApp inbox replies, and compliant campaign blasting.

**Architecture:** Extend the existing TanStack Start admin surface instead of replacing it. Browser routes call `src/lib/neon/admin-data.ts` server-function wrappers, which verify staff roles and delegate SQL work to `src/lib/neon/admin-data.server.ts`; Woztell outbound remains behind server-only API routes and Vercel Blob remains upload storage with Neon metadata.

**Tech Stack:** TanStack Start, React 19, Neon Serverless, Neon Auth, Vercel Blob, Woztell BotAPI, Node test runner, shadcn/Radix UI components, lucide-react.

---

## Scope Check

This plan covers several admin modules, but they are not independent products: listings feed leads, leads connect to contacts, contacts connect to WhatsApp conversations, and contacts/audiences drive blasts. Implement as one MVP with independent commits per slice.

## File Structure

- Modify `src/lib/neon/admin-data.types.ts`: shared admin row/input types.
- Modify `src/lib/neon/admin-data.ts`: browser-safe server-function wrappers.
- Modify `src/lib/neon/admin-data.server.ts`: Neon SQL reads/writes and audit logging.
- Modify `src/lib/woztell/woztell.server.ts`: reply and blast guards.
- Modify `src/routes/admin.routes.test.mjs`: static route/workflow coverage.
- Create `src/lib/neon/admin-data.contract.test.mjs`: static data-contract coverage.
- Create `src/lib/neon/admin-workflow.test.mjs`: pure guard/contract tests.
- Create `src/components/admin/AdminToolbar.tsx`: reusable filters/actions header.
- Create `src/components/admin/AdminEmptyState.tsx`: empty/error/action prompt.
- Create `src/components/admin/AdminConfirmDialog.tsx`: destructive/status confirmation.
- Create `src/components/admin/AdminDetailPanel.tsx`: responsive detail drawer/sheet.
- Create `src/components/admin/AdminStatusSelect.tsx`: status select with save state.
- Modify `src/components/dashboard/PropertyForm.tsx`: listing SEO fields and agent assignment.
- Create `src/routes/admin.listings.new.tsx`: admin-native listing create route.
- Create `src/routes/admin.listings.$id.tsx`: admin-native listing edit route.
- Modify `src/routes/dashboard.property.new.tsx`: redirect or link to `/admin/listings/new`.
- Modify `src/routes/dashboard.property.$id.tsx`: redirect or link to `/admin/listings/$id`.
- Modify `src/routes/admin.cms.tsx`: CMS editor workspace.
- Modify `src/routes/admin.listings.tsx`: filters and listing actions.
- Modify `src/routes/admin.leads.tsx`: lead CRM workspace.
- Modify `src/routes/admin.whatsapp.tsx`: inbox workspace.
- Modify `src/routes/admin.blasts.tsx`: campaign builder/workspace.
- Modify `src/routes/api.admin.woztell.send.ts`: enforce service-window and opt-out guards.
- Modify `src/routes/api.admin.campaigns.$id.queue.ts`: materialize recipients before queueing.
- Modify `src/routes/api.admin.jobs.send-queue.ts`: status counts and campaign completion updates.

---

### Task 1: Admin Workflow Tests and Contracts

**Files:**
- Modify: `src/routes/admin.routes.test.mjs`
- Create: `src/lib/neon/admin-data.contract.test.mjs`
- Create: `src/lib/neon/admin-workflow.test.mjs`

- [ ] **Step 1: Add failing route/workflow assertions**

Append this test to `src/routes/admin.routes.test.mjs`:

```js
test("admin routes expose functional workflows, not only read-only tables", () => {
  const expectations = [
    ["src/routes/admin.cms.tsx", ["saveAdminEstate", "saveAdminArticle", "saveAdminFaq"]],
    ["src/routes/admin.listings.tsx", ["updateAdminPropertyStatus", "fetchAdminAgents"]],
    ["src/routes/admin.leads.tsx", ["fetchAdminLead", "updateAdminLead", "createAdminLeadActivity"]],
    ["src/routes/admin.whatsapp.tsx", ["fetchAdminConversation", "sendAdminConversationReply"]],
    ["src/routes/admin.blasts.tsx", ["saveAdminCampaign", "previewAdminAudience", "queueAdminCampaign"]],
  ];

  for (const [file, requiredNames] of expectations) {
    const source = read(file);
    for (const name of requiredNames) {
      assert.match(source, new RegExp(name), `${file} should use ${name}`);
    }
  }
});
```

- [ ] **Step 2: Add failing data-contract tests**

Create `src/lib/neon/admin-data.contract.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("admin data layer exposes CMS, listing, CRM, WhatsApp, and blast mutations", () => {
  const client = read("src/lib/neon/admin-data.ts");
  const server = read("src/lib/neon/admin-data.server.ts");
  const types = read("src/lib/neon/admin-data.types.ts");

  const exports = [
    "fetchAdminAgents",
    "saveAdminEstate",
    "saveAdminArticle",
    "saveAdminFaq",
    "deleteAdminFaq",
    "reorderAdminFaqs",
    "fetchAdminMediaAssets",
    "updateAdminMediaAsset",
    "updateAdminPropertyStatus",
    "fetchAdminLead",
    "updateAdminLead",
    "createAdminLeadActivity",
    "fetchAdminConversation",
    "updateAdminConversation",
    "fetchAdminBlastOptions",
    "saveAdminAudience",
    "previewAdminAudience",
    "saveAdminCampaign",
    "materializeCampaignRecipients",
    "queueAdminCampaign",
    "cancelAdminCampaign",
  ];

  for (const name of exports) {
    assert.match(client, new RegExp(`export async function ${name}|export const ${name}`));
    assert.match(server, new RegExp(`export async function ${name}`));
  }

  for (const typeName of [
    "AdminEstateInput",
    "AdminArticleInput",
    "AdminFaqInput",
    "AdminLeadDetail",
    "AdminConversationDetail",
    "AdminAudiencePreview",
    "AdminCampaignInput",
  ]) {
    assert.match(types, new RegExp(`export type ${typeName}`));
  }
});
```

- [ ] **Step 3: Add pure workflow guard tests**

Create `src/lib/neon/admin-workflow.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  canQueueAdminCampaign,
  canReplyToConversation,
  normalizeAdminPhone,
} from "./admin-data.server.ts";

test("normalizeAdminPhone keeps digits only", () => {
  assert.equal(normalizeAdminPhone("+852 6090 3521"), "85260903521");
  assert.equal(normalizeAdminPhone(" 6822-7287 "), "68227287");
  assert.equal(normalizeAdminPhone(null), null);
});

test("canReplyToConversation enforces Woztell safety gates", () => {
  const now = new Date("2026-06-23T12:00:00.000Z");
  assert.deepEqual(
    canReplyToConversation({
      woztellEnabled: true,
      optedOut: false,
      lastInboundAt: "2026-06-23T11:00:00.000Z",
      now,
    }),
    { ok: true },
  );
  assert.equal(
    canReplyToConversation({
      woztellEnabled: false,
      optedOut: false,
      lastInboundAt: "2026-06-23T11:00:00.000Z",
      now,
    }).reason,
    "WOZTELL_DISABLED",
  );
  assert.equal(
    canReplyToConversation({
      woztellEnabled: true,
      optedOut: true,
      lastInboundAt: "2026-06-23T11:00:00.000Z",
      now,
    }).reason,
    "CONTACT_OPTED_OUT",
  );
  assert.equal(
    canReplyToConversation({
      woztellEnabled: true,
      optedOut: false,
      lastInboundAt: "2026-06-22T11:00:00.000Z",
      now,
    }).reason,
    "OUTSIDE_24_HOUR_WINDOW",
  );
});

test("canQueueAdminCampaign enforces campaign gates", () => {
  assert.deepEqual(
    canQueueAdminCampaign({
      campaignStatus: "review",
      templateStatus: "active",
      eligibleRecipients: 4,
    }),
    { ok: true },
  );
  assert.equal(
    canQueueAdminCampaign({
      campaignStatus: "sending",
      templateStatus: "active",
      eligibleRecipients: 4,
    }).reason,
    "INVALID_CAMPAIGN_STATUS",
  );
  assert.equal(
    canQueueAdminCampaign({
      campaignStatus: "review",
      templateStatus: "paused",
      eligibleRecipients: 4,
    }).reason,
    "TEMPLATE_NOT_ACTIVE",
  );
  assert.equal(
    canQueueAdminCampaign({
      campaignStatus: "review",
      templateStatus: "active",
      eligibleRecipients: 0,
    }).reason,
    "NO_ELIGIBLE_RECIPIENTS",
  );
});
```

- [ ] **Step 4: Run tests and verify failure**

Run:

```bash
node --test src/routes/admin.routes.test.mjs src/lib/neon/admin-data.contract.test.mjs src/lib/neon/admin-workflow.test.mjs
```

Expected: FAIL because workflow functions and helpers are not implemented yet.

- [ ] **Step 5: Commit failing tests**

```bash
git add src/routes/admin.routes.test.mjs src/lib/neon/admin-data.contract.test.mjs src/lib/neon/admin-workflow.test.mjs
git commit -m "test: define admin MVP workflow contracts"
```

---

### Task 2: Admin Data Types and Server-Function Wrappers

**Files:**
- Modify: `src/lib/neon/admin-data.types.ts`
- Modify: `src/lib/neon/admin-data.ts`
- Test: `src/lib/neon/admin-data.contract.test.mjs`

- [ ] **Step 1: Extend admin data types**

Append these exported types to `src/lib/neon/admin-data.types.ts`:

```ts
export type AdminAgentRow = {
  id: string;
  name: string | null;
  email: string | null;
  roles: StaffRole[];
  active: boolean;
};

export type AdminEstateInput = {
  id?: string;
  slug: string;
  name_zh: string;
  name_en: string | null;
  district_slug: string;
  developer: string | null;
  year_completed: number | null;
  phases: number | null;
  total_units: number | null;
  area_min: number | null;
  area_max: number | null;
  description: string | null;
  hero_image: string | null;
  facilities: string[];
  seo_title: string | null;
  seo_description: string | null;
};

export type AdminArticleInput = {
  id?: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string | null;
  cover_image: string | null;
  category: string | null;
  reading_minutes: number | null;
  published: boolean;
  published_at: string | null;
  seo_title: string | null;
  seo_description: string | null;
};

export type AdminFaqInput = {
  id?: string;
  scope: string;
  question: string;
  answer: string;
  sort_order: number;
};

export type AdminMediaAssetRow = {
  id: string;
  url: string;
  pathname: string;
  content_type: string | null;
  size_bytes: number | null;
  alt_text: string | null;
  owner_type: string;
  owner_id: string | null;
  created_at: string;
};

export type AdminListingFiltersInput = {
  q?: string;
  status?: string;
  deal_type?: "sale" | "rent" | "all";
  estate_id?: string;
  featured?: "yes" | "no" | "all";
  agent_id?: string;
};

export type AdminLeadDetail = AdminLeadRow & {
  assigned_agent_id: string | null;
  preferred_estates: string[];
  activities: AdminLeadActivityRow[];
};

export type AdminLeadActivityRow = {
  id: string;
  activity_type: string;
  body: string | null;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  staff_name: string | null;
};

export type AdminLeadUpdateInput = {
  id: string;
  stage: string;
  intent: string;
  budget_min: number | null;
  budget_max: number | null;
  preferred_estates: string[];
  assigned_agent_id: string | null;
  note: string | null;
};

export type AdminLeadActivityInput = {
  lead_id: string;
  contact_id: string | null;
  activity_type: "note" | "call" | "viewing" | "follow_up";
  body: string;
  due_at: string | null;
  completed_at: string | null;
};

export type AdminConversationMessageRow = {
  id: string;
  direction: "inbound" | "outbound";
  message_type: string;
  text: string | null;
  status: string;
  error: string | null;
  created_at: string;
};

export type AdminConversationDetail = AdminConversationRow & {
  contact_id: string | null;
  assigned_agent_id: string | null;
  woztell_member_id: string | null;
  messages: AdminConversationMessageRow[];
};

export type AdminConversationUpdateInput = {
  id: string;
  status: string;
  assigned_agent_id: string | null;
};

export type AdminAudienceInput = {
  id?: string;
  name: string;
  description: string | null;
  filters: {
    intent?: string;
    source?: string;
    estate?: string;
    assigned_agent_id?: string;
  };
};

export type AdminAudiencePreview = {
  total: number;
  eligible: number;
  optedOut: number;
  missingPhone: number;
  notOptedIn: number;
};

export type AdminCampaignInput = {
  id?: string;
  name: string;
  template_id: string | null;
  audience_id: string | null;
  status: "draft" | "review" | "scheduled";
  scheduled_at: string | null;
};

export type AdminBlastOptions = {
  templates: Array<{ id: string; element_name: string; language_code: string; status: string }>;
  audiences: Array<{ id: string; name: string; description: string | null }>;
};
```

- [ ] **Step 2: Add server-function wrappers**

In `src/lib/neon/admin-data.ts`, import the new types and add wrappers after the existing functions. Use this exact pattern for each wrapper:

```ts
import type {
  AdminArticleInput,
  AdminAudienceInput,
  AdminCampaignInput,
  AdminConversationUpdateInput,
  AdminEstateInput,
  AdminFaqInput,
  AdminLeadActivityInput,
  AdminLeadUpdateInput,
  AdminListingFiltersInput,
} from "./admin-data.types";
```

Then add these exports:

```ts
const fetchAdminAgentsServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.fetchAdminAgents();
});
export async function fetchAdminAgents() {
  return callStaffServerFn(async () => fetchAdminAgentsServer(await withStaffAuthHeaders()));
}

const saveAdminEstateServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminEstateInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.saveAdminEstate(data, staff);
  });
export async function saveAdminEstate(options: { data: AdminEstateInput }) {
  return callStaffServerFn(async () => saveAdminEstateServer(await withStaffAuthHeaders(options)));
}

const saveAdminArticleServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminArticleInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.saveAdminArticle(data, staff);
  });
export async function saveAdminArticle(options: { data: AdminArticleInput }) {
  return callStaffServerFn(async () => saveAdminArticleServer(await withStaffAuthHeaders(options)));
}

const saveAdminFaqServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminFaqInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.saveAdminFaq(data, staff);
  });
export async function saveAdminFaq(options: { data: AdminFaqInput }) {
  return callStaffServerFn(async () => saveAdminFaqServer(await withStaffAuthHeaders(options)));
}

const deleteAdminFaqServer = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.deleteAdminFaq(data.id, staff);
  });
export async function deleteAdminFaq(options: { data: { id: string } }) {
  return callStaffServerFn(async () => deleteAdminFaqServer(await withStaffAuthHeaders(options)));
}

const reorderAdminFaqsServer = createServerFn({ method: "POST" })
  .inputValidator((data: { orderedIds: string[] }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.reorderAdminFaqs(data.orderedIds, staff);
  });
export async function reorderAdminFaqs(options: { data: { orderedIds: string[] } }) {
  return callStaffServerFn(async () => reorderAdminFaqsServer(await withStaffAuthHeaders(options)));
}

const fetchAdminMediaAssetsServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.fetchAdminMediaAssets();
});
export async function fetchAdminMediaAssets() {
  return callStaffServerFn(async () => fetchAdminMediaAssetsServer(await withStaffAuthHeaders()));
}

const updateAdminMediaAssetServer = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; alt_text: string | null; owner_type: string; owner_id: string | null }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.updateAdminMediaAsset(data, staff);
  });
export async function updateAdminMediaAsset(options: { data: { id: string; alt_text: string | null; owner_type: string; owner_id: string | null } }) {
  return callStaffServerFn(async () => updateAdminMediaAssetServer(await withStaffAuthHeaders(options)));
}

const fetchAdminListingsFilteredServer = createServerFn({ method: "GET" })
  .inputValidator((data: AdminListingFiltersInput) => data)
  .handler(async ({ data }) => {
    await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.listAdminListings(data);
  });
export async function fetchAdminListingsFiltered(options: { data: AdminListingFiltersInput }) {
  return callStaffServerFn(async () => fetchAdminListingsFilteredServer(await withStaffAuthHeaders(options)));
}

const updateAdminPropertyStatusServer = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; status: AdminPropertyInput["status"] }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.updateAdminPropertyStatus(data.id, data.status, staff);
  });
export async function updateAdminPropertyStatus(options: { data: { id: string; status: AdminPropertyInput["status"] } }) {
  return callStaffServerFn(async () => updateAdminPropertyStatusServer(await withStaffAuthHeaders(options)));
}
```

Add the CRM, inbox, and blasts wrappers with the same `callStaffServerFn(await withStaffAuthHeaders(options))` pattern and these exported names:

```ts
export async function fetchAdminLead(options: { data: { id: string } });
export async function updateAdminLead(options: { data: AdminLeadUpdateInput });
export async function createAdminLeadActivity(options: { data: AdminLeadActivityInput });
export async function fetchAdminConversation(options: { data: { id: string } });
export async function updateAdminConversation(options: { data: AdminConversationUpdateInput });
export async function fetchAdminBlastOptions();
export async function saveAdminAudience(options: { data: AdminAudienceInput });
export async function previewAdminAudience(options: { data: { audience_id?: string; filters?: AdminAudienceInput["filters"] } });
export async function saveAdminCampaign(options: { data: AdminCampaignInput });
export async function materializeCampaignRecipients(options: { data: { campaign_id: string } });
export async function queueAdminCampaign(options: { data: { id: string } });
export async function cancelAdminCampaign(options: { data: { id: string } });
```

For each declaration above, implement a real server function with the role lists from the design: `admin, manager, agent` for assigned CRM/inbox work and `admin, manager` for CMS and blasts.

- [ ] **Step 3: Run contract tests**

Run:

```bash
node --test src/lib/neon/admin-data.contract.test.mjs
```

Expected: FAIL only on missing server implementations in `admin-data.server.ts`.

- [ ] **Step 4: Commit type and wrapper skeletons**

```bash
git add src/lib/neon/admin-data.types.ts src/lib/neon/admin-data.ts
git commit -m "feat: add admin MVP data contracts"
```

---

### Task 3: Server Implementations, Guards, and Audit Writes

**Files:**
- Modify: `src/lib/neon/admin-data.server.ts`
- Test: `src/lib/neon/admin-data.contract.test.mjs`
- Test: `src/lib/neon/admin-workflow.test.mjs`

- [ ] **Step 1: Add pure workflow helpers**

Add these exported helpers near the top of `src/lib/neon/admin-data.server.ts`:

```ts
export function normalizeAdminPhone(value: unknown) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(/\D/g, "");
  return normalized || null;
}

export function canReplyToConversation(input: {
  woztellEnabled: boolean;
  optedOut: boolean;
  lastInboundAt: Date | string | null;
  now?: Date;
}) {
  if (!input.woztellEnabled) return { ok: false as const, reason: "WOZTELL_DISABLED" };
  if (input.optedOut) return { ok: false as const, reason: "CONTACT_OPTED_OUT" };
  const now = input.now ?? new Date();
  if (!input.lastInboundAt) return { ok: false as const, reason: "OUTSIDE_24_HOUR_WINDOW" };
  const inbound =
    input.lastInboundAt instanceof Date ? input.lastInboundAt : new Date(input.lastInboundAt);
  if (Number.isNaN(inbound.getTime())) {
    return { ok: false as const, reason: "OUTSIDE_24_HOUR_WINDOW" };
  }
  if (now.getTime() - inbound.getTime() > 24 * 60 * 60 * 1000) {
    return { ok: false as const, reason: "OUTSIDE_24_HOUR_WINDOW" };
  }
  return { ok: true as const };
}

export function canQueueAdminCampaign(input: {
  campaignStatus: string;
  templateStatus: string | null;
  eligibleRecipients: number;
}) {
  if (!["draft", "review", "scheduled"].includes(input.campaignStatus)) {
    return { ok: false as const, reason: "INVALID_CAMPAIGN_STATUS" };
  }
  if (!String(input.templateStatus ?? "").startsWith("active")) {
    return { ok: false as const, reason: "TEMPLATE_NOT_ACTIVE" };
  }
  if (input.eligibleRecipients <= 0) {
    return { ok: false as const, reason: "NO_ELIGIBLE_RECIPIENTS" };
  }
  return { ok: true as const };
}
```

- [ ] **Step 2: Implement CMS and media server functions**

Add functions using these SQL shapes:

```ts
export async function fetchAdminAgents() {
  const rows = await queryRows(`
    SELECT
      s.id,
      COALESCE(s.name_zh, s.name_en) AS name,
      s.email,
      s.active,
      COALESCE(array_to_json(array_agg(r.role) FILTER (WHERE r.role IS NOT NULL)), '[]'::json) AS roles
    FROM staff_users s
    LEFT JOIN staff_roles r ON r.staff_user_id = s.id
    GROUP BY s.id
    ORDER BY s.active DESC, name ASC NULLS LAST, s.email ASC NULLS LAST
  `);
  return rows.map((row) => ({
    id: stringOrEmpty(row.id),
    name: stringOrNull(row.name),
    email: stringOrNull(row.email),
    active: row.active === true,
    roles: Array.isArray(row.roles) ? row.roles.map(String) : [],
  }));
}

export async function saveAdminEstate(input: AdminEstateInput, actor: StaffAccess) {
  const rows = input.id
    ? await queryRows(
        `UPDATE estates SET slug=$1, name_zh=$2, name_en=$3, district_slug=$4, developer=$5,
          year_completed=$6, phases=$7, total_units=$8, area_min=$9, area_max=$10,
          description=$11, hero_image=$12, facilities=$13::text[], seo_title=$14,
          seo_description=$15, updated_at=now()
         WHERE id=$16 RETURNING id`,
        [
          input.slug,
          input.name_zh,
          input.name_en,
          input.district_slug,
          input.developer,
          input.year_completed,
          input.phases,
          input.total_units,
          input.area_min,
          input.area_max,
          input.description,
          input.hero_image,
          input.facilities,
          input.seo_title,
          input.seo_description,
          input.id,
        ],
      )
    : await queryRows(
        `INSERT INTO estates (slug, name_zh, name_en, district_slug, developer, year_completed,
          phases, total_units, area_min, area_max, description, hero_image, facilities,
          seo_title, seo_description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text[],$14,$15)
         RETURNING id`,
        [
          input.slug,
          input.name_zh,
          input.name_en,
          input.district_slug,
          input.developer,
          input.year_completed,
          input.phases,
          input.total_units,
          input.area_min,
          input.area_max,
          input.description,
          input.hero_image,
          input.facilities,
          input.seo_title,
          input.seo_description,
        ],
      );
  const id = stringOrEmpty(rows[0]?.id);
  await writeAudit(actor.staffId, input.id ? "estate.update" : "estate.create", "estate", id);
  return { id };
}
```

Implement the remaining CMS functions with these exact behaviors:

- `saveAdminArticle`: require non-empty `slug` and `title`; insert or update `articles` columns `slug`, `title`, `excerpt`, `content`, `cover_image`, `category`, `reading_minutes`, `published`, `published_at`, `seo_title`, `seo_description`, `author_id`; write `article.create` or `article.update`.
- `saveAdminFaq`: require non-empty `scope`, `question`, and `answer`; insert or update `faqs` columns `scope`, `question`, `answer`, `sort_order`; write `faq.create` or `faq.update`.
- `deleteAdminFaq`: delete from `faqs` by `id`; write `faq.delete`.
- `reorderAdminFaqs`: update each id in `orderedIds` with `sort_order = index + 1`; write `faq.reorder` with `{ orderedIds }`.
- `fetchAdminMediaAssets`: select `id`, `url`, `pathname`, `content_type`, `size_bytes`, `alt_text`, `owner_type`, `owner_id`, and `created_at` from `media_assets` ordered by `created_at DESC`.
- `updateAdminMediaAsset`: update `alt_text`, `owner_type`, and `owner_id` by id; write `media.update`.

- [ ] **Step 3: Extend listing server functions**

Update `listAdminListings(input)` to support `q`, `status`, `deal_type`, `estate_id`, `featured`, and `agent_id` filters with parameterized SQL using the existing `addParam` helper. Extend `saveAdminProperty` to write `seo_title` and `seo_description`. Add:

```ts
export async function updateAdminPropertyStatus(
  id: string,
  status: AdminPropertyInput["status"],
  actor: StaffAccess,
) {
  await queryRows("UPDATE properties SET status = $1::property_status, updated_at = now() WHERE id = $2", [
    status,
    id,
  ]);
  await writeAudit(actor.staffId, "property.status", "property", id, { status });
  return { ok: true };
}
```

- [ ] **Step 4: Implement CRM server functions**

Add `fetchAdminLead`, `updateAdminLead`, and `createAdminLeadActivity`. `fetchAdminLead` must return the lead row plus `activities` ordered by `created_at DESC`. `updateAdminLead` updates `crm_leads` fields and writes `lead.update`. `createAdminLeadActivity` inserts into `crm_activities` with `staff_user_id = actor.staffId` and writes `lead.activity`.

- [ ] **Step 5: Implement inbox server functions**

Add `fetchAdminConversation` and `updateAdminConversation`. `fetchAdminConversation` returns the conversation row plus the latest 100 messages ordered ascending for display. `updateAdminConversation` updates `status`, `assigned_agent_id`, `updated_at`, and writes `conversation.update`.

- [ ] **Step 6: Implement blast server functions**

Add `fetchAdminBlastOptions`, `saveAdminAudience`, `previewAdminAudience`, `saveAdminCampaign`, `materializeCampaignRecipients`, `queueAdminCampaign`, and `cancelAdminCampaign`.

Use this recipient eligibility SQL inside `previewAdminAudience` and `materializeCampaignRecipients`:

```sql
SELECT c.id, c.normalized_phone, c.opt_in_whatsapp, c.opted_out_whatsapp
FROM crm_contacts c
LEFT JOIN crm_leads l ON l.contact_id = c.id
WHERE ($1::text IS NULL OR l.intent = $1)
  AND ($2::text IS NULL OR c.source = $2)
  AND ($3::uuid IS NULL OR c.assigned_agent_id = $3::uuid OR l.assigned_agent_id = $3::uuid)
```

Classify each row as eligible only when `normalized_phone` is present, `opt_in_whatsapp = true`, and `opted_out_whatsapp = false`.

- [ ] **Step 7: Run server tests**

Run:

```bash
node --test src/lib/neon/admin-workflow.test.mjs src/lib/neon/admin-data.contract.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit server implementations**

```bash
git add src/lib/neon/admin-data.server.ts src/lib/neon/admin-data.types.ts
git commit -m "feat: implement admin MVP Neon workflows"
```

---

### Task 4: Shared Admin UI Components

**Files:**
- Create: `src/components/admin/AdminToolbar.tsx`
- Create: `src/components/admin/AdminEmptyState.tsx`
- Create: `src/components/admin/AdminConfirmDialog.tsx`
- Create: `src/components/admin/AdminDetailPanel.tsx`
- Create: `src/components/admin/AdminStatusSelect.tsx`
- Modify: `src/routes/admin.routes.test.mjs`

- [ ] **Step 1: Add component existence assertions**

Append to `src/routes/admin.routes.test.mjs`:

```js
test("shared admin workflow components exist", () => {
  for (const file of [
    "src/components/admin/AdminToolbar.tsx",
    "src/components/admin/AdminEmptyState.tsx",
    "src/components/admin/AdminConfirmDialog.tsx",
    "src/components/admin/AdminDetailPanel.tsx",
    "src/components/admin/AdminStatusSelect.tsx",
  ]) {
    assert.equal(existsSync(join(root, file)), true, `${file} should exist`);
  }
});
```

- [ ] **Step 2: Create `AdminToolbar`**

```tsx
import { ReactNode } from "react";

export function AdminToolbar({
  filters,
  actions,
}: {
  filters: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border bg-background p-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-1 flex-wrap gap-2">{filters}</div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
```

- [ ] **Step 3: Create `AdminEmptyState`**

```tsx
import { ReactNode } from "react";

export function AdminEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed bg-background p-8 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: Create `AdminConfirmDialog`**

Use existing `src/components/ui/alert-dialog.tsx` exports:

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function AdminConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 5: Create `AdminDetailPanel` and `AdminStatusSelect`**

Use `Sheet` for `AdminDetailPanel` and `Select` for `AdminStatusSelect`. Keep both controlled components: parent owns `open`, `value`, and `onChange`.

- [ ] **Step 6: Run component test**

```bash
node --test src/routes/admin.routes.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit shared components**

```bash
git add src/components/admin src/routes/admin.routes.test.mjs
git commit -m "feat: add shared admin workflow components"
```

---

### Task 5: CMS Editors

**Files:**
- Modify: `src/routes/admin.cms.tsx`
- Test: `src/routes/admin.routes.test.mjs`

- [ ] **Step 1: Write failing CMS route assertions**

Extend the CMS expectation in `src/routes/admin.routes.test.mjs` to require these strings:

```js
for (const text of ["屋苑 SEO", "文章編輯", "FAQ 編輯", "媒體庫", "saveAdminEstate", "saveAdminArticle", "saveAdminFaq", "updateAdminMediaAsset"]) {
  assert.match(read("src/routes/admin.cms.tsx"), new RegExp(text));
}
```

- [ ] **Step 2: Replace read-only CMS page with tabs**

In `src/routes/admin.cms.tsx`, import `Tabs`, `Dialog`, `Input`, `Textarea`, `Switch`, `Button`, and the new server functions. Build four tabs:

- `estates`: table plus edit dialog.
- `articles`: table plus edit dialog.
- `faqs`: grouped rows plus edit dialog.
- `media`: media table with alt text editor.

Use local state:

```ts
const [activeTab, setActiveTab] = useState("estates");
const [saving, setSaving] = useState(false);
const [editingEstate, setEditingEstate] = useState<AdminEstateInput | null>(null);
const [editingArticle, setEditingArticle] = useState<AdminArticleInput | null>(null);
const [editingFaq, setEditingFaq] = useState<AdminFaqInput | null>(null);
```

- [ ] **Step 3: Implement save handlers**

Each handler must set `saving`, call the matching server function, refresh `fetchAdminCms()`, show `toast.success`, and clear the editor state. On error, show `toast.error`.

- [ ] **Step 4: Run route test**

```bash
node --test src/routes/admin.routes.test.mjs
```

Expected: PASS for CMS assertions.

- [ ] **Step 5: Commit CMS editors**

```bash
git add src/routes/admin.cms.tsx src/routes/admin.routes.test.mjs
git commit -m "feat: add admin CMS editors"
```

---

### Task 6: Listings Workflow Completion

**Files:**
- Modify: `src/components/dashboard/PropertyForm.tsx`
- Create: `src/routes/admin.listings.new.tsx`
- Create: `src/routes/admin.listings.$id.tsx`
- Modify: `src/routes/admin.listings.tsx`
- Modify: `src/routes/dashboard.property.new.tsx`
- Modify: `src/routes/dashboard.property.$id.tsx`
- Test: `src/routes/admin.routes.test.mjs`

- [ ] **Step 1: Write failing listing workflow assertions**

Assert `src/routes/admin.listings.tsx` contains:

```js
for (const text of ["fetchAdminListingsFiltered", "updateAdminPropertyStatus", "fetchAdminAgents", "公開預覽", "下架", "已售", "已租"]) {
  assert.match(read("src/routes/admin.listings.tsx"), new RegExp(text));
}
```

Assert route files exist:

```js
for (const file of ["src/routes/admin.listings.new.tsx", "src/routes/admin.listings.$id.tsx"]) {
  assert.equal(existsSync(join(root, file)), true, `${file} should exist`);
}
```

- [ ] **Step 2: Extend `PropertyForm`**

Add fields and payload mapping for:

```ts
seo_title: property?.seo_title ?? "",
seo_description: property?.seo_description ?? "",
agent_id: property?.agent_id ?? "",
```

Fetch agents with `fetchAdminAgents()`, render agent select, and include `seo_title`, `seo_description`, and selected `agent_id || null` in the save payload.

- [ ] **Step 3: Create admin-native create/edit routes**

`src/routes/admin.listings.new.tsx` should mirror the current new property route but use route path `/admin/listings/new` and return to `/admin/listings`.

`src/routes/admin.listings.$id.tsx` should mirror the current edit property route but use route path `/admin/listings/$id`.

- [ ] **Step 4: Update listing table**

Use `AdminToolbar` with filters for status, deal type, estate, featured, and agent. Use `fetchAdminListingsFiltered({ data: filters })`. Add row action buttons:

- Edit: `/admin/listings/$id`
- Preview: `/property/$listingNo`
- Mark offline: `updateAdminPropertyStatus({ data: { id, status: "offline" } })`
- Mark sold/rented based on deal type.

- [ ] **Step 5: Keep old dashboard routes usable**

Change old dashboard routes to navigate staff toward the admin-native route after auth:

```tsx
<Link to="/admin/listings/new">前往新版後台新增放盤</Link>
```

and

```tsx
<Link to="/admin/listings/$id" params={{ id }}>前往新版後台編輯放盤</Link>
```

- [ ] **Step 6: Run tests**

```bash
node --test src/routes/admin.routes.test.mjs src/lib/neon/admin-data.contract.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit listings workflow**

```bash
git add src/components/dashboard/PropertyForm.tsx src/routes/admin.listings.tsx src/routes/admin.listings.new.tsx src/routes/admin.listings.$id.tsx src/routes/dashboard.property.new.tsx src/routes/dashboard.property.$id.tsx src/routes/admin.routes.test.mjs
git commit -m "feat: complete admin listings workflow"
```

---

### Task 7: Leads CRM Workspace

**Files:**
- Modify: `src/routes/admin.leads.tsx`
- Test: `src/routes/admin.routes.test.mjs`

- [ ] **Step 1: Write failing CRM route assertions**

Assert `src/routes/admin.leads.tsx` contains:

```js
for (const text of ["fetchAdminLead", "updateAdminLead", "createAdminLeadActivity", "Activity", "跟進", "成交", "失敗"]) {
  assert.match(read("src/routes/admin.leads.tsx"), new RegExp(text));
}
```

- [ ] **Step 2: Build lead list filters**

Add local filters for stage, intent, source, assigned agent, opt-in, and query. Keep the first load as `fetchAdminLeads()`; filter client-side first to avoid broad SQL changes beyond Task 3.

- [ ] **Step 3: Add detail panel**

When a row is clicked, call `fetchAdminLead({ data: { id } })` and render `AdminDetailPanel` with contact details, lead fields, assigned agent, stage select, budget, related listing, opt-in state, and activities.

- [ ] **Step 4: Add actions**

Implement:

- Save lead: `updateAdminLead`.
- Add note: `createAdminLeadActivity` with `activity_type: "note"`.
- Mark won: stage `closed_won`.
- Mark lost: stage `closed_lost`.

- [ ] **Step 5: Run tests**

```bash
node --test src/routes/admin.routes.test.mjs src/lib/neon/admin-data.contract.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit CRM workspace**

```bash
git add src/routes/admin.leads.tsx src/routes/admin.routes.test.mjs
git commit -m "feat: add admin lead CRM workflow"
```

---

### Task 8: WhatsApp Inbox Workspace

**Files:**
- Modify: `src/routes/admin.whatsapp.tsx`
- Modify: `src/routes/api.admin.woztell.send.ts`
- Test: `src/routes/admin.routes.test.mjs`
- Test: `src/lib/woztell/woztell.test.mjs`

- [ ] **Step 1: Write failing inbox assertions**

Assert `src/routes/admin.whatsapp.tsx` contains:

```js
for (const text of ["fetchAdminConversation", "updateAdminConversation", "sendAdminConversationReply", "24 小時", "WOZTELL_ENABLED", "回覆"]) {
  assert.match(read("src/routes/admin.whatsapp.tsx"), new RegExp(text));
}
```

- [ ] **Step 2: Harden send API**

In `src/routes/api.admin.woztell.send.ts`, before `sendWoztellResponse`, fetch conversation/contact by `conversationId`, call `canReplyToConversation`, and return `400` with `{ ok: false, error: reason }` for blocked sends. Keep successful outbound persistence in `whatsapp_messages`.

- [ ] **Step 3: Add `sendAdminConversationReply` client helper**

In `src/lib/neon/admin-data.ts`, add a browser helper that posts to `/api/admin/woztell/send` with `conversationId`, `recipientId`, and `text`. Use `withStaffAuthHeaders` to include auth.

- [ ] **Step 4: Build inbox layout**

Update `src/routes/admin.whatsapp.tsx` to use a two-column layout on desktop:

- Left: conversation list with status and opt-out badges.
- Right: selected conversation messages and reply box.
- Mobile: use `AdminDetailPanel`.

Disable reply when no selected conversation, opted out, Woztell disabled, or outside the 24-hour window.

- [ ] **Step 5: Run tests**

```bash
node --test src/routes/admin.routes.test.mjs src/lib/woztell/woztell.test.mjs src/lib/neon/admin-workflow.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit inbox workflow**

```bash
git add src/routes/admin.whatsapp.tsx src/routes/api.admin.woztell.send.ts src/lib/neon/admin-data.ts src/routes/admin.routes.test.mjs
git commit -m "feat: add safe WhatsApp inbox workflow"
```

---

### Task 9: Blasts Campaign Workflow

**Files:**
- Modify: `src/routes/admin.blasts.tsx`
- Modify: `src/routes/api.admin.campaigns.$id.queue.ts`
- Modify: `src/routes/api.admin.jobs.send-queue.ts`
- Test: `src/routes/admin.routes.test.mjs`
- Test: `src/lib/neon/admin-workflow.test.mjs`

- [ ] **Step 1: Write failing blast assertions**

Assert `src/routes/admin.blasts.tsx` contains:

```js
for (const text of ["fetchAdminBlastOptions", "saveAdminAudience", "previewAdminAudience", "saveAdminCampaign", "materializeCampaignRecipients", "queueAdminCampaign", "cancelAdminCampaign", "合資格", "Opt-out"]) {
  assert.match(read("src/routes/admin.blasts.tsx"), new RegExp(text));
}
```

- [ ] **Step 2: Update queue API**

In `src/routes/api.admin.campaigns.$id.queue.ts`, call `materializeCampaignRecipients(params.id, staff)` before `queueCampaign(params.id, staff)`. Return the materialization counts with the queue result.

- [ ] **Step 3: Update send queue job**

In `src/routes/api.admin.jobs.send-queue.ts`, after processing recipients, update campaign status:

- `sending` when queued recipients remain.
- `completed` when no queued recipients remain and at least one recipient exists.
- `failed` when every materialized recipient is failed or blocked.

Return `{ ok: true, sent, checked, blocked, failed }`.

- [ ] **Step 4: Build campaign UI**

Update `src/routes/admin.blasts.tsx` with:

- Campaign list.
- New campaign dialog with name, template, audience, schedule, and status.
- Audience editor dialog with name, description, and filters.
- Preview panel showing total, eligible, opted-out, missing-phone, and not-opted-in counts.
- Queue button enabled only when preview eligible count is greater than zero and campaign status is draft/review/scheduled.
- Cancel button for draft/review/scheduled/queued/sending.

- [ ] **Step 5: Run tests**

```bash
node --test src/routes/admin.routes.test.mjs src/lib/neon/admin-workflow.test.mjs src/lib/neon/admin-data.contract.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit blasts workflow**

```bash
git add src/routes/admin.blasts.tsx src/routes/api.admin.campaigns.$id.queue.ts src/routes/api.admin.jobs.send-queue.ts src/routes/admin.routes.test.mjs
git commit -m "feat: add compliant WhatsApp blast workflow"
```

---

### Task 10: Verification, Build, and Deployment

**Files:**
- Modify only files that fail verification.

- [ ] **Step 1: Run focused tests**

```bash
node --test src/routes/admin.routes.test.mjs src/config/neon-auth.test.mjs src/lib/woztell/woztell.test.mjs src/lib/neon/admin-data.contract.test.mjs src/lib/neon/admin-workflow.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 2: Run full tests**

```bash
node --test
```

Expected: all tests PASS.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: PASS. Existing Fast Refresh warnings are acceptable only if they predate this work and no new warnings are introduced.

- [ ] **Step 4: Run production build**

```bash
npm run build
```

Expected: build completes and `.output/nitro.json` is generated.

- [ ] **Step 5: Check client bundle for secret leaks**

```bash
rg "DATABASE_URL|WOZTELL_BOT_ACCESS_TOKEN|WOZTELL_CHANNEL_SECRET|BLOB_READ_WRITE_TOKEN" dist .output/public src --glob '!src/**/*.ts' --glob '!src/**/*.tsx'
```

Expected: no matches in browser assets. Matches in server source are acceptable.

- [ ] **Step 6: Commit verification fixes**

If verification required code changes:

```bash
git add .
git commit -m "fix: stabilize admin MVP verification"
```

If no changes were needed, do not create an empty commit.

- [ ] **Step 7: Push branch**

```bash
git push origin codex/seo-full-content-mls-plan
```

Expected: push succeeds.

- [ ] **Step 8: Deploy to Vercel production after approval**

Upgrade the local Vercel CLI first for best compatibility:

```bash
npm i -g vercel@latest
```

Then deploy:

```bash
vercel deploy --prod -y --no-wait --scope ynwaforevers-projects
```

Poll:

```bash
vercel inspect <deployment-url> --scope ynwaforevers-projects
```

Expected: status `Ready` and alias includes `https://earnestproperty.vercel.app`.

- [ ] **Step 9: Verify production routes**

```bash
for route in /admin /admin/cms /admin/listings /admin/leads /admin/whatsapp /admin/blasts; do
  code=$(/usr/bin/curl -sS -L -o /tmp/earnest-admin-route.html -w '%{http_code}' "https://earnestproperty.vercel.app$route")
  echo "$route $code"
done
```

Expected:

```text
/admin 200
/admin/cms 200
/admin/listings 200
/admin/leads 200
/admin/whatsapp 200
/admin/blasts 200
```

- [ ] **Step 10: Final commit marker**

If deployment-only checks changed no files, do not commit. Report deployment URL, production alias, tests run, and any environment variables still needed for live Woztell sending.
