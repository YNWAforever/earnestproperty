import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { Building2, MessageCircle, Phone, Search, UserRound, X } from "lucide-react";

import { AppImage } from "@/components/media/AppImage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { canonicalLink, SITE_URL } from "@/content/seo";
import { estateRegistry } from "@/content/estate-registry";
import { itemListSchema, jsonLdScript } from "@/lib/schema";
import { fetchNeonBranches, fetchNeonPublicAgentProfiles } from "@/lib/neon/public-data";
import type { NeonBranchRecord, NeonPublicAgentProfile } from "@/lib/neon/public-data.types";
import { agentBranchName, agentContactNote, resolveAgentContact } from "@/lib/agent-directory";
import { toTelHref, toWhatsAppHref } from "@/lib/contact-links";

// Mirrors /listings' DISTRICT_LABELS (src/routes/listings.tsx) -- same four
// districts, same display strings. Kept as its own small copy rather than an
// import: it's four entries, and pulling it from listings.tsx would make an
// unrelated route reach into this one's internals for four string literals.
const AGENT_DISTRICT_LABELS: Record<string, string> = {
  "sham-tseng": "深井",
  "ting-kau": "汀九",
  "tsuen-wan": "荃灣",
  "castle-peak-road": "青山公路",
};

function agentDistrictLabel(slug: string) {
  return AGENT_DISTRICT_LABELS[slug] ?? slug;
}

/**
 * Derives the districts an agent can be said to serve from
 * `served_estate_slugs`, via estate-registry's real `districtSlug` (never
 * `getEstateEntry()`, which throws on an unknown slug -- an admin-entered
 * served_estate_slugs value has no guarantee of matching the curated
 * registry, and one bad slug must not crash the whole directory). An estate
 * slug with no registry entry, or a registry entry with no districtSlug yet,
 * simply contributes nothing -- consistent with this whole plan's "don't
 * fabricate, only surface what's genuinely known" discipline.
 */
function agentDistrictSlugs(agent: NeonPublicAgentProfile): string[] {
  const slugs = new Set<string>();
  for (const estateSlug of agent.served_estate_slugs) {
    const entry = estateRegistry.find((candidate) => candidate.slug === estateSlug);
    if (entry?.districtSlug) slugs.add(entry.districtSlug);
  }
  return [...slugs];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-HK"));
}

type AgentDirectorySearch = {
  q?: string;
  branch?: string;
  district?: string;
  speciality?: string;
  language?: string;
};

const agentsSearchSchema = z.object({
  q: fallback(z.string().optional(), undefined),
  branch: fallback(z.string().optional(), undefined),
  district: fallback(z.string().optional(), undefined),
  speciality: fallback(z.string().optional(), undefined),
  language: fallback(z.string().optional(), undefined),
});

