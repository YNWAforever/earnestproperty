import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronDown, LoaderCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchOperationsAudit } from "@/lib/admin/operations/operations-client";
import type { AuditRow } from "@/lib/admin/operations/operations-types";

type AuditOutcome = AuditRow["outcome"];
type AuditFilters = { outcome: "all" | AuditOutcome; action: string; requestId: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidAuditRequestId(value: string) {
  return value === "" || uuidPattern.test(value);
}

function safeMetadataValue(value: unknown) {
  if (value === null) return "null";
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return "[unavailable]";
  }
}

export function safeAuditMetadataEntries(metadata: Record<string, unknown>) {
  return Object.keys(metadata)
    .sort()
    .slice(0, 20)
    .map((key) => [key, safeMetadataValue(metadata[key])] as [string, string]);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function outcomeVariant(outcome: AuditOutcome) {
  if (outcome === "failure" || outcome === "denied") return "destructive" as const;
  return "default" as const;
}

export function AdminOperationsAudit({ active, revision }: { active: boolean; revision: number }) {
  const [outcomeDraft, setOutcomeDraft] = useState<AuditFilters["outcome"]>("all");
  const [actionDraft, setActionDraft] = useState("");
  const [requestIdDraft, setRequestIdDraft] = useState("");
  const [filters, setFilters] = useState<AuditFilters>({
    outcome: "all",
    action: "",
    requestId: "",
  });
  const [filterRevision, setFilterRevision] = useState(0);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const requestSequence = useRef(0);

  const loadAudit = useCallback(
    async ({ append = false, cursor }: { append?: boolean; cursor?: string } = {}) => {
      if (!active) return;
      const request = ++requestSequence.current;
      setLoading(true);
      setError(null);
      try {
        const result = await fetchOperationsAudit({
          outcome: filters.outcome === "all" ? undefined : filters.outcome,
          action: filters.action || undefined,
          requestId: filters.requestId || undefined,
          cursor,
          limit: 25,
        });
        if (request !== requestSequence.current) return;
        setRows((current) => (append ? [...current, ...result.data.rows] : result.data.rows));
        setNextCursor(result.data.nextCursor);
      } catch {
        if (request === requestSequence.current) setError("Unable to load audit events.");
      } finally {
        if (request === requestSequence.current) setLoading(false);
      }
    },
    [active, filters],
  );

  useEffect(() => {
    if (!active) return;
    void loadAudit();
  }, [active, filterRevision, loadAudit, revision]);

  useEffect(
    () => () => {
      requestSequence.current += 1;
    },
    [],
  );

  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    const requestId = requestIdDraft.trim();
    if (!isValidAuditRequestId(requestId)) {
      setValidationError("Enter a valid request ID.");
      return;
    }
    setValidationError(null);
    setRows([]);
    setNextCursor(null);
    setFilters({ outcome: outcomeDraft, action: actionDraft.trim(), requestId });
    setFilterRevision((value) => value + 1);
  };

  const filterByRequestId = (requestId: string) => {
    setRequestIdDraft(requestId);
    setValidationError(null);
    setRows([]);
    setNextCursor(null);
    setFilters((current) => ({ ...current, requestId }));
    setFilterRevision((value) => value + 1);
  };

  const toggleExpanded = (id: string, open: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(id);
      else return new Set([...current].filter((value) => value !== id));
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <form
        onSubmit={applyFilters}
        className="grid gap-3 border-b pb-4 md:grid-cols-[11rem_1fr_1fr_auto] md:items-end"
      >
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Outcome</span>
          <Select
            value={outcomeDraft}
            onValueChange={(value) => setOutcomeDraft(value as AuditFilters["outcome"])}
          >
            <SelectTrigger aria-label="Filter audit by outcome">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All outcomes</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failure">Failure</SelectItem>
              <SelectItem value="denied">Denied</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Action</span>
          <Input
            value={actionDraft}
            onChange={(event) => setActionDraft(event.target.value)}
            placeholder="Filter by action"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Request ID</span>
          <Input
            value={requestIdDraft}
            onChange={(event) => setRequestIdDraft(event.target.value)}
            aria-invalid={validationError !== null}
            placeholder="UUID"
          />
        </label>
        <Button type="submit" variant="secondary" disabled={loading}>
          Apply filters
        </Button>
      </form>

      {validationError ? (
        <p role="alert" className="text-sm text-destructive">
          {validationError}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead>Staff ID</TableHead>
            <TableHead>Request ID</TableHead>
            <TableHead>Metadata</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const entries = safeAuditMetadataEntries(row.metadata);
            const isOpen = expanded.has(row.id);
            return (
              <TableRow key={row.id}>
                <TableCell>{formatDate(row.created_at)}</TableCell>
                <TableCell className="font-medium">{row.action}</TableCell>
                <TableCell>
                  <Badge variant={outcomeVariant(row.outcome)}>{row.outcome}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{row.actor_staff_id}</TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto max-w-48 truncate p-0 font-mono text-xs"
                    onClick={() => filterByRequestId(row.request_id)}
                  >
                    {row.request_id}
                  </Button>
                </TableCell>
                <TableCell>
                  {entries.length ? (
                    <Collapsible
                      open={isOpen}
                      onOpenChange={(open) => toggleExpanded(row.id, open)}
                    >
                      <CollapsibleTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={"Toggle metadata for " + row.action}
                        >
                          {entries.length} fields{" "}
                          <ChevronDown className="ml-1 size-4" aria-hidden="true" />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <dl className="mt-2 grid max-w-md gap-2 border-l pl-3 text-xs">
                          {entries.map(([key, value]) => (
                            <div key={key} className="grid gap-1">
                              <dt className="font-medium">{key}</dt>
                              <dd className="break-words text-muted-foreground">{value}</dd>
                            </div>
                          ))}
                        </dl>
                      </CollapsibleContent>
                    </Collapsible>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {!rows.length && !loading ? (
            <TableRow>
              <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                No audit events found.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      {loading ? (
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Loading audit events
        </p>
      ) : null}
      {nextCursor ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => void loadAudit({ append: true, cursor: nextCursor })}
          >
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
