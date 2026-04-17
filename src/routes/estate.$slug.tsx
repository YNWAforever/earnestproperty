import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { MessageCircle } from "lucide-react";
import { fetchEstateBySlug, fetchFaqs } from "@/lib/queries";

export const Route = createFileRoute("/estate/$slug")({
  loader: async ({ params }) => {
    const estate = await fetchEstateBySlug(params.slug);
    if (!estate) throw notFound();
    const faqs = await fetchFaqs(`estate:${params.slug}`);
    return { estate, faqs };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.estate.name_zh ?? "屋苑"}｜晉誠地產屋苑專頁` },
      {
        name: "description",
        content: `${loaderData?.estate.name_zh ?? ""} ${loaderData?.estate.total_units ?? ""} 個單位，平均實呎 $${loaderData?.estate.avg_saleable_psf ?? ""}。即時放盤、成交、FAQ。`,
      },
    ],
  }),
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="text-2xl font-bold">載入失敗</h1>
      <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
      <Link to="/" className="mt-4 inline-block text-primary underline">回首頁</Link>
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="text-2xl font-bold">屋苑未找到</h1>
      <Link to="/" className="mt-4 inline-block text-primary underline">回首頁</Link>
    </div>
  ),
  component: EstatePage,
});

function EstatePage() {
  const { estate, faqs } = Route.useLoaderData();
  return (
    <div className="bg-background">
      <section className="bg-gradient-to-br from-primary to-primary/70 py-16 text-primary-foreground">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <p className="text-sm opacity-80">深井屋苑</p>
          <h1 className="mt-2 text-4xl font-bold sm:text-5xl">{estate.name_zh}</h1>
          <p className="mt-3 text-base opacity-85">
            {estate.developer ?? ""} · {estate.year_completed ?? ""} 年落成 · 共{" "}
            {(estate.total_units ?? 0).toLocaleString()} 個單位
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
        <Stat label="平均實呎" value={`$${Number(estate.avg_saleable_psf ?? 0).toLocaleString()}`} />
        <Stat label="單位總數" value={(estate.total_units ?? 0).toLocaleString()} />
        <Stat label="期數" value={`${estate.phases ?? "-"} 期`} />
        <Stat label="落成年份" value={String(estate.year_completed ?? "-")} />
      </section>

      {estate.description && (
        <section className="mx-auto max-w-7xl px-4 pb-8 sm:px-6 lg:px-8">
          <p className="text-base leading-relaxed text-muted-foreground">{estate.description}</p>
        </section>
      )}

      {faqs.length > 0 && (
        <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-primary">常見問題</h2>
          <Accordion type="single" collapsible className="mt-6">
            {faqs.map((f: FaqItem, i: number) => (
              <AccordionItem key={i} value={`faq-${i}`}>
                <AccordionTrigger className="text-left text-base font-medium">
                  {f.question}
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                  {f.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      )}

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <p className="text-muted-foreground">完整放盤、近期成交、平面圖即將推出。</p>
        <a
          href={`https://wa.me/852XXXXXXXX?text=你好，我想查詢${estate.name_zh}物業`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-block"
        >
          <Button className="bg-coral text-coral-foreground hover:bg-coral/90">
            <MessageCircle className="h-4 w-4" />
            WhatsApp 查詢 {estate.name_zh}
          </Button>
        </a>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold text-primary">{value}</p>
    </div>
  );
}
