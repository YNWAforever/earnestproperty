import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Mail, MessageCircle, Phone, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRoles } from "@/hooks/use-roles";
import type { Database, Tables } from "@/integrations/supabase/types";

type InquiryStatus = Database["public"]["Enums"]["inquiry_status"];
type Inquiry = Tables<"inquiries"> & {
  properties: { listing_no: string; title_zh: string } | null;
  assignee: { name_zh: string | null; name_en: string | null } | null;
};

const STATUS_FLOW: InquiryStatus[] = [
  "new",
  "contacted",
  "viewing",
  "negotiating",
  "closed_won",
  "closed_lost",
];

const STATUS_LABEL: Record<InquiryStatus, string> = {
  new: "新查詢",
  contacted: "已聯絡",
  viewing: "預約睇樓",
  negotiating: "議價中",
  closed_won: "成交",
  closed_lost: "已流失",
};

const STATUS_VARIANT: Record<
  InquiryStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  new: "default",
  contacted: "secondary",
  viewing: "secondary",
  negotiating: "secondary",
  closed_won: "default",
  closed_lost: "destructive",
};

const SOURCE_LABEL: Record<string, string> = {
  website: "網站",
  whatsapp: "WhatsApp",
  facebook: "Facebook",
  instagram: "Instagram",
};