function matchesAgentFilters(
  agent: NeonPublicAgentProfile,
  filters: AgentDirectorySearch,
  branches: NeonBranchRecord[] = [],
): boolean {
  const query = filters.q?.trim().toLowerCase();
  if (query) {
    const haystack = [agent.name_zh, agent.name_en, agent.bio]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (filters.branch && agentBranchName(agent, branches) !== filters.branch) return false;
  if (filters.district && !agentDistrictSlugs(agent).includes(filters.district)) return false;
  if (filters.speciality && !agent.specialties.includes(filters.speciality)) return false;
  if (filters.language && !agent.languages.includes(filters.language)) return false;
  return true;
}

type AgentGroup = { branch: string | null; agents: NeonPublicAgentProfile[] };

/**
 * Groups by the agent's resolved branch name (branch_id-linked `branches`
 * row preferred, free-text `branch` string as fallback -- see
 * agentBranchName() in src/lib/agent-directory.ts), never a guessed/defaulted
 * one -- an agent with neither lands in its own `branch: null` group
 * (rendered last, under a generic heading) rather than being folded into an
 * existing named branch or dropped. See "branch is never defaulted in either
 * agent route" in agents.contract.test.mjs for why that distinction matters
 * here.
 */
function groupAgentsByBranch(
  agents: NeonPublicAgentProfile[],
  branches: NeonBranchRecord[] = [],
): AgentGroup[] {
  const named = new Map<string, NeonPublicAgentProfile[]>();
  const unassigned: NeonPublicAgentProfile[] = [];
  for (const agent of agents) {
    const branch = agentBranchName(agent, branches);
    if (branch) {
      const list = named.get(branch) ?? [];
      list.push(agent);
      named.set(branch, list);
    } else {
      unassigned.push(agent);
    }
  }
  const groups: AgentGroup[] = [...named.entries()]
    .map(([branch, members]) => ({ branch, agents: members }))
    .sort((a, b) => (a.branch ?? "").localeCompare(b.branch ?? "", "zh-HK"));
  if (unassigned.length > 0) groups.push({ branch: null, agents: unassigned });
  return groups;
}

export const Route = createFileRoute("/agents")({
  validateSearch: zodValidator(agentsSearchSchema),
  // No loaderDeps on `search` -- the roster is small enough (see
  // "client-side filter over already-loaded agents is fine given the small
  // roster size" in this plan) that filtering is a pure client-side
  // derivation over the one already-loaded list, not a new fetch per filter
  // change. branches is fetched alongside it for branch_id resolution (see
  // agentBranchName in src/lib/agent-directory.ts) -- small and public, same
  // reasoning as the agent roster itself.
  loader: async () => {
    const [agents, branches] = await Promise.all([
      fetchNeonPublicAgentProfiles() as Promise<NeonPublicAgentProfile[]>,
      fetchNeonBranches(),
    ]);
    return { agents, branches };
  },
  head: () => ({
    meta: [
      { title: "專業代理｜晉誠地產" },
      {
        name: "description",
        content: "認識晉誠地產專業代理團隊，直接聯絡合適代理了解深井、青山公路及汀九放盤。",
      },
    ],
    links: [canonicalLink("/agents")],
  }),
  pendingComponent: AgentDirectoryPending,
  errorComponent: AgentDirectoryError,
  component: AgentsPage,
});

function AgentsPage() {
  const { agents, branches } = Route.useLoaderData();
  const search = Route.useSearch();
  // itemListSchema stays derived from the FULL roster, not the current
  // filter selection -- same reasoning as /listings' bare canonical link:
  // the page's structured data should describe its canonical content, not
  // fork per filter combination someone happens to have applied.
  const listedAgents = agents.filter((agent) => agent.public_slug);
  const listSchema =
    listedAgents.length > 0
      ? itemListSchema({
          items: listedAgents.map((agent) => ({
            url: `${SITE_URL}/agents/${agent.public_slug}`,
            name: agent.name_zh || agent.name_en || "晉誠地產代理",
          })),
        })
      : null;

  const filteredAgents = agents.filter((agent) => matchesAgentFilters(agent, search, branches));
  const groups = groupAgentsByBranch(filteredAgents, branches);
  const hasActiveFilters = Boolean(
    search.q || search.branch || search.district || search.speciality || search.language,
  );

  return (
    <main className="bg-background">
      {listSchema ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript({ "@context": "https://schema.org", ...listSchema }),
          }}
        />
      ) : null}
      <AgentDirectoryHeader />
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        {agents.length === 0 ? <DirectoryEmptyState /> : null}
        {agents.length > 0 ? (
          <>
            <AgentDirectoryFilters agents={agents} branches={branches} search={search} />
            {filteredAgents.length === 0 ? (
              <NoMatchingAgents hasActiveFilters={hasActiveFilters} />
            ) : (
              <div className="space-y-10">
                {groups.map((group) => (
                  <AgentGroupSection
                    key={group.branch ?? "__unassigned__"}
                    group={group}
                    branches={branches}
                  />
                ))}
              </div>
            )}
          </>
        ) : null}
      </section>
    </main>
  );
}

function AgentGroupSection({
  group,
  branches,
}: {
  group: AgentGroup;
  branches: NeonBranchRecord[];
}) {
  return (
    <div>
      <h2 className="mb-4 flex items-baseline gap-2 border-b pb-2 text-lg font-semibold">
        {group.branch ?? "分行未指定"}
        <span className="text-sm font-normal text-muted-foreground">（{group.agents.length}）</span>
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        {group.agents.map((agent) => (
          <AgentDirectoryCard key={agent.id} agent={agent} branches={branches} />
        ))}
      </div>
    </div>
  );
}

