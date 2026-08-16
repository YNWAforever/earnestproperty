import { useMemo, useRef, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useRouteLeaveGuard } from "@/hooks/use-unsaved-changes-guard";
import { saveAdminAgentProfile } from "@/lib/neon/admin-data";
import type { AdminAgentProfileInput } from "@/lib/neon/admin-data.types";
import { agentProfileSchema, buildAgentProfilePayload } from "./agent-profile-form-utils";

type AgentProfile = Partial<AdminAgentProfileInput> & { id?: string };

function createInitialForm(profile?: AgentProfile) {
  return {
    auth_user_id: profile?.auth_user_id ?? "",
    email: profile?.email ?? "",
    name_zh: profile?.name_zh ?? "",
    name_en: profile?.name_en ?? "",
    job_title: profile?.job_title ?? "",
    phone: profile?.phone ?? "",
    whatsapp: profile?.whatsapp ?? "",
    licence_no: profile?.licence_no ?? "",
    avatar_url: profile?.avatar_url ?? "",
    branch: profile?.branch ?? "",
    bio: profile?.bio ?? "",
    specialties: (profile?.specialties ?? []).join("\n"),
    served_estate_slugs: (profile?.served_estate_slugs ?? []).join("\n"),
    public_slug: profile?.public_slug ?? "",
    show_on_website: profile?.show_on_website ?? false,
    display_order: profile?.display_order?.toString() ?? "",
    active: profile?.active ?? true,
  };
}

