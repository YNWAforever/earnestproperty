import { useState } from "react";
import { ClipboardCheck, MessageCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { whatsappIntentUrl, type WhatsAppIntentContext } from "@/config/site";
import { createValuationLead } from "@/lib/neon/admin-data";
import { VALUATION_CONSENT_TEXT } from "@/lib/neon/valuation-leads.js";

const UTM_PARAM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

// Best-effort UTM capture from the current URL -- mirrors listings.tsx's own
// collectUtmParams for ListingAlertForm (this repo has no shared UTM utility,
// confirmed via repo-wide grep, so each form keeps this small self-contained
// copy rather than introducing cross-feature coupling for five lines of
// logic). Safe to call during SSR: `window` is guarded, and this only
// actually runs from a client event handler (the form's onSubmit) in
// practice.
function collectUtmParams(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const utm: Record<string, string> = {};
  for (const key of UTM_PARAM_KEYS) {
    const value = params.get(key);
    if (value) utm[key] = value.slice(0, 200);
  }
  return utm;
}

/**
 * The structured valuation-request form, offered ALONGSIDE the existing
 * WhatsApp deep-link beside it -- not replacing it. Same "offer a structured
 * path without removing the WhatsApp-first option" pattern already
 * established by /listings' zero-results notify-me form (ListingAlertForm in
 * listings.tsx). The consent checkbox starts unchecked (useState(false)) and
 * is never preselected by any prop or effect -- this is a repo-wide,
 * plan-mandated invariant, not a per-form style choice.
 */
function ValuationLeadForm({ estateId }: { estateId?: string }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!consent) {
      toast.error("請先剔選同意先可以提交");
      return;
    }
    setSubmitting(true);
    const result = await createValuationLead({
      data: {
        name,
        phone,
        propertyAddress,
        notes,
        estateId,
        consent,
        utm: collectUtmParams(),
      },
    }).catch((err) => ({
      error: err instanceof Error ? err.message : String(err),
    }));
    setSubmitting(false);
    if (result && "error" in result && result.error) {
      toast.error("提交失敗：" + result.error);
      return;
    }
    setSubmitted(true);
    toast.success("已收到你嘅估價查詢，我們會盡快聯絡你。");
  }

  if (submitted) {
    return (
      <div className="mt-5 rounded-lg border border-dashed bg-background p-5 text-center">
        <p className="text-sm font-medium text-primary">已收到查詢</p>
        <p className="mt-1 text-sm text-muted-foreground">
          我們會盡快按你提供嘅資料回覆估價，或者你亦可以直接 WhatsApp 我們。
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-5 space-y-3 rounded-lg border bg-background p-5">
      <p className="text-sm font-semibold text-primary">留低資料，等我們幫你估價</p>
      <div>
        <Label htmlFor="valuation-name">姓名 *</Label>
        <Input
          id="valuation-name"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="陳先生"
        />
      </div>
      <div>
        <Label htmlFor="valuation-phone">電話 *</Label>
        <Input
          id="valuation-phone"
          required
          type="tel"
          maxLength={30}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="9123 4567"
        />
      </div>
      <div>
        <Label htmlFor="valuation-address">物業地址 / 屋苑 *</Label>
        <Input
          id="valuation-address"
          required
          maxLength={300}
          value={propertyAddress}
          onChange={(e) => setPropertyAddress(e.target.value)}
          placeholder="例：深井 XX 花園 X座 X樓 X室"
        />
      </div>
      <div>
        <Label htmlFor="valuation-notes">實用面積 / 樓層 / 狀況（可選）</Label>
        <Textarea
          id="valuation-notes"
          maxLength={1000}
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="例：實用面積約 500 呎，中層，海景，已裝修"
        />
      </div>
      <div className="flex items-start gap-2">
        <Checkbox
          id="valuation-consent"
          checked={consent}
          onCheckedChange={(checked) => setConsent(checked === true)}
          className="mt-0.5"
        />
        <Label
          htmlFor="valuation-consent"
          className="text-xs font-normal leading-snug text-muted-foreground"
        >
          {VALUATION_CONSENT_TEXT}
        </Label>
      </div>
      <Button type="submit" className="w-full" disabled={submitting || !consent}>
        {submitting ? "提交中…" : "提交估價查詢"}
      </Button>
    </form>
  );
}

export function OwnerValuationPanel({
  context,
  id,
  estateId,
}: {
  context?: WhatsAppIntentContext;
  id?: string;
  estateId?: string;
}) {
  return (
    <section id={id} className="bg-card">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[1.2fr_0.8fr] lg:px-8">
        <div>
          <p className="text-sm font-semibold text-coral">業主放盤 / 免費估價</p>
          <h2 className="mt-2 text-2xl font-bold text-primary">索取深井業主估價報告</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            提供屋苑、實用面積、樓層景觀同放售或放租意向，晉誠地舖團隊會按近期放盤、成交和可睇盤情況回覆。
          </p>
          <ValuationLeadForm estateId={estateId} />
        </div>
        <div className="rounded-lg border bg-background p-5">
          <div className="flex items-start gap-3">
            <ClipboardCheck className="mt-1 h-5 w-5 text-primary" />
            <div>
              <p className="font-semibold text-primary">WhatsApp-first，不用填長表格</p>
              <p className="mt-1 text-sm text-muted-foreground">
                適合業主先快速了解估值、叫價策略和租售兩邊選擇。
              </p>
            </div>
          </div>
          <Button asChild variant="brand" className="mt-5 w-full">
            <a
              href={whatsappIntentUrl("valuation", {
                ...context,
                source: context?.source ?? "owner-valuation-panel",
              })}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle className="h-4 w-4" />
              我要放盤估價
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}
