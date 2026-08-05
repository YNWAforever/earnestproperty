import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  applyOperationsMigration,
  fetchOperationsMigrations,
  OperationsClientError,
  planOperationsMigration,
} from "@/lib/admin/operations/operations-client";
import type { MigrationPlan, MigrationState } from "@/lib/admin/operations/operations-types";
import type { OperationsCapabilities } from "@/lib/control-plane/capabilities";

export const canConfirmMigrationApply = (migrationId: string, typedId: string) =>
  migrationId === typedId;

export const migrationPlanShouldClear = (status: number) => status === 409;

function migrationErrorMessage(error: unknown, fallback: string) {
  if (error instanceof OperationsClientError) {
    return error.requestId ? `${fallback}（支援參考編號：${error.requestId}）` : fallback;
  }
  return fallback;
}

const MIGRATION_STATUS_LABELS: Record<string, string> = {
  pending: "待處理",
  applied: "已套用",
  drift: "結構偏移",
};

function migrationStatusLabel(status: string) {
  return MIGRATION_STATUS_LABELS[status] ?? status;
}

function statusVariant(status: MigrationState["status"]) {
  if (status === "drift") return "destructive" as const;
  if (status === "applied") return "default" as const;
  return "secondary" as const;
}

function shortChecksum(checksum: string) {
  return checksum.length > 18 ? `${checksum.slice(0, 18)}...` : checksum;
}

function dependencyText(dependencies: string[]) {
  return dependencies.length ? dependencies.join("、") : "無";
}

function PlanRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "break-all font-mono text-xs" : "text-sm"}>{value}</dd>
    </div>
  );
}