export const Route = createFileRoute("/dashboard/inquiries")({
  head: () => ({
    meta: [
      { title: "查詢管理｜經紀工作台" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InquiriesInbox,
});

function InquiriesInbox() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: roleLoading } = useRoles(user?.id);
  const navigate = useNavigate();

  const [rows, setRows] = useState<Inquiry[] | null>(null);
  const [filter, setFilter] = useState<InquiryStatus | "all">("all");
  const [refreshing, setRefreshing] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/auth/login" });
  }, [authLoading, user, navigate]);

  async function load() {
    if (!user || !isAdmin) return;
    setRefreshing(true);
    const { data, error } = await supabase
      .from("inquiries")
      .select(
        `*,
         properties:property_id ( listing_no, title_zh ),
         assignee:assigned_agent_id ( name_zh, name_en )`
      )
      .order("created_at", { ascending: false });
    setRefreshing(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((data ?? []) as unknown as Inquiry[]);
  }

  useEffect(() => {
    if (!roleLoading && isAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleLoading, isAdmin]);

  async function updateStatus(id: string, status: InquiryStatus) {
    setUpdatingId(id);
    const { error } = await supabase
      .from("inquiries")
      .update({ status })
      .eq("id", id);
    setUpdatingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((r) =>
      r ? r.map((x) => (x.id === id ? { ...x, status } : x)) : r
    );
    toast.success(`已更新為「${STATUS_LABEL[status]}」`);
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows?.length ?? 0 };
    STATUS_FLOW.forEach((s) => (c[s] = 0));
    rows?.forEach((r) => {
      c[r.status] = (c[r.status] ?? 0) + 1;
    });
    return c;
  }, [rows]);

  const filtered = useMemo(
    () => (filter === "all" ? rows : rows?.filter((r) => r.status === filter)),
    [rows, filter]
  );

  if (authLoading || !user || roleLoading) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-12">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="mt-6 h-32 w-full" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-md px-6 py-20 text-center">
        <h1 className="text-2xl font-bold">沒有權限</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          此頁僅限管理員 (admin) 帳戶查看所有查詢。
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/dashboard">
            <ArrowLeft className="mr-2 h-4 w-4" />
            返回我的放盤
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/dashboard" className="hover:text-foreground">
              <ArrowLeft className="inline h-3.5 w-3.5" /> 工作台
            </Link>
          </div>
          <h1 className="mt-1 text-2xl font-bold">查詢收件匣</h1>
          <p className="text-sm text-muted-foreground">
            共 {counts.all} 個查詢，{counts.new ?? 0} 個未處理
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={refreshing}>
          <RefreshCw
            className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
          />
          重新整理
        </Button>
      </header>

      <div className="mt-6 flex flex-wrap gap-1.5">
        <FilterPill
          active={filter === "all"}
          label={`全部 (${counts.all})`}
          onClick={() => setFilter("all")}
        />
        {STATUS_FLOW.map((s) => (
          <FilterPill
            key={s}
            active={filter === s}
            label={`${STATUS_LABEL[s]} (${counts[s] ?? 0})`}
            onClick={() => setFilter(s)}
          />
        ))}
      </div>

      <section className="mt-6">
        {rows === null ? (
          <Skeleton className="h-32 w-full" />
        ) : filtered && filtered.length > 0 ? (
          <div className="grid gap-3">
            {filtered.map((r) => (
              <InquiryCard
                key={r.id}
                inquiry={r}
                updating={updatingId === r.id}
                onStatusChange={(s) => updateStatus(r.id, s)}
              />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              {filter === "all" ? "尚未有任何查詢。" : "此狀態下沒有查詢。"}
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

function FilterPill({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input hover:bg-accent"
      }`}
    >
      {label}
    </button>
  );
}

function InquiryCard({
  inquiry,
  updating,
  onStatusChange,
}: {
  inquiry: Inquiry;
  updating: boolean;
  onStatusChange: (s: InquiryStatus) => void;
}) {
  const created = new Date(inquiry.created_at).toLocaleString("zh-HK", {
    dateStyle: "short",
    timeStyle: "short",
  });
  const isClosed =
    inquiry.status === "closed_won" || inquiry.status === "closed_lost";

  return (
    <Card>
      <CardContent className="grid gap-4 py-4 md:grid-cols-[1fr_auto]">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANT[inquiry.status]}>
              {STATUS_LABEL[inquiry.status]}
            </Badge>
            <Badge variant="outline" className="font-normal">
              {SOURCE_LABEL[inquiry.source] ?? inquiry.source}
            </Badge>
            <span className="text-xs text-muted-foreground">{created}</span>
          </div>

          <div>
            <p className="font-semibold">{inquiry.name}</p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {inquiry.phone && (
                <a
                  href={`tel:${inquiry.phone}`}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  <Phone className="h-3.5 w-3.5" />
                  {inquiry.phone}
                </a>
              )}
              {inquiry.phone && (
                <a
                  href={`https://wa.me/${inquiry.phone.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  WhatsApp
                </a>
              )}
              {inquiry.email && (
                <a
                  href={`mailto:${inquiry.email}`}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  <Mail className="h-3.5 w-3.5" />
                  {inquiry.email}
                </a>
              )}
            </div>
          </div>

          {inquiry.properties && (
            <p className="text-sm">
              查詢放盤：
              <Link
                to="/property/$listingNo"
                params={{ listingNo: inquiry.properties.listing_no }}
                className="font-medium text-primary hover:underline"
              >
                {inquiry.properties.title_zh}
              </Link>
              <span className="ml-1 text-xs text-muted-foreground">
                #{inquiry.properties.listing_no}
              </span>
            </p>
          )}

          {inquiry.message && (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-sm whitespace-pre-wrap">
              {inquiry.message}
            </p>
          )}

          {inquiry.assignee && (
            <p className="text-xs text-muted-foreground">
              指派代理：
              {inquiry.assignee.name_zh ||
                inquiry.assignee.name_en ||
                "未命名"}
            </p>
          )}
        </div>

        <div className="flex flex-col items-stretch gap-2 md:w-44">
          <label className="text-xs font-medium text-muted-foreground">
            更新狀態
          </label>
          <Select
            value={inquiry.status}
            onValueChange={(v) => onStatusChange(v as InquiryStatus)}
            disabled={updating}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FLOW.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!isClosed && (
            <NextStepButtons
              current={inquiry.status}
              disabled={updating}
              onPick={onStatusChange}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function NextStepButtons({
  current,
  disabled,
  onPick,
}: {
  current: InquiryStatus;
  disabled: boolean;
  onPick: (s: InquiryStatus) => void;
}) {
  const idx = STATUS_FLOW.indexOf(current);
  const next = idx >= 0 && idx < 3 ? STATUS_FLOW[idx + 1] : null;
  if (!next) return null;
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled}
        onClick={() => onPick(next)}
      >
        → {STATUS_LABEL[next]}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => onPick("closed_lost")}
      >
        流失
      </Button>
    </div>
  );
}
