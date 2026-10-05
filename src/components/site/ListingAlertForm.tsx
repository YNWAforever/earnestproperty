import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createListingAlert } from "@/lib/neon/admin-data";
import { LISTING_ALERT_CONSENT_TEXT } from "@/lib/neon/listing-alerts.js";
import { buildContext, track } from "@/lib/analytics/events";
import { submitPublicForm } from "@/lib/public-form-submit";
import { FormStatus, type FormStatusState } from "@/components/site/FormStatus";

const UTM_PARAM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

const ALERT_FORM_STATUS_ID = "alert-form-status";

// Best-effort UTM capture from the current URL. `src/lib/analytics/events.ts`
// exports a `collectUtmParams` too, but with different rules (it keeps only
// approved campaign tokens), which is why this local copy is kept: it reads
// the five standard utm_* parameters directly. Safe to call during SSR:
// `window` is guarded, and this only ever actually runs from a client event
// handler (the form's onSubmit) in practice.
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
 * /listings' zero-results "notify me" offer -- a genuinely new, server-
 * recorded lead path (listing_alerts), distinct from SearchFallbackCTA's
 * WhatsApp hand-off above it, which records nothing if the visitor never
 * sends that message. Submits the CURRENT validated search params as the
 * alert's filter JSON, same shape SavedSearchesPanel's saveSearch() already
 * uses (`{ ...search }`).
 *
 * The consent checkbox starts unchecked (useState(false)) and is never
 * preselected by any prop or effect -- this is a repo-wide, plan-mandated
 * invariant, not a per-form style choice.
 */
export function ListingAlertForm({
  search,
}: {
  search: Record<string, unknown> & { deal?: string; district?: string };
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [status, setStatus] = useState<FormStatusState>({ kind: "idle" });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Clear any previous result first so a stale error never sits next to a
    // fresh attempt.
    setStatus({ kind: "idle" });
    if (!consent) {
      setStatus({ kind: "error", message: "請先剔選同意通知先可以提交" });
      return;
    }
    setSubmitting(true);
    const outcome = await submitPublicForm(() =>
      createListingAlert({
        data: {
          name,
          phone,
          email,
          filters: { ...search },
          consent,
          utm: collectUtmParams(),
        },
      }),
    );
    setSubmitting(false);
    if (outcome.status === "error") {
      setStatus({ kind: "error", message: outcome.message });
      return;
    }
    setSubmitted(true);
    // `search.deal` is typed `string` on this component's props; the analytics payload only
    // accepts the three values the /listings search schema can produce.
    const dealType = search.deal === "sale" || search.deal === "rent" ? search.deal : "all";
    track(
      {
        name: "zero_results_notify",
        payload: {
          dealType,
          districtSlug: search.district,
          source: "listings-zero-results",
        },
      },
      buildContext({ districtSlug: search.district }),
    );
  }

  if (submitted) {
    return (
      <div className="rounded-lg border border-dashed bg-card p-6 text-center">
        <p className="text-sm font-medium text-primary">已設定通知</p>
        <p className="mt-1 text-sm text-muted-foreground">
          有符合呢個搜尋條件嘅新放盤，我們會盡快聯絡你。
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border bg-card p-6">
      <h2 className="text-base font-semibold text-primary">未有符合嘅放盤？等新盤通知你</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        留低聯絡方法，有符合呢個搜尋條件嘅新放盤，我們會盡快通知你。
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="alert-name">姓名 *</Label>
          <Input
            id="alert-name"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="陳先生"
          />
        </div>
        <div>
          <Label htmlFor="alert-phone">電話 *</Label>
          <Input
            id="alert-phone"
            required
            type="tel"
            maxLength={30}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="9123 4567"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="alert-email">電郵</Label>
          <Input
            id="alert-email"
            type="email"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-3 flex items-start gap-2">
        <Checkbox
          id="alert-consent"
          checked={consent}
          onCheckedChange={(checked) => setConsent(checked === true)}
          className="mt-0.5"
        />
        <Label
          htmlFor="alert-consent"
          className="text-xs font-normal leading-snug text-muted-foreground"
        >
          {LISTING_ALERT_CONSENT_TEXT}
        </Label>
      </div>
      <Button
        type="submit"
        className="mt-4 w-full sm:w-auto"
        disabled={submitting || !consent}
        aria-describedby={status.kind === "idle" ? undefined : ALERT_FORM_STATUS_ID}
      >
        {submitting ? "提交中…" : "設定通知"}
      </Button>
      <div className="mt-3 empty:hidden">
        <FormStatus state={status} id={ALERT_FORM_STATUS_ID} />
      </div>
    </form>
  );
}
