import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, Building2, MessageCircle, Phone, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SITE_BRANCHES, SITE_CONTACT } from "@/config/site";
import { SITE_NAME } from "@/content/seo";
import { fetchNeonPublicAgentProfileBySlug } from "@/lib/neon/public-data";
import type { NeonPublicAgentProfile } from "@/lib/neon/public-data.types";

const DEFAULT_AGENT_BRANCH = SITE_BRANCHES[0];

export const Route = createFileRoute("/agents_/$slug")({
  loader: async ({ params }) => {
    const profile = await fetchNeonPublicAgentProfileBySlug({ data: { slug: params.slug } });
    if (!profile) throw notFound();
    return { profile: profile as NeonPublicAgentProfile };
  },
  head: ({ loaderData }) => {
    const profile = loaderData?.profile;
    const name = profile?.name_zh || profile?.name_en || "專業代理";
    return {
      meta: [
        { title: `${name}｜${SITE_NAME}` },
        {
          name: "description",
          content: `${name} ${profile?.job_title ?? "晉誠地產專業代理"}，直接聯絡了解放盤、買樓及租樓服務。`,
        },
      ],
    };
  },
  errorComponent: AgentProfileError,
  notFoundComponent: AgentNotFound,
  component: AgentProfilePage,
});

function AgentProfilePage() {
  const { profile } = Route.useLoaderData();
  const name = profile.name_zh || profile.name_en || "晉誠地產代理";
  const branch = profile.branch ?? DEFAULT_AGENT_BRANCH.name;
  const phone = profile.phone ?? (SITE_CONTACT.phoneTel || DEFAULT_AGENT_BRANCH.phone);
  const whatsapp = profile.whatsapp ?? profile.phone ?? SITE_CONTACT.whatsappPhone;
  const phoneHref = toTelHref(phone);
  const whatsappHref = toWhatsAppHref(whatsapp);
  const usesGeneralContact = !profile.phone && !profile.whatsapp;

  return (
    <main className="bg-background">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <Link
          to="/agents"
          className="inline-flex items-center gap-2 text-sm font-semibold text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          返回代理團隊
        </Link>

        <section className="mt-7 grid gap-8 border-y py-8 md:grid-cols-[minmax(0,1fr)_240px]">
          <div className="flex min-w-0 flex-col gap-6 sm:flex-row">
            <div className="h-32 w-32 shrink-0 overflow-hidden rounded-lg bg-muted">
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={`${name} 個人相片`}
                  loading="lazy"
                  width={128}
                  height={128}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                  <UserRound className="h-10 w-10" aria-hidden="true" />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary">晉誠專業代理</p>
              <h1 className="mt-2 text-3xl font-bold">{name}</h1>
              {profile.name_zh && profile.name_en ? (
                <p className="mt-1 text-base text-muted-foreground">{profile.name_en}</p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                {profile.job_title ? <span>{profile.job_title}</span> : null}
                <span>{branch}</span>
                {profile.licence_no ? <span>牌照：{profile.licence_no}</span> : null}
              </div>
              {profile.bio ? (
                <p className="mt-5 max-w-2xl leading-7 text-muted-foreground">{profile.bio}</p>
              ) : null}
            </div>
          </div>

          <aside className="border-t pt-6 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <h2 className="text-base font-semibold">直接聯絡</h2>
            {usesGeneralContact ? (
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                代理未有提供直接聯絡方式，查詢將由{DEFAULT_AGENT_BRANCH.name}跟進。
              </p>
            ) : null}
            <div className="mt-4 grid gap-2">
              {phoneHref ? (
                <Button asChild variant="outline" className="w-full justify-start">
                  <a href={phoneHref}>
                    <Phone className="mr-2 h-4 w-4" />
                    電話聯絡
                  </a>
                </Button>
              ) : null}
              {whatsappHref ? (
                <Button asChild className="w-full justify-start">
                  <a href={whatsappHref} target="_blank" rel="noreferrer">
                    <MessageCircle className="mr-2 h-4 w-4" />
                    WhatsApp 聯絡
                  </a>
                </Button>
              ) : null}
              {usesGeneralContact ? (
                <Button asChild className="w-full justify-start">
                  <Link to="/contact">一般查詢</Link>
                </Button>
              ) : null}
            </div>
          </aside>
        </section>

        <section className="py-8">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-5">
            <div>
              <h2 className="text-2xl font-semibold">需要搵樓或放盤？</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                由熟悉本區市場的代理協助你比較合適選擇。
              </p>
            </div>
            <Button asChild>
              <Link to="/listings">
                <Building2 className="mr-2 h-4 w-4" />
                查看代理放盤
              </Link>
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}

function AgentProfileError() {
  return (
    <main className="mx-auto max-w-md px-4 py-24 text-center">
      <div role="alert" aria-live="polite">
        <h1 className="text-2xl font-semibold">暫時未能載入代理資料</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          請稍後再試，或直接聯絡晉誠地產安排同事跟進。
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to="/contact">聯絡晉誠地產</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/agents">返回代理團隊</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}

function AgentNotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">找不到代理資料</h1>
      <p className="mt-3 text-sm text-muted-foreground">此代理資料可能尚未公開，或連結已更新。</p>
      <Button asChild className="mt-6">
        <Link to="/agents">返回代理團隊</Link>
      </Button>
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