type FormState = ReturnType<typeof createInitialForm>;
export function AgentProfileForm({
  profile,
  canManageIdentity,
  onSaved,
}: {
  profile?: AgentProfile;
  canManageIdentity: boolean;
  onSaved: (id: string) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(() => createInitialForm(profile));
  const [saved, setSaved] = useState(false);

  // 17 fields including a long bio, and no guard at all: clicking 經紀管理 in the
  // always-visible sidebar, the 返回 button, or 登出 unmounted the form and lost
  // everything. Easy to miss because the 3 Aug audit certifies this file as the
  // codebase's reference implementation.
  const isDirty = useMemo(() => {
    if (saved) return false;
    const pristine = createInitialForm(profile);
    return (Object.keys(pristine) as Array<keyof typeof pristine>).some(
      (key) => form[key] !== pristine[key],
    );
  }, [form, profile, saved]);

  const { dialog: leaveGuardDialog } = useRouteLeaveGuard(isDirty);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function fieldProps(key: keyof FormState) {
    const error = fieldErrors[key];
    return {
      name: key,
      "aria-invalid": Boolean(error),
      "aria-describedby": error ? `${key}-error` : undefined,
    };
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = agentProfileSchema.safeParse(
      canManageIdentity ? form : { ...form, auth_user_id: "", email: "", active: true },
    );
    if (!parsed.success) {
      const nextErrors: Partial<Record<keyof FormState, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && key in form && !nextErrors[key as keyof FormState]) {
          nextErrors[key as keyof FormState] = issue.message;
        }
      }
      setFieldErrors(nextErrors);
      toast.error("請檢查輸入資料");

      const firstField = String(parsed.error.issues[0]?.path[0] ?? "");
      const firstControl = formRef.current?.elements.namedItem(firstField);
      if (firstControl instanceof HTMLElement) firstControl.focus();
      return;
    }

    setFieldErrors({});

    const payload = buildAgentProfilePayload({
      profileId: profile?.id,
      data: parsed.data,
      canManageIdentity,
    });

    setSubmitting(true);
    try {
      const result = await saveAdminAgentProfile({ data: payload });
      if (!result.id || result.error) throw new Error(result.error || "未能儲存代理資料");
      toast.success(profile?.id ? "代理資料已更新" : "代理資料已建立");
      // Before onSaved(): that navigates, and the guard would otherwise fire on
      // a clean save.
      setSaved(true);
      onSaved(result.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-7" noValidate>
      {leaveGuardDialog}
      <FormSection title="公開資料">
        <Field label="中文名稱" htmlFor="name_zh" error={fieldErrors.name_zh}>
          <Input
            id="name_zh"
            {...fieldProps("name_zh")}
            autoComplete="name"
            value={form.name_zh}
            onChange={(event) => set("name_zh", event.target.value)}
            maxLength={100}
          />
        </Field>
        <Field label="英文名稱" htmlFor="name_en" error={fieldErrors.name_en}>
          <Input
            id="name_en"
            {...fieldProps("name_en")}
            autoComplete="name"
            value={form.name_en}
            onChange={(event) => set("name_en", event.target.value)}
            maxLength={100}
          />
        </Field>
        <Field label="職銜" htmlFor="job_title" error={fieldErrors.job_title}>
          <Input
            id="job_title"
            {...fieldProps("job_title")}
            autoComplete="organization-title"
            value={form.job_title}
            onChange={(event) => set("job_title", event.target.value)}
            maxLength={100}
          />
        </Field>
        <Field label="分行 / 團隊" htmlFor="branch" error={fieldErrors.branch}>
          <Input
            id="branch"
            {...fieldProps("branch")}
            autoComplete="organization"
            value={form.branch}
            onChange={(event) => set("branch", event.target.value)}
            maxLength={120}
          />
        </Field>
        <Field label="牌照號碼" htmlFor="licence_no" error={fieldErrors.licence_no}>
          <Input
            id="licence_no"
            {...fieldProps("licence_no")}
            autoComplete="off"
            value={form.licence_no}
            onChange={(event) => set("licence_no", event.target.value)}
            maxLength={80}
          />
        </Field>
        <Field label="顯示排序" htmlFor="display_order" error={fieldErrors.display_order}>
          <Input
            id="display_order"
            {...fieldProps("display_order")}
            type="number"
            autoComplete="off"
            min="0"
            max="9999"
            value={form.display_order}
            onChange={(event) => set("display_order", event.target.value)}
            placeholder="留空自動排在最後"
          />
        </Field>
        <Field label="個人簡介" htmlFor="bio" error={fieldErrors.bio} full>
          <Textarea
            id="bio"
            {...fieldProps("bio")}
            autoComplete="off"
            rows={5}
            value={form.bio}
            onChange={(event) => set("bio", event.target.value)}
            maxLength={2000}
          />
        </Field>
        <Field label="專長（每行一項）" htmlFor="specialties" error={fieldErrors.specialties} full>
          <Textarea
            id="specialties"
            {...fieldProps("specialties")}
            autoComplete="off"
            rows={3}
            value={form.specialties}
            onChange={(event) => set("specialties", event.target.value)}
            maxLength={2000}
            placeholder={"上車盤\n海景大單位\n租務"}
          />
        </Field>
        <Field
          label="熟悉屋苑（每行一個 slug）"
          htmlFor="served_estate_slugs"
          error={fieldErrors.served_estate_slugs}
          full
        >
          <Textarea
            id="served_estate_slugs"
            {...fieldProps("served_estate_slugs")}
            autoComplete="off"
            rows={3}
            value={form.served_estate_slugs}
            onChange={(event) => set("served_estate_slugs", event.target.value)}
            maxLength={2000}
            placeholder={"bellagio\nrhine-garden"}
          />
        </Field>
        <Field label="相片網址" htmlFor="avatar_url" error={fieldErrors.avatar_url} full>
          <Input
            id="avatar_url"
            {...fieldProps("avatar_url")}
            type="url"
            autoComplete="url"
            value={form.avatar_url}
            onChange={(event) => set("avatar_url", event.target.value)}
            maxLength={500}
            placeholder="https://..."
          />
        </Field>
      </FormSection>

      <FormSection title="聯絡資料">
        <Field label="電話" htmlFor="phone" error={fieldErrors.phone}>
          <Input
            id="phone"
            {...fieldProps("phone")}
            type="tel"
            autoComplete="tel"
            value={form.phone}
            onChange={(event) => set("phone", event.target.value)}
            maxLength={40}
          />
        </Field>
        <Field label="WhatsApp" htmlFor="whatsapp" error={fieldErrors.whatsapp}>
          <Input
            id="whatsapp"
            {...fieldProps("whatsapp")}
            type="tel"
            autoComplete="tel"
            value={form.whatsapp}
            onChange={(event) => set("whatsapp", event.target.value)}
            maxLength={40}
          />
        </Field>
      </FormSection>

      {canManageIdentity ? (
        <FormSection title="帳戶及存取">
          <Field label="帳戶電郵" htmlFor="email" error={fieldErrors.email}>
            <Input
              id="email"
              {...fieldProps("email")}
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(event) => set("email", event.target.value)}
              maxLength={320}
            />
          </Field>
          <Field
            label="Neon Auth 使用者 ID"
            htmlFor="auth_user_id"
            error={fieldErrors.auth_user_id}
          >
            <Input
              id="auth_user_id"
              {...fieldProps("auth_user_id")}
              autoComplete="off"
              value={form.auth_user_id}
              onChange={(event) => set("auth_user_id", event.target.value)}
            />
          </Field>
          <ToggleField
            label="帳戶啟用"
            description="停用後不會出現在公開網站，亦不能使用後台帳戶。"
            checked={form.active}
            onCheckedChange={(value) => set("active", value)}
            inputProps={fieldProps("active")}
          />
        </FormSection>
      ) : null}

      <FormSection title="發布設定">
        <Field label="公開網址 slug" htmlFor="public_slug" error={fieldErrors.public_slug} full>
          <Input
            id="public_slug"
            {...fieldProps("public_slug")}
            autoComplete="off"
            value={form.public_slug}
            onChange={(event) => set("public_slug", event.target.value.toLowerCase())}
            maxLength={120}
            placeholder="chan-tai-man"
          />
        </Field>
        <ToggleField
          label="顯示於網站"
          description="只會在帳戶啟用時出現在公開代理目錄。"
          checked={form.show_on_website}
          onCheckedChange={(value) => set("show_on_website", value)}
          inputProps={fieldProps("show_on_website")}
        />
      </FormSection>

      <div className="flex justify-end border-t pt-4">
        <Button type="submit" disabled={submitting}>
          {submitting ? "儲存中..." : profile?.id ? "更新代理" : "建立代理"}
        </Button>
      </div>
    </form>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  children,
  error,
  full = false,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  error?: string;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <Label htmlFor={htmlFor} className="mb-1.5 block">
        {label}
      </Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1.5 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ToggleField({
  label,
  description,
  checked,
  onCheckedChange,
  inputProps,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  inputProps: {
    name: keyof FormState;
    "aria-invalid": boolean;
    "aria-describedby": string | undefined;
  };
}) {
  const id = label === "顯示於網站" ? "show_on_website" : "active";
  return (
    <div className="flex min-h-12 items-start justify-between gap-4 border-y py-3 sm:col-span-2">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} {...inputProps} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
