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
    return error.requestId ? `${fallback} Request ID: ${error.requestId}` : fallback;
  }
  return fallback;
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
  return dependencies.length ? dependencies.join(", ") : "None";
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
        setError(migrationErrorMessage(reason, "Unable to load migrations."));
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
      toast.success("Migration plan ready.");
    } catch (reason) {
      setPlan(null);
      setConfirmOpen(false);
      const message = migrationErrorMessage(reason, "Unable to plan migration.");
      setError(message);
      toast.error(message);
    } finally {
      setPlanningId(null);
    }
  };

  const runApply = async () => {
    const currentPlan = plan;
    if (!currentPlan || !canConfirmMigrationApply(currentPlan.migrationId, typedId)) return;
    setPlan(null);
    setTypedId("");
    setApplying(true);
    try {
      await applyOperationsMigration(currentPlan.migrationId, currentPlan.approvalToken);
      setConfirmOpen(false);
      toast.success("Migration applied.");
      await loadMigrations();
      await onApplied();
    } catch (reason) {
      if (reason instanceof OperationsClientError && migrationPlanShouldClear(reason.status)) {
        setConfirmOpen(false);
        setError("Migration plan is stale. Please run Plan again.");
        toast.error("Migration plan is stale. Please run Plan again.");
        await loadMigrations();
      } else {
        const message = migrationErrorMessage(reason, "Unable to apply migration.");
        setError(message);
        toast.error(message);
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
    }
  };

  if (!capabilities.migrationsPlan) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <h2 className="text-base font-semibold">Migrations</h2>
          <p className="text-sm text-muted-foreground">Plan one pending migration before apply.</p>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label="Refresh migrations"
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
            <TooltipContent>Refresh migrations</TooltipContent>
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
            <TableHead>Migration</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Checksum</TableHead>
            <TableHead>Dependencies</TableHead>
            <TableHead className="w-24 text-right">Actions</TableHead>
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
                    <AlertTriangle className="size-3" /> Drift detected
                  </p>
                ) : null}
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant(migration.status)}>{migration.status}</Badge>
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
                      aria-label={`Plan migration ${migration.id}`}
                      disabled={planningId !== null || applying}
                      onClick={() => void runPlan(migration)}
                    >
                      {planningId === migration.id ? "Planning..." : "Plan"}
                    </Button>
                  ) : migration.status === "applied" ? (
                    <ShieldCheck className="size-4 text-muted-foreground" aria-label="Applied" />
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
          {!rows.length && !loading ? (
            <TableRow>
              <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                No migrations found.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      <AdminConfirmDialog
        open={confirmOpen && plan !== null && capabilities.migrationsApply}
        title="Apply migration?"
        description="Confirm the exact migration ID before applying this planned change."
        confirmLabel="Apply"
        confirmVariant="destructive"
        disabled={!plan || !canConfirmMigrationApply(plan.migrationId, typedId)}
        isPending={applying}
        onOpenChange={closeConfirm}
        onConfirm={() => void runApply()}
      >
        {plan ? (
          <div className="grid gap-2 text-sm">
            <p className="rounded-md border bg-muted/40 p-2 font-mono text-xs">
              {plan.migrationId}
            </p>
            <label className="grid gap-1">
              <span className="text-muted-foreground">Type migration ID</span>
              <Input
                value={typedId}
                onChange={(event) => setTypedId(event.target.value)}
                aria-label="Confirm migration ID"
                aria-invalid={
                  typedId.length > 0 && !canConfirmMigrationApply(plan.migrationId, typedId)
                }
                disabled={applying}
              />
            </label>
          </div>
        ) : null}
      </AdminConfirmDialog>
    </div>
  );
}