function NoMatchingAgents({ hasActiveFilters }: { hasActiveFilters: boolean }) {
  const navigate = useNavigate({ from: "/agents" });
  return (
    <div className="border-y py-12 text-center">
      <h2 className="text-xl font-semibold">沒有符合條件的代理</h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
        請調整搜尋或篩選條件，或直接聯絡晉誠地產為你配對合適同事。
      </p>
      {hasActiveFilters ? (
        <Button
          type="button"
          variant="outline"
          className="mt-5"
          onClick={() => navigate({ search: {} })}
        >
          清除篩選
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Name search plus branch/district/speciality/language selects, all driven
 * straight off the validated URL search params via useNavigate -- no
 * component-local state anywhere in this route (agents.contract.test.mjs
 * source-scans this whole file for that). Every control is instant-apply:
 * this page filters an already-loaded, small roster client-side, so there is
 * no server round trip to batch behind a separate 套用 step the way
 * /listings' filter panel needs.
 */
function AgentDirectoryFilters({
  agents,
  branches,
  search,
}: {
  agents: NeonPublicAgentProfile[];
  branches: NeonBranchRecord[];
  search: AgentDirectorySearch;
}) {
  const navigate = useNavigate({ from: "/agents" });
  const branchOptions = uniqueSorted(
    agents
      .map((a) => agentBranchName(a, branches))
      .filter((branch): branch is string => Boolean(branch)),
  );
  const districtOptions = uniqueSorted(agents.flatMap(agentDistrictSlugs));
  const specialityOptions = uniqueSorted(agents.flatMap((a) => a.specialties));
  const languageOptions = uniqueSorted(agents.flatMap((a) => a.languages));

  function setParam(key: keyof AgentDirectorySearch, value: string | undefined) {
    navigate({
      search: (prev: Record<string, unknown>) => {
        const next = { ...prev };
        if (value === undefined) delete next[key];
        else next[key] = value;
        return next;
      },
      replace: true,
    });
  }

  return (
    <div className="mb-6 grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
      <div className="sm:col-span-2 lg:col-span-2">
        <Label className="mb-1.5 block text-xs" htmlFor="agent-search">
          搜尋代理姓名
        </Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="agent-search"
            type="search"
            placeholder="輸入代理姓名"
            value={search.q ?? ""}
            onChange={(e) => setParam("q", e.target.value.trim() || undefined)}
            className="h-11 pl-9"
          />
        </div>
      </div>

      {branchOptions.length > 0 ? (
        <div>
          <Label className="mb-1.5 block text-xs" htmlFor="agent-branch">
            分行
          </Label>
          <Select
            value={search.branch ?? "all"}
            onValueChange={(value) => setParam("branch", value === "all" ? undefined : value)}
          >
            <SelectTrigger id="agent-branch" className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">所有分行</SelectItem>
              {branchOptions.map((branch) => (
                <SelectItem key={branch} value={branch}>
                  {branch}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {districtOptions.length > 0 ? (
        <div>
          <Label className="mb-1.5 block text-xs" htmlFor="agent-district">
            熟悉地區
          </Label>
          <Select
            value={search.district ?? "all"}
            onValueChange={(value) => setParam("district", value === "all" ? undefined : value)}
          >
            <SelectTrigger id="agent-district" className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">所有地區</SelectItem>
              {districtOptions.map((slug) => (
                <SelectItem key={slug} value={slug}>
                  {agentDistrictLabel(slug)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {specialityOptions.length > 0 ? (
        <div>
          <Label className="mb-1.5 block text-xs" htmlFor="agent-speciality">
            專長
          </Label>
          <Select
            value={search.speciality ?? "all"}
            onValueChange={(value) => setParam("speciality", value === "all" ? undefined : value)}
          >
            <SelectTrigger id="agent-speciality" className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">所有專長</SelectItem>
              {specialityOptions.map((speciality) => (
                <SelectItem key={speciality} value={speciality}>
                  {speciality}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {languageOptions.length > 0 ? (
        <div>
          <Label className="mb-1.5 block text-xs" htmlFor="agent-language">
            語言
          </Label>
          <Select
            value={search.language ?? "all"}
            onValueChange={(value) => setParam("language", value === "all" ? undefined : value)}
          >
            <SelectTrigger id="agent-language" className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">所有語言</SelectItem>
              {languageOptions.map((language) => (
                <SelectItem key={language} value={language}>
                  {language}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {search.q || search.branch || search.district || search.speciality || search.language ? (
        <div className="flex items-end sm:col-span-2 lg:col-span-5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => navigate({ search: {} })}
          >
            <X className="h-3.5 w-3.5" />
            清除全部篩選
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function AgentDirectoryHeader() {
  return (
    <section className="border-b bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <p className="text-sm font-semibold text-primary">晉誠專業代理</p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">搵到合適代理，置業更清晰</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
          持牌代理團隊熟悉深井、青山公路及汀九市場，為買家、租客及業主提供直接、可靠的地產服務。
        </p>
      </div>
    </section>
  );
}

function AgentDirectoryCard({
  agent,
  branches,
}: {
  agent: NeonPublicAgentProfile;
  branches: NeonBranchRecord[];
}) {
  const name = agent.name_zh || agent.name_en || "晉誠地產代理";
  // No fallback: this used to default to the first configured branch (麗都分行), which
  // printed a real branch name on agents who work elsewhere. A missing branch renders
  // nothing — 董事 legitimately has none, and a blank beats a confident wrong answer.
  // agentBranchName prefers a branch_id match against `branches` (the real,
  // admin-editable table) over the free-text `branch` string, and null if
  // neither resolves.
  const branch = agentBranchName(agent, branches);
  const contact = resolveAgentContact(agent, branches);
  const note = agentContactNote(contact);
  const phoneHref = toTelHref(contact.phone);
  const whatsappHref = toWhatsAppHref(contact.whatsapp);

  return (
    <article className="grid gap-5 rounded-lg border bg-card p-5 sm:grid-cols-[104px_1fr]">
      <div className="aspect-square overflow-hidden rounded-md bg-muted">
        <AppImage
          src={agent.avatar_url}
          alt={`${name} 個人相片`}
          width={104}
          height={104}
          className="h-full w-full object-cover"
          fallback={
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <UserRound className="h-9 w-9" aria-hidden="true" />
            </div>
          }
        />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">{name}</h2>
            {agent.name_zh && agent.name_en ? (
              <p className="mt-1 text-sm text-muted-foreground">{agent.name_en}</p>
            ) : null}
          </div>
          {branch ? <span className="text-sm text-muted-foreground">{branch}</span> : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {agent.job_title ? <span>{agent.job_title}</span> : null}
          {agent.licence_no ? <span>牌照：{agent.licence_no}</span> : null}
          {agent.languages.length > 0 ? <span>語言：{agent.languages.join("、")}</span> : null}
        </div>
        {agent.bio ? (
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{agent.bio}</p>
        ) : null}
        {note ? <p className="mt-3 text-xs text-muted-foreground">{note}</p> : null}
        <div className="mt-5 flex flex-wrap gap-2">
          {agent.public_slug ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/agents/$slug" params={{ slug: agent.public_slug }}>
                <Building2 className="mr-2 h-4 w-4" />
                查看資料
              </Link>
            </Button>
          ) : null}
          {phoneHref ? (
            <Button asChild variant="outline" size="sm">
              <a href={phoneHref}>
                <Phone className="mr-2 h-4 w-4" />
                電話聯絡
              </a>
            </Button>
          ) : null}
          {whatsappHref ? (
            <Button asChild variant="brand" size="sm">
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="mr-2 h-4 w-4" />
                WhatsApp
              </a>
            </Button>
          ) : null}
          {contact.whatsappIsFallback ? (
            <Button asChild size="sm">
              <Link to="/contact">一般查詢</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function AgentDirectoryPending() {
  return (
    <main className="bg-background">
      <AgentDirectoryHeader />
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <DirectorySkeleton />
      </section>
    </main>
  );
}

function DirectorySkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2" aria-label="正在載入代理資料">
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} className="h-48 w-full" />
      ))}
    </div>
  );
}

function DirectoryEmptyState() {
  return (
    <div className="border-y py-12 text-center">
      <h2 className="text-xl font-semibold">未有可公開顯示的代理資料</h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
        請直接聯絡晉誠地產，我們會安排合適同事跟進你的放盤、買樓或租樓需要。
      </p>
      <Button asChild className="mt-5">
        <Link to="/contact">聯絡我們</Link>
      </Button>
    </div>
  );
}

function AgentDirectoryError() {
  return (
    <main className="bg-background">
      <AgentDirectoryHeader />
      <section
        className="mx-auto max-w-6xl px-4 py-10 text-center sm:px-6 lg:px-8"
        role="alert"
        aria-live="polite"
      >
        <div className="border-y border-destructive/30 py-10">
          <h2 className="text-xl font-semibold">暫時未能載入代理資料</h2>
          <p className="mt-3 text-sm text-muted-foreground">請稍後再試，或直接聯絡晉誠地產。</p>
          <Button asChild className="mt-5">
            <Link to="/contact">聯絡我們</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
