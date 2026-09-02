import { createFileRoute, Link } from "@tanstack/react-router";
import { BadgeCheck, MapPin, MessageCircle, Store, UserRound, Milestone } from "lucide-react";

import { Container } from "@/components/layout/Container";
import { AppImage } from "@/components/media/AppImage";
import { PageHero } from "@/components/site/PageHero";
import { canonicalLink, pageSeo } from "@/content/seo";
import { SITE_BRANCHES } from "@/config/site";
import { fetchNeonBranches, fetchNeonPublicAgentProfiles } from "@/lib/neon/public-data";
import type { NeonBranchRecord, NeonPublicAgentProfile } from "@/lib/neon/public-data.types";
import { agentBranchName } from "@/lib/agent-directory";

const SERVICES = [
  "買賣放盤",
  "租務配對",
  "業主估價",
  "深井屋苑比較",
  "汀九低密度住宅",
  "青山公路海景盤",
];

type MilestoneCounts = { agentCount: number; branchCount: number };

// Qualitative milestones only -- no exact founding year is confirmed by the
// client, so this leans on facts already established elsewhere in the app
// (廿多年 on the homepage, the branches in site-branches.js, the public agent
// roster behind /agents) rather than inventing a date. The headcounts used to
// be hardcoded ("23 位持牌代理、3 間分店") and went stale the moment the roster
// changed, so the third milestone now derives them from the same loader data
// the team preview below renders.
const MILESTONES: Array<{
  title: string;
  desc: string | ((counts: MilestoneCounts) => string);
}> = [
  { title: "起步", desc: "由深井麗都花園舖面起家，服務街坊買賣及租務" },
  { title: "擴展", desc: "增設海韻花園、青山公路豪景分行，覆蓋深井至汀九" },
  {
    title: "現在",
    desc: ({ agentCount, branchCount }) =>
      `廿多年深耕，${agentCount > 0 ? `${agentCount} 位持牌代理、` : ""}${branchCount} 間分店全職服務`,
  },
];

export const Route = createFileRoute("/about")({
  loader: async () => ({
    // Non-essential preview section -- a Neon blip shouldn't fail the whole
    // page, so this degrades to an empty team section rather than erroring.
    team: await fetchNeonPublicAgentProfiles().catch(() => [] as NeonPublicAgentProfile[]),
    // Same non-essential treatment: a failed branches fetch just falls back
    // to each agent's free-text `branch` (see agentBranchName below), not an
    // error.
    branches: await fetchNeonBranches().catch(() => [] as NeonBranchRecord[]),
  }),
  head: () => ({
    meta: [
      { title: pageSeo.about.title },
      { name: "description", content: pageSeo.about.description },
    ],
    links: [canonicalLink(pageSeo.about.path)],
  }),
  component: AboutPage,
});

