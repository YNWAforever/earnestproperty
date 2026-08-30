import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Upload } from "lucide-react";
import { toast } from "sonner";

import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { AdminToolbar } from "@/components/admin/AdminToolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { fetchAdminEstateOptions } from "@/lib/neon/admin-data";
import { importAdminTransactionsDraft, listAdminTransactions } from "@/lib/neon/admin-transactions";
import type {
  AdminTransactionRow,
  AdminTransactionVerificationState,
} from "@/lib/neon/admin-transactions.types";

type EstateOption = { id: string; name_zh: string; district_slug: string };

const VERIFICATION_LABELS: Record<AdminTransactionVerificationState, string> = {
  unverified: "未核實",
  pending: "待覆核",
  verified: "已核實",
};

const IMPORT_PLACEHOLDER =
  "每行一筆，順序：屋苑ID,單位,買賣/租賃(sale/rent),成交價,實用面積,實呎叫價,成交日期(YYYY-MM-DD),座數,樓層範圍,來源,來源連結,代理ID\n" +
  "例：33333333-3333-4333-8333-333333333333,,sale,6000000,617,9724,2026-07-22,第03座,低層,,,,";

function parseImportText(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [
        estate_id,
        unit,
        deal_type,
        price,
        saleable_area,
        saleable_psf,
        deal_date,
        block,
        floor_band,
        source,
        source_url,
        agent_id,
      ] = line.split(",").map((cell) => cell.trim());
      return {
        estate_id,
        unit: unit || null,
        deal_type: (deal_type === "rent" ? "rent" : "sale") as "sale" | "rent",
        price: Number(price),
        saleable_area: Number(saleable_area),
        saleable_psf: Number(saleable_psf),
        deal_date,
        block: block || null,
        floor_band: floor_band || null,
        source: source || null,
        source_url: source_url || null,
        agent_id: agent_id || null,
      };
    });
}

export const Route = createFileRoute("/admin/transactions")({
  head: () => ({
    meta: [{ title: "成交管理｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminTransactions,
});

function AdminTransactions() {
  const { user } = useNeonAuth();
  const [rows, setRows] = useState<AdminTransactionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estates, setEstates] = useState<EstateOption[]>([]);
  const [estateFilter, setEstateFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importSaving, setImportSaving] = useState(false);

  async function refresh() {
    try {
      const result = await listAdminTransactions({
        data: {
          estateId: estateFilter === "all" ? undefined : estateFilter,
          verificationState:
            stateFilter === "all" ? undefined : (stateFilter as AdminTransactionVerificationState),
        },
      });
      setRows(result.rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "未能載入成交記錄");
    }
  }

  useEffect(() => {
    if (!user) return;
    fetchAdminEstateOptions()
      .then((data) => setEstates(data as EstateOption[]))
      .catch(() => undefined);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, estateFilter, stateFilter]);

  async function handleImport(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parseImportText(importText);
    if (!parsed.length) {
      toast.error("未能從內容解析成交記錄");
      return;
    }
    setImportSaving(true);
    try {
      const result = await importAdminTransactionsDraft({ data: { rows: parsed } });
      if (result.failure) {
        toast.error(
          `已匯入 ${result.imported}／${result.total}，第 ${result.failure.position} 條失敗：${result.failure.message}`,
        );
      } else {
        toast.success(`已匯入 ${result.imported} 條成交記錄（未核實，未發布）`);
        setImportOpen(false);
        setImportText("");
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "匯入失敗");
    } finally {
      setImportSaving(false);
    }
  }

  return (
    <AdminShell title="成交管理" description="管理成交記錄的核實與發布狀態。">
      <AdminToolbar
        filters={
          <>
            <Select value={estateFilter} onValueChange={setEstateFilter}>
              <SelectTrigger className="w-48" aria-label="依屋苑篩選">
                <SelectValue placeholder="所有屋苑" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">所有屋苑</SelectItem>
                {estates.map((estate) => (
                  <SelectItem key={estate.id} value={estate.id}>
                    {estate.name_zh}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={stateFilter} onValueChange={setStateFilter}>
              <SelectTrigger className="w-36" aria-label="依核實狀態篩選">
                <SelectValue placeholder="所有狀態" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">所有狀態</SelectItem>
                <SelectItem value="unverified">未核實</SelectItem>
                <SelectItem value="pending">待覆核</SelectItem>
                <SelectItem value="verified">已核實</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-11 lg:h-9"
              onClick={() => setImportOpen(true)}
            >
              <Upload className="mr-2 h-4 w-4" />
              匯入
            </Button>
            <Button asChild size="sm" className="h-11 lg:h-9">
              <Link to="/admin/transactions/new">
                <Plus className="mr-2 h-4 w-4" />
                新增成交
              </Link>
            </Button>
          </>
        }
      />
      {error ? <AdminError message={error} /> : null}
      {!rows && !error ? <Skeleton className="h-72 w-full" /> : null}
      {rows?.length === 0 ? (
        <AdminEmptyState title="未有成交記錄" description="新增成交記錄後即可核實及發布。" />
      ) : null}
      {rows && rows.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>屋苑</TableHead>
              <TableHead>成交價</TableHead>
              <TableHead>實用面積</TableHead>
              <TableHead>實呎</TableHead>
              <TableHead>成交日期</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead>發布</TableHead>
              <TableHead className="w-20 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <p className="font-medium">{row.estate_name_zh}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.block ?? ""} {row.unit ?? ""}
                  </p>
                </TableCell>
                <TableCell>${row.price.toLocaleString()}</TableCell>
                <TableCell>{row.saleable_area} 呎</TableCell>
                <TableCell>${row.saleable_psf.toLocaleString()}</TableCell>
                <TableCell>{row.deal_date}</TableCell>
                <TableCell>
                  <Badge variant={row.verification_state === "verified" ? "default" : "outline"}>
                    {VERIFICATION_LABELS[row.verification_state]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={row.published ? "default" : "outline"}>
                    {row.published ? "已發布" : "未發布"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="outline" size="sm">
                    <Link to="/admin/transactions/$id" params={{ id: row.id }}>
                      編輯
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>匯入成交記錄</DialogTitle>
            <DialogDescription>
              每行一筆，逗號分隔。匯入的記錄一律為未核實草稿，需個別核實及發布後才會公開顯示。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleImport} className="grid gap-4">
            <Textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={10}
              placeholder={IMPORT_PLACEHOLDER}
              className="font-mono text-xs"
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setImportOpen(false)}
                disabled={importSaving}
              >
                取消
              </Button>
              <Button type="submit" disabled={importSaving}>
                {importSaving ? "匯入中…" : "匯入"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}
