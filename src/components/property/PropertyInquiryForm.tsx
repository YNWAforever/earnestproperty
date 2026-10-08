import { useState } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { createWebsiteInquiry } from "@/lib/neon/admin-data";
import { buildPropertyInquiryPayload } from "@/components/property/property-decision.js";
import { submitPublicForm } from "@/lib/public-form-submit";
import { FormStatus, type FormStatusState } from "@/components/site/FormStatus";
import { HoneypotField } from "@/components/site/HoneypotField";

const inquirySchema = z.object({
  name: z.string().trim().min(1, "請輸入姓名").max(120, "姓名過長"),
  phone: z
    .string()
    .trim()
    .min(8, "請輸入有效電話")
    .max(30, "電話過長")
    .regex(/^[\d+\-\s()]+$/, "電話格式不正確"),
  email: z.string().trim().max(255).email("電郵格式不正確").optional().or(z.literal("")),
  message: z.string().trim().max(1000, "訊息過長").optional(),
});

const PROPERTY_FORM_STATUS_ID = "property-form-status";

/**
 * The listing-detail enquiry form. `propertyId` is the row id the enquiry is attached to;
 * `listingNo` (the public listing number) is only used for the message placeholder, so it is
 * optional. The `id="name"` input is load-bearing: the route's `focusInquiry()` scrolls to and
 * focuses it from the mobile contact bar.
 */
export function PropertyInquiryForm({
  propertyId,
  listingNo,
}: {
  propertyId: string;
  listingNo?: string;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [consentWhatsapp, setConsentWhatsapp] = useState(false);
  const [status, setStatus] = useState<FormStatusState>({ kind: "idle" });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const raw = {
      name: String(fd.get("name") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      email: String(fd.get("email") ?? ""),
      message: String(fd.get("message") ?? ""),
    };
    const website = fd.get("website") ?? undefined;
    // Clear any previous result first so a stale error never sits next to a
    // fresh attempt.
    setStatus({ kind: "idle" });
    const parsed = inquirySchema.safeParse(raw);
    if (!parsed.success) {
      setStatus({ kind: "error", message: parsed.error.issues[0]?.message ?? "請檢查輸入" });
      return;
    }
    setSubmitting(true);
    const outcome = await submitPublicForm(() =>
      createWebsiteInquiry({
        data: {
          ...buildPropertyInquiryPayload({
            form: {
              name: parsed.data.name,
              phone: parsed.data.phone,
              email: parsed.data.email || "",
              message: parsed.data.message || "",
            },
            propertyId,
            consentWhatsapp,
          }),
          website,
        },
      }),
    );
    setSubmitting(false);
    if (outcome.status === "error") {
      // Typed values are kept (no reset) so the visitor can retry.
      setStatus({ kind: "error", message: outcome.message });
      return;
    }
    setStatus({ kind: "success", message: "已收到查詢，經紀會盡快與你聯絡。" });
    form.reset();
    setConsentWhatsapp(false);
  }

  return (
    <form onSubmit={handleSubmit} className="relative space-y-3">
      <div>
        <Label htmlFor="name">姓名 *</Label>
        <Input id="name" name="name" required maxLength={120} placeholder="陳先生" />
      </div>
      <div>
        <Label htmlFor="phone">電話 *</Label>
        <Input id="phone" name="phone" required type="tel" maxLength={30} placeholder="9123 4567" />
      </div>
      <div>
        <Label htmlFor="email">電郵</Label>
        <Input id="email" name="email" type="email" maxLength={255} />
      </div>
      <div>
        <Label htmlFor="message">訊息</Label>
        <Textarea
          id="message"
          name="message"
          maxLength={1000}
          rows={3}
          placeholder={listingNo ? `想查詢編號 ${listingNo}` : "想查詢此樓盤"}
        />
      </div>
      <div className="flex items-start gap-2">
        <Checkbox
          id="consentWhatsapp"
          checked={consentWhatsapp}
          onCheckedChange={(checked) => setConsentWhatsapp(checked === true)}
          className="mt-0.5"
        />
        <Label
          htmlFor="consentWhatsapp"
          className="text-xs font-normal leading-snug text-muted-foreground"
        >
          我同意透過 WhatsApp 接收樓盤資訊及推廣訊息。
        </Label>
      </div>
      {/* After the last visible field: a keyboard "next" between real fields never lands in it. */}
      <HoneypotField />
      <Button
        type="submit"
        className="w-full"
        disabled={submitting}
        aria-describedby={status.kind === "idle" ? undefined : PROPERTY_FORM_STATUS_ID}
      >
        {submitting ? "提交中…" : "提交查詢"}
      </Button>
      <FormStatus state={status} id={PROPERTY_FORM_STATUS_ID} />
      <p className="text-xs text-muted-foreground">
        按提交即表示同意我們透過上述聯絡方式回覆查詢。
      </p>
    </form>
  );
}