function AboutPage() {
  const { team, branches } = Route.useLoaderData();
  const teamPreview = team.filter((agent) => agent.avatar_url).slice(0, 8);
  const milestoneCounts: MilestoneCounts = {
    agentCount: team.length,
    branchCount: SITE_BRANCHES.length,
  };

  return (
    <div className="bg-background">
      <PageHero
        eyebrow="關於晉誠地產"
        title="深井、青山公路物業專家，全部真盤、即時回覆、持牌可靠"
        lead="晉誠地產 Earnest Property（牌照號 C-018613）紮根深井，專營碧堤半島、浪翠園、豪景花園、海韻花園、麗都花園，以及汀九和青山公路沿線住宅。"
      />

      <Container className="py-12">
        <section>
          <div className="flex items-center gap-3">
            <Milestone className="h-6 w-6 text-primary" />
            <h2 className="text-xl font-semibold">我哋嘅歷程</h2>
          </div>
          <ol className="mt-5 grid gap-4 sm:grid-cols-3">
            {MILESTONES.map((milestone, index) => (
              <li key={milestone.title} className="rounded-lg border bg-card p-5">
                <span className="text-xs font-semibold text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-1 text-base font-semibold text-primary">{milestone.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {typeof milestone.desc === "function"
                    ? milestone.desc(milestoneCounts)
                    : milestone.desc}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-10 grid gap-6 md:grid-cols-2">
          <article className="rounded-lg border bg-card p-6">
            <BadgeCheck className="h-8 w-8 text-primary" />
            <h2 className="mt-4 text-xl font-semibold">我哋係邊個</h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              我哋係一間以深井、青山公路為核心的本地地產代理，日常接觸同管理區內真實買賣、租務和業主委託。
              對每個屋苑座向、樓層景觀、車位、會所和近期叫價都有第一手理解。
            </p>
          </article>

          <article className="rounded-lg border bg-card p-6">
            <MessageCircle className="h-8 w-8 text-primary" />
            <h2 className="mt-4 text-xl font-semibold">我哋點解唔同</h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              晉誠地產重視全部真盤和即時回覆。買家可以直接問到單位狀態，業主可以得到貼近市場的放盤策略，租客亦可以快速預約合適睇樓時段。
            </p>
          </article>
        </section>

        <section className="mt-10">
          <div className="rounded-lg border bg-card p-6">
            <MapPin className="h-8 w-8 text-primary" />
            <h2 className="mt-4 text-xl font-semibold">服務範圍</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {SERVICES.map((service) => (
                <span key={service} className="rounded-full bg-muted px-3 py-1 text-sm">
                  {service}
                </span>
              ))}
            </div>
          </div>
        </section>

        {teamPreview.length > 0 ? (
          <section className="mt-10">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-semibold">我哋嘅團隊</h2>
              <Link to="/agents" className="text-sm font-medium text-primary hover:underline">
                查看全部代理 →
              </Link>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {teamPreview.map((agent) => {
                const name = agent.name_zh || agent.name_en || "晉誠地產代理";
                // agentBranchName prefers a branch_id match against `branches`
                // (the real, admin-editable table) over the free-text `branch`
                // string, and null if neither resolves -- never a guessed
                // default (see agents.tsx for the documented history of that bug).
                const branchName = agentBranchName(agent, branches);
                const card = (
                  <>
                    <div className="aspect-square overflow-hidden rounded-md bg-muted">
                      <AppImage
                        src={agent.avatar_url}
                        alt={`${name} 個人相片`}
                        width={200}
                        height={200}
                        className="h-full w-full object-cover"
                        fallback={
                          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                            <UserRound className="h-8 w-8" aria-hidden="true" />
                          </div>
                        }
                      />
                    </div>
                    <p className="mt-2 text-sm font-medium">{name}</p>
                    {branchName ? (
                      <p className="text-xs text-muted-foreground">{branchName}</p>
                    ) : null}
                  </>
                );
                return agent.public_slug ? (
                  <Link key={agent.id} to="/agents/$slug" params={{ slug: agent.public_slug }}>
                    {card}
                  </Link>
                ) : (
                  <div key={agent.id}>{card}</div>
                );
              })}
            </div>
          </section>
        ) : null}
      </Container>

      <section className="border-t bg-muted/30">
        <Container className="py-12">
          <Store className="h-8 w-8 text-primary" />
          <h2 className="mt-4 text-xl font-semibold">門市</h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
            深井、青山公路三間地舖門市，歡迎業主、買家及租客預約到店傾盤。想先了解最新放盤，可直接
            WhatsApp 聯絡。
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {SITE_BRANCHES.map((branch) => (
              <div
                key={branch.id}
                className="overflow-hidden rounded-lg border border-border bg-card"
              >
                <AppImage
                  src={branch.photo}
                  alt={`${branch.name}舖面`}
                  // photoWidth/photoHeight are optional in SiteBranch (a branch may
                  // ship without a photo at all) -- AppImage's width/height are
                  // required intrinsic-size hints, not the rendered box (that's
                  // fixed by className below), so these fallbacks are never seen,
                  // only used to satisfy the type when src is also absent.
                  width={branch.photoWidth ?? 1600}
                  height={branch.photoHeight ?? 1200}
                  className="h-40 w-full object-cover"
                />
                <p className="p-3 text-sm font-medium">{branch.name}</p>
              </div>
            ))}
          </div>
          <Link
            to="/contact"
            className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground"
          >
            聯絡晉誠地產
          </Link>
        </Container>
      </section>
    </div>
  );
}
