import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, Bed, Building2, MessageCircle, Phone, UserRound } from "lucide-react";

import { AppImage } from "@/components/media/AppImage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SITE_NAME, SITE_URL, canonicalLink } from "@/content/seo";
import { fetchNeonBranches, fetchNeonPublicAgentProfileBySlug } from "@/lib/neon/public-data";
import type { NeonBranchRecord, NeonPublicAgentProfile } from "@/lib/neon/public-data.types";
import { agentBranchName, agentContactNote, resolveAgentContact } from "@/lib/agent-directory";
import { toTelHref, toWhatsAppHref } from "@/lib/contact-links";
import { fetchListingsForAgent, type ListingRow } from "@/lib/queries";
import { agentPersonSchema, jsonLdScript } from "@/lib/schema";

export const Route = createFileRoute("/agents_/$slug")({
  loader: async ({ params }) => {
    const profile = await fetchNeonPublicAgentProfileBySlug({ data: { slug: params.slug } });
    if (!profile) throw notFound();
    const [listings, branches] = await Promise.all([
      fetchListingsForAgent(profile.id, 6).catch(() => []),
      // Non-essential: a Neon blip here shouldn't 404/error the whole
      // profile -- it degrades to the free-text `branch` fallback, exactly
      // like today, rather than failing the page.
      fetchNeonBranches().catch(() => [] as NeonBranchRecord[]),
    ]);
    return { profile: profile as NeonPublicAgentProfile, listings, branches };
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
      links: profile?.public_slug ? [canonicalLink(`/agents/${profile.public_slug}`)] : [],
    };
  },
  errorComponent: AgentProfileError,
  notFoundComponent: AgentNotFound,
  component: AgentProfilePage,
});

function AgentProfilePage() {
  const { profile, listings, branches } = Route.useLoaderData();
  const name = profile.name_zh || profile.name_en || "晉誠地產代理";
  // See agents.tsx: defaulting to the first configured branch printed 麗都分行 on
  // agents based elsewhere. A missing branch renders nothing rather than a wrong one.
  // agentBranchName prefers a branch_id match against `branches` over the
  // free-text `branch` string, and null if neither resolves.
  const branch = agentBranchName(profile, branches);
  const contact = resolveAgentContact(profile, branches);
  const note = agentContactNote(contact);
  const phoneHref = toTelHref(contact.phone);
  const whatsappHref = toWhatsAppHref(contact.whatsapp);
  const personSchema = agentPersonSchema({
    name,
    jobTitle: profile.job_title,
    telephone: contact.phone,
    image: profile.avatar_url,
    url: profile.public_slug ? `${SITE_URL}/agents/${profile.public_slug}` : SITE_URL,
  });

  return (
    <div className="bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript({ "@context": "https://schema.org", ...personSchema }),
        }}
      />
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
              <AppImage
                src={profile.avatar_url}
                alt={`${name} 個人相片`}
                width={128}
                height={128}
                className="h-full w-full object-cover"
                fallback={
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <UserRound className="h-10 w-10" aria-hidden="true" />
                  </div>
                }
              />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary">晉誠專業代理</p>
              <h1 className="mt-2 text-3xl font-bold">{name}</h1>
              {profile.name_zh && profile.name_en ? (
                <p className="mt-1 text-base text-muted-foreground">{profile.name_en}</p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                {profile.job_title ? <span>{profile.job_title}</span> : null}
                {branch ? <span>{branch}</span> : null}
                {profile.licence_no ? <span>牌照：{profile.licence_no}</span> : null}
                {profile.languages.length > 0 ? (
                  <span>語言：{profile.languages.join("、")}</span>
                ) : null}
              </div>
              {profile.bio ? (
                <p className="mt-5 max-w-2xl leading-7 text-muted-foreground">{profile.bio}</p>
              ) : null}
              {profile.specialties.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {profile.specialties.map((specialty) => (
                    <Badge key={specialty} variant="secondary">
                      {specialty}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {profile.served_estate_slugs.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2 text-sm">
                  <span className="text-muted-foreground">熟悉屋苑：</span>
                  {profile.served_estate_slugs.map((slug) => (
                    <Link
                      key={slug}
                      to="/estate/$slug"
                      params={{ slug }}
                      className="text-primary underline underline-offset-2"
                    >
                      {slug}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <aside className="border-t pt-6 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <h2 className="text-base font-semibold">直接聯絡</h2>
            {note ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{note}</p> : null}
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
                <Button asChild variant="brand" className="w-full justify-start">
                  <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="mr-2 h-4 w-4" />
                    WhatsApp 聯絡
                  </a>
                </Button>
              ) : null}
              {contact.whatsappIsFallback ? (
                <Button asChild className="w-full justify-start">
                  <Link to="/contact">一般查詢</Link>
                </Button>
              ) : null}
            </div>
          </aside>
        </section>

        {listings.length > 0 ? (
          <section className="py-8">
            <h2 className="text-2xl font-semibold">{name} 的放盤</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {listings.map((listing) => (
                <AgentListingCard key={listing.id} listing={listing} />
              ))}
            </div>
          </section>
        ) : null}

        <section className="py-8">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-5">
            <div>
              <h2 className="text-2xl font-semibold">需要搵樓或放盤？</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                由熟悉本區市場的代理協助你比較合適選擇。
              </p>
            </div>
            <Button asChild>
              {/* agent threads to /listings' Zod search schema, which passes
                  it as agentId into the ALREADY-WORKING p.agent_id filter
                  (listingWhere in public-data.server.ts) -- this used to
                  link to a bare, unscoped /listings despite the button's
                  own label promising this agent's listings specifically. */}
              <Link to="/listings" search={{ deal: "all", page: 1, agent: profile.id }}>
                <Building2 className="mr-2 h-4 w-4" />
                查看代理放盤
              </Link>
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

function AgentListingCard({ listing }: { listing: ListingRow }) {
  const img = listing.images?.[0] ?? "https://placehold.co/600x400/e5e7eb/64748b?text=No+Image";
  const isRent = listing.deal_type === "rent";
  const price = isRent
    ? listing.rent
      ? `$${Number(listing.rent).toLocaleString()} / 月`
      : "—"
    : listing.price
      ? `$${(Number(listing.price) / 1_000_000).toFixed(2)}M`
      : "—";

  return (
    <Link
      to="/property/$listingNo"
      params={{ listingNo: listing.listing_no }}
      className="group block overflow-hidden rounded-lg border transition-shadow hover:shadow-md"
    >
      <div className="aspect-[4/3] overflow-hidden bg-muted">
        <AppImage
          src={img}
          alt={listing.title_zh}
          width={400}
          height={300}
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
        />
      </div>
      <div className="p-3">
        <p className="line-clamp-1 text-sm font-medium">{listing.title_zh}</p>
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          {listing.bedrooms !== null ? (
            <>
              <Bed className="h-3 w-3" />
              {listing.bedrooms}
            </>
          ) : null}
          {listing.saleable_area ? ` · ${listing.saleable_area} 呎` : ""}
        </p>
        <p className="mt-1 font-semibold text-primary">{price}</p>
      </div>
    </Link>
  );
}

function AgentProfileError() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
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
    </div>
  );
}

function AgentNotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">找不到代理資料</h1>
      <p className="mt-3 text-sm text-muted-foreground">此代理資料可能尚未公開，或連結已更新。</p>
      <Button asChild className="mt-6">
        <Link to="/agents">返回代理團隊</Link>
      </Button>
    </div>
  );
}
