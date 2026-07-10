import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, MessageCircle, Phone, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SITE_BRANCHES, SITE_CONTACT } from "@/config/site";
import { fetchNeonPublicAgentProfiles } from "@/lib/neon/public-data";
import type { NeonPublicAgentProfile } from "@/lib/neon/public-data.types";

const DEFAULT_AGENT_BRANCH = SITE_BRANCHES[0];

export const Route = createFileRoute("/agents")({
  loader: async () => (await fetchNeonPublicAgentProfiles()) as NeonPublicAgentProfile[],
  head: () => ({
    meta: [
      { title: "專業代理｜晉誠地產" },
      {
        name: "description",
        content: "認識晉誠地產專業代理團隊，直接聯絡合適代理了解深井、青山公路及荃灣西放盤。",
      },
    ],
  }),
  pendingComponent: AgentDirectoryPending,
  errorComponent: AgentDirectoryError,
  component: AgentsPage,
});

function AgentsPage() {
  const profiles = Route.useLoaderData();

  return (
    <main className="bg-background">
      <AgentDirectoryHeader />
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        {profiles.length === 0 ? <DirectoryEmptyState /> : null}
        {profiles.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {profiles.map((profile) => (
              <AgentDirectoryCard key={profile.id} profile={profile} />
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function AgentDirectoryHeader() {
  return (
    <section className="border-b bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <p className="text-sm font-semibold text-primary">晉誠專業代理</p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">搵到合適代理，置業更清晰</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
          團隊熟悉深井、青山公路及荃灣西市場，為買家、租客及業主提供直接、可靠的地產服務。
        </p>
      </div>
    </section>
  );
}

function AgentDirectoryCard({ profile }: { profile: NeonPublicAgentProfile }) {
  const name = profile.name_zh || profile.name_en || "晉誠地產代理";
  const branch = profile.branch ?? DEFAULT_AGENT_BRANCH.name;
  const phone = profile.phone ?? (SITE_CONTACT.phoneTel || DEFAULT_AGENT_BRANCH.phone);
  const whatsapp = profile.whatsapp ?? profile.phone ?? SITE_CONTACT.whatsappPhone;
  const phoneHref = toTelHref(phone);
  const whatsappHref = toWhatsAppHref(whatsapp);
  const usesGeneralContact = !profile.phone && !profile.whatsapp;

  return (
    <article className="grid gap-5 rounded-lg border bg-card p-5 sm:grid-cols-[104px_1fr]">
      <div className="aspect-square overflow-hidden rounded-md bg-muted">
        {profile.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt={`${name} 個人相片`}
            loading="lazy"
            width={104}
            height={104}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <UserRound className="h-9 w-9" aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">{name}</h2>
            {profile.name_zh && profile.name_en ? (
              <p className="mt-1 text-sm text-muted-foreground">{profile.name_en}</p>
            ) : null}
          </div>
          <span className="text-sm text-muted-foreground">{branch}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {profile.job_title ? <span>{profile.job_title}</span> : null}
          {profile.licence_no ? <span>牌照：{profile.licence_no}</span> : null}
        </div>
        {usesGeneralContact ? (
          <p className="mt-3 text-xs text-muted-foreground">
            代理未有提供直接聯絡方式，電話查詢將由{DEFAULT_AGENT_BRANCH.name}跟進。
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          {profile.public_slug ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/agents/$slug" params={{ slug: profile.public_slug }}>
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
            <Button asChild size="sm">
              <a href={whatsappHref} target="_blank" rel="noreferrer">
                <MessageCircle className="mr-2 h-4 w-4" />
                WhatsApp
              </a>
            </Button>
          ) : null}
          {usesGeneralContact ? (
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

function toTelHref(phone: string | null) {
  const normalized = phone?.replace(/[^+\d]/g, "") ?? "";
  return normalized ? `tel:${normalized}` : null;
}

function toWhatsAppHref(phone: string | null) {
  const normalized = phone?.replace(/\D/g, "") ?? "";
  return normalized ? `https://wa.me/${normalized}` : null;
}
