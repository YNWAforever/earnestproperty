import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createWebsiteInquiry } from "@/lib/neon/admin-data";
import { buildContext, track } from "@/lib/analytics/events";
import {
  createSubmitGuard,
  ENQUIRY_TYPE_OPTIONS,
  PREFERRED_CONTACT_OPTIONS,
  submitContactInquiry,
} from "@/lib/contact-inquiry-form";
import { FormStatus, type FormStatusState } from "@/components/site/FormStatus";
import { HoneypotField } from "@/components/site/HoneypotField";

const CONTACT_FORM_STATUS_ID = "contact-form-status";

export function ContactInquiryForm() {
  const [submitting, setSubmitting] = useState(false);
  const [consentWhatsapp, setConsentWhatsapp] = useState(false);
  const [enquiryType, setEnquiryType] = useState("");
  const [preferredContact, setPreferredContact] = useState("");
  const [status, setStatus] = useState<FormStatusState>({ kind: "idle" });
  // A plain ref, not React state -- see contact-inquiry-form.ts's
  // createSubmitGuard doc comment for why. `submitting` state above only
  // drives the button's disabled/label UI; it does NOT gate re-entrancy,
  // because a fast double-click/double-Enter can fire a second handleSubmit
  // before the first setSubmitting(true) commits and re-renders. The guard
  // instance must be stable across renders (one guard per mounted form), so
  // it's created once and stashed in a ref; `submitGuard` itself is a plain
  // non-null local so handleSubmit's closure doesn't need an `undefined`
  // check on every `.current` access.
  const submitGuardRef = useRef<ReturnType<typeof createSubmitGuard> | null>(null);
  if (submitGuardRef.current === null) {
    submitGuardRef.current = createSubmitGuard();
  }
  const submitGuard = submitGuardRef.current;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Guard check FIRST, before any React state is touched -- if a
    // near-simultaneous second submit lands here while the first is still in
    // flight, it is dropped immediately with no state churn at all (no
    // flicker of the submit button's disabled/label state, no duplicate
    // result line).
    if (!submitGuard.tryStart()) {
      return;
    }

    const form = e.currentTarget;
    const fd = new FormData(form);
    const raw = {
      name: String(fd.get("name") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      email: String(fd.get("email") ?? ""),
      message: String(fd.get("message") ?? ""),
      enquiryType,
      preferredContact,
    };

    // Clear any previous result first so a stale error never sits next to a
    // fresh attempt.
    setStatus({ kind: "idle" });
    setSubmitting(true);
    try {
      const outcome = await submitContactInquiry({
        raw,
        consentWhatsapp,
        submitFn: (payload) => createWebsiteInquiry({ data: payload }),
        website: fd.get("website") ?? undefined,
      });

      switch (outcome.status) {
        case "validation-error":
        case "server-error":
          // Typed values are kept (no reset) so the visitor can fix and retry.
          setStatus({ kind: "error", message: outcome.message });
          return;
        case "success":
          setStatus({ kind: "success", message: "已收到查詢，我們會盡快聯絡你。" });
          track(
            { name: "contact_form_submit", payload: { hasPhone: raw.phone.trim().length > 0 } },
            buildContext(),
          );
          form.reset();
          setConsentWhatsapp(false);
          setEnquiryType("");
          setPreferredContact("");
          return;
      }
    } finally {
      submitGuard.finish();
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="relative mt-4 max-w-md space-y-3">
      <div>
        <Label htmlFor="contact-name">姓名 *</Label>
        <Input id="contact-name" name="name" required maxLength={120} placeholder="陳先生" />
      </div>
      <div>
        <Label htmlFor="contact-phone">電話 *</Label>
        <Input
          id="contact-phone"
          name="phone"
          required
          type="tel"
          maxLength={30}
          placeholder="9123 4567"
        />
      </div>
      <div>
        <Label htmlFor="contact-email">電郵</Label>
        <Input id="contact-email" name="email" type="email" maxLength={255} />
      </div>
      <div>
        <Label htmlFor="contact-enquiryType">查詢類型 *</Label>
        <Select value={enquiryType} onValueChange={setEnquiryType} name="enquiryType" required>
          <SelectTrigger id="contact-enquiryType">
            <SelectValue placeholder="請選擇查詢類型" />
          </SelectTrigger>
          <SelectContent>
            {ENQUIRY_TYPE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="contact-preferredContact">偏好聯絡方式 *</Label>
        <Select
          value={preferredContact}
          onValueChange={setPreferredContact}
          name="preferredContact"
          required
        >
          <SelectTrigger id="contact-preferredContact">
            <SelectValue placeholder="請選擇偏好聯絡方式" />
          </SelectTrigger>
          <SelectContent>
            {PREFERRED_CONTACT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="contact-message">訊息</Label>
        <Textarea
          id="contact-message"
          name="message"
          maxLength={1000}
          rows={3}
          placeholder="想查詢買樓／放盤／租務"
        />
      </div>
      {/*
        Direct-marketing consent -- structurally separate from the
        operational-reply disclaimer below (a real, unchecked-by-default
        opt-in control here vs. plain inline text after the submit
        button). Adding enquiryType/preferredContact above must not blur
        this distinction, so nothing marketing-related was added to
        either of those two fields.
      */}
      <div className="flex items-start gap-2">
        <Checkbox
          id="contact-consentWhatsapp"
          checked={consentWhatsapp}
          onCheckedChange={(checked) => setConsentWhatsapp(checked === true)}
          className="mt-0.5"
        />
        <Label
          htmlFor="contact-consentWhatsapp"
          className="text-xs font-normal leading-snug text-muted-foreground"
        >
          我同意透過 WhatsApp 接收樓盤資訊及推廣訊息。
        </Label>
      </div>
      {/* After the last visible field: a keyboard "next" between real fields never lands in it. */}
      <HoneypotField />
      <Button
        type="submit"
        className="w-full sm:w-auto"
        disabled={submitting}
        aria-describedby={status.kind === "idle" ? undefined : CONTACT_FORM_STATUS_ID}
      >
        {submitting ? "提交中…" : "提交查詢"}
      </Button>
      <FormStatus state={status} id={CONTACT_FORM_STATUS_ID} />
      <p className="text-xs text-muted-foreground">
        按提交即表示同意我們透過上述聯絡方式回覆查詢。
        如你已曾登記，提交查詢不會更改現有推廣訊息設定；職員會另行確認你的要求。
      </p>
    </form>
  );
}
