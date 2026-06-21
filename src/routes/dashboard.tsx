import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Plus, LogOut, Pencil, Trash2, Inbox } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRoles } from "@/hooks/use-roles";
import type { Tables } from "@/integrations/supabase/types";

type Property = Tables<"properties">;

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [{ title: "經紀工作台｜晉誠地產" }, { name: "robots", content: "noindex" }],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { user, loading } = useAuth();
  const { isAdmin } = useRoles(user?.id);
  const navigate = useNavigate();
  const router = useRouter();
  const [properties, setProperties] = useState<Property[] | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth/login" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("properties")
      .select("*")
      .eq("agent_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) toast.error(error.message);
        else setProperties(data ?? []);
      });
  }, [user]);

  async function handleDelete(id: string) {
    if (!confirm("確定刪除此放盤？")) return;
    const { error } = await supabase.from("properties").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setProperties((p) => p?.filter((x) => x.id !== id) ?? null);
    toast.success("已刪除");
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.invalidate();
    navigate({ to: "/auth/login" });
  }

  if (loading || !user) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-12">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="mt-6 h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-6">
        <div>
          <h1 className="text-2xl font-bold">我的放盤</h1>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <Button asChild variant="outline">
              <Link to="/dashboard/inquiries">
                <Inbox className="mr-2 h-4 w-4" />
                查詢收件匣
              </Link>
            </Button>
          )}
          <Button asChild>
            <Link to="/dashboard/property/new">
              <Plus className="mr-2 h-4 w-4" />
              新增放盤
            </Link>
          </Button>
          <Button variant="outline" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            登出
          </Button>
        </div>
      </header>

      <section className="mt-8">
        {properties === null ? (
          <Skeleton className="h-32 w-full" />
        ) : properties.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              尚未有放盤，按右上角「新增放盤」開始。
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {properties.map((p) => (
              <Card key={p.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={p.deal_type === "rent" ? "secondary" : "default"}>
                        {p.deal_type === "rent" ? "租" : "售"}
                      </Badge>
                      <Badge variant="outline">{p.status}</Badge>
                      <span className="text-xs text-muted-foreground">編號 {p.listing_no}</span>
                    </div>
                    <p className="mt-1 truncate font-medium">{p.title_zh}</p>
                    <p className="text-sm text-muted-foreground">
                      {p.deal_type === "rent"
                        ? p.rent
                          ? `月租 $${Number(p.rent).toLocaleString()}`
                          : "—"
                        : p.price
                          ? `$${(Number(p.price) / 1_000_000).toFixed(2)}M`
                          : "—"}
                      {p.saleable_area ? ` · ${p.saleable_area} 呎` : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link to="/dashboard/property/$id" params={{ id: p.id }}>
                        <Pencil className="mr-1 h-4 w-4" />
                        編輯
                      </Link>
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleDelete(p.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