export function AdminOperationsMigrations({
  capabilities,
  active,
  onApplied,
}: {
  capabilities: OperationsCapabilities;
  active: boolean;
  onApplied: () => void | Promise<void>;
}) {
  const [rows, setRows] = useState<MigrationState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planningId, setPlanningId] = useState<string | null>(null);
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typedId, setTypedId] = useState("");
  const [applying, setApplying] = useState(false);
  /** Failure shown inside the confirm dialog. Separate from `error` (the panel
   * banner) so a recoverable apply failure stays next to the Apply button. */
  const [applyError, setApplyError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const loadMigrations = useCallback(async () => {
    setPlan(null);
    setTypedId("");
    setConfirmOpen(false);
    if (!active || !capabilities.migrationsPlan) return;
    const request = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchOperationsMigrations();
      if (request !== requestSequence.current) return;
      setRows(result.data);
    } catch (reason) {
      if (request === requestSequence.current) {
        setError(migrationErrorMessage(reason, "未能載入遷移清單。"));
      }
    } finally {
      if (request === requestSequence.current) setLoading(false);
    }
  }, [active, capabilities.migrationsPlan]);

  useEffect(() => {
    if (!active || !capabilities.migrationsPlan) return;
    void loadMigrations();
  }, [active, capabilities.migrationsPlan, loadMigrations]);

  useEffect(
    () => () => {
      requestSequence.current += 1;
    },
    [],
  );

  const runPlan = async (migration: MigrationState) => {
    if (migration.status !== "pending" || planningId || applying) return;
    setPlanningId(migration.id);
    setPlan(null);
    setTypedId("");
    setConfirmOpen(false);
    setError(null);
    try {
      const result = await planOperationsMigration(migration.id);
      setPlan(result.data);
      setTypedId("");
      setConfirmOpen(true);
      toast.success("遷移計劃已就緒，請核對後確認。");
    } catch (reason) {
      setPlan(null);
      setConfirmOpen(false);
      const message = migrationErrorMessage(reason, "未能產生遷移計劃。");
      setError(message);
      toast.error(message);
    } finally {
      setPlanningId(null);
    }
  };

  const runApply = async () => {
    const currentPlan = plan;
    if (!currentPlan || !canConfirmMigrationApply(currentPlan.migrationId, typedId)) return;
    // `plan` is deliberately NOT cleared before the await. It used to be, and
    // because the dialog's `open` prop requires `plan !== null` the modal
    // unmounted the instant Apply was clicked -- an irreversible schema change
    // then ran with no spinner, no progress text and every other control on the
    // panel disabled, which reads as "it didn't register". The dialog's own
    // isPending state was unreachable dead code as a result. It now stays open
    // and busy until the request settles.
    setApplyError(null);
    setApplying(true);
    try {
      await applyOperationsMigration(currentPlan.migrationId, currentPlan.approvalToken);
      setConfirmOpen(false);
      setPlan(null);
      setTypedId("");
      toast.success(`已套用遷移 ${currentPlan.migrationId}`);
      await loadMigrations();
      await onApplied();
    } catch (reason) {
      if (reason instanceof OperationsClientError && migrationPlanShouldClear(reason.status)) {
        // 409: the plan no longer matches the database. Closing is correct here
        // -- the approval token is spent and Plan must be re-run.
        setConfirmOpen(false);
        setPlan(null);
        setTypedId("");
        setError("遷移計劃已過期，請重新執行「計劃」。");
        toast.error("遷移計劃已過期，請重新執行「計劃」。");
        await loadMigrations();
      } else {
        // Recoverable: keep the dialog open with the typed ID intact so the
        // operator can retry without re-planning.
        setApplyError(migrationErrorMessage(reason, "未能套用此遷移。"));
      }
    } finally {
      setApplying(false);
    }
  };

  const closeConfirm = (open: boolean) => {
    setConfirmOpen(open);
    if (!open && !applying) {
      setPlan(null);
      setTypedId("");
      setApplyError(null);
    }
  };

  if (!capabilities.migrationsPlan) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <h2 className="text-base font-semibold">資料庫遷移</h2>
          <p className="text-sm text-muted-foreground">套用前必須先為待處理的遷移執行「計劃」。</p>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label="重新載入遷移清單"
                disabled={loading || planningId !== null || applying}
                onClick={() => void loadMigrations()}
              >
                {loading ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>重新載入遷移清單</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>遷移</TableHead>
            <TableHead>狀態</TableHead>
            <TableHead>Checksum</TableHead>
            <TableHead>相依遷移</TableHead>
            <TableHead className="w-24 text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((migration) => (
            <TableRow key={migration.id}>
              <TableCell>
                <p className="font-medium">{migration.summary}</p>
                <p
                  className="max-w-64 truncate font-mono text-xs text-muted-foreground"
                  title={migration.id}
                >
                  {migration.id}
                </p>
                {migration.status === "drift" ? (
                  <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                    <AlertTriangle className="size-3" /> 偵測到結構偏移
                  </p>
                ) : null}
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant(migration.status)}>
                  {migrationStatusLabel(migration.status)}
                </Badge>
              </TableCell>
              <TableCell>
                <span className="font-mono text-xs" title={migration.checksum}>
                  {shortChecksum(migration.checksum)}
                </span>
              </TableCell>
              <TableCell className="max-w-64 text-sm text-muted-foreground">
                {dependencyText(migration.dependencies)}
              </TableCell>
              <TableCell>
                <div className="flex justify-end">
                  {migration.status === "pending" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      aria-label={`為遷移 ${migration.id} 執行計劃`}
                      disabled={planningId !== null || applying}
                      onClick={() => void runPlan(migration)}
                    >
                      {planningId === migration.id ? "計劃中…" : "計劃"}
                    </Button>
                  ) : migration.status === "applied" ? (
                    <ShieldCheck className="size-4 text-muted-foreground" aria-label="已套用" />
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
          {!rows.length && !loading ? (
            <TableRow>
              <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                沒有遷移記錄。
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      <AdminConfirmDialog
        open={confirmOpen && plan !== null && capabilities.migrationsApply}
        title="確認套用資料庫遷移？"
        description="此操作會直接修改正式資料庫結構，無法自動復原。請核對以下內容後輸入遷移編號確認。"
        confirmLabel="套用遷移"
        confirmVariant="destructive"
        disabled={!plan || !canConfirmMigrationApply(plan.migrationId, typedId)}
        isPending={applying}
        error={applyError}
        onOpenChange={closeConfirm}
        onConfirm={() => void runApply()}
      >
        {plan ? (
          <div className="grid gap-3 text-sm">
            {/* The plan's summary, checksum, dependencies and schema fingerprint
                were all fetched and then never shown -- the confirm displayed
                nothing but the ID, so there was nothing to actually review. */}
            <dl className="grid gap-1 rounded-md border bg-muted/40 p-3">
              <PlanRow label="遷移編號" value={plan.migrationId} mono />
              {plan.summary ? <PlanRow label="內容" value={plan.summary} /> : null}
              {plan.checksum ? <PlanRow label="Checksum" value={plan.checksum} mono /> : null}
              {plan.schemaFingerprint ? (
                <PlanRow label="Schema 指紋" value={plan.schemaFingerprint} mono />
              ) : null}
              <PlanRow label="相依遷移" value={dependencyText(plan.dependencies)} />
            </dl>
            <label className="grid gap-1" htmlFor="migration-confirm-id">
              <span className="text-muted-foreground">請輸入上方的遷移編號以確認</span>
              <Input
                id="migration-confirm-id"
                value={typedId}
                onChange={(event) => setTypedId(event.target.value)}
                aria-label="確認遷移編號"
                aria-invalid={
                  typedId.length > 0 && !canConfirmMigrationApply(plan.migrationId, typedId)
                }
                aria-describedby="migration-confirm-hint"
                disabled={applying}
              />
              <span id="migration-confirm-hint" className="text-xs text-muted-foreground">
                {typedId.length > 0 && !canConfirmMigrationApply(plan.migrationId, typedId)
                  ? "編號不符，請完整複製上方的遷移編號。"
                  : "輸入完全相符的編號後才可套用。"}
              </span>
            </label>
          </div>
        ) : null}
      </AdminConfirmDialog>
    </div>
  );
}
