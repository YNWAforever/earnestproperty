import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchContactIdentityReviews,
  resolveContactIdentityReviewItem,
} from "@/lib/neon/contact-identity-review";
import type {
  IdentityReviewAction,
  IdentityReviewContact,
  IdentityReviewRow,
} from "@/lib/neon/contact-identity-review.types";

// FX-12 Task 4 [owner copy], verbatim from the plan's copy table.
const IDENTITY_REVIEW_COPY = {
  title: "可能重複客戶",
  description: "系統發現以下客戶記錄可能屬於同一人，請逐一核對。系統不會自動合併。",
  conflictBadge: "身分待核對",
  duplicateBadge: "電話格式重複",
  conflictExplanation: "此 WhatsApp 訊息的帳戶與電話分屬不同客戶記錄。訊息已保存，請選擇正確客戶。",
  linkTo: (name: string) => `連結到「${name}」`,
  linkNew: "建立新客戶",
  samePerson: "同一客戶（暫不合併）",
  differentPeople: "不同客戶",
  dismiss: "略過",
  noteLabel: "備註（可選）",
  confirmTitle: "確認處理？",
  confirm: "確認",
  success: "已處理。",
  alreadyResolved: "此項目已由其他同事處理，請重新載入。",
  notAllowed: "此操作不適用於這個項目。",
  empty: "暫時沒有需要核對的客戶記錄。",
  // New in Task 4, not in the copy table: column headings, for owner review.
  contactA: "客戶 A",
  contactB: "客戶 B",
  actions: "處理",
  // New in fix round 1, for owner review.
  reasonColumn: "原因",
  stopNotFound:
    "此對話曾收到退訂（STOP）訊息，但系統未能核實該訊息，所以未有連結。請聯絡技術支援。",
  viewLeadOf: (name: string, n: number) => `查看「${name}」的查詢 ${n}`,
} as const;
// Existing admin copy, reused.
const UNNAMED = "未命名客戶";
const NO_PHONE = "未有電話";
const OPTED_OUT = "已拒收";
const VIEW_LEAD = "查看查詢";
const OPEN_CHAT = "開啟 WhatsApp 對話";
const RELOAD = "重新載入";
const CANCEL = "取消";
const NEXT_PAGE = "下一頁";
const LOAD_FAILED = "暫時未能載入資料，請稍後再試。";
const SUBMIT_FAILED = "提交失敗，請稍後再試。";

/** `detail` tells two link choices apart when the names match: the side and the masked digits. */
type Choice = { action: IdentityReviewAction; label: string; detail?: string };
const sideDetail = (side: string, contact: IdentityReviewContact) =>
  `${side} · ${contact.maskedPhone ?? NO_PHONE}`;
const contactName = (contact: IdentityReviewContact | null) => contact?.name ?? UNNAMED;

/** The actions a row offers: links for a conflict (only to a side that exists), decisions for a duplicate. */
function identityReviewChoices(row: IdentityReviewRow): Choice[] {
  if (row.reason === "phone_format_duplicate")
    return [
      { action: "same_person", label: IDENTITY_REVIEW_COPY.samePerson },
      { action: "different_people", label: IDENTITY_REVIEW_COPY.differentPeople },
      { action: "dismiss", label: IDENTITY_REVIEW_COPY.dismiss },
    ];
  return [
    ...(row.a
      ? [
          {
            action: "link_a" as const,
            label: IDENTITY_REVIEW_COPY.linkTo(contactName(row.a)),
            detail: sideDetail(IDENTITY_REVIEW_COPY.contactA, row.a),
          },
        ]
      : []),
    ...(row.b
      ? [
          {
            action: "link_b" as const,
            label: IDENTITY_REVIEW_COPY.linkTo(contactName(row.b)),
            detail: sideDetail(IDENTITY_REVIEW_COPY.contactB, row.b),
          },
        ]
      : []),
    { action: "link_new", label: IDENTITY_REVIEW_COPY.linkNew },
  ];
}

function ContactCell({ contact }: { contact: IdentityReviewContact | null }) {
  if (!contact) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="space-y-1">
      <div className="font-medium">{contactName(contact)}</div>
      <div className="text-xs tabular-nums text-muted-foreground">
        {contact.maskedPhone ?? NO_PHONE}
      </div>
      {contact.optedOut ? <Badge variant="destructive">{OPTED_OUT}</Badge> : null}
      {contact.openLeadIds.length > 0 ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {contact.openLeadIds.map((leadId, index) => (
            <a
              key={leadId}
              aria-label={IDENTITY_REVIEW_COPY.viewLeadOf(contactName(contact), index + 1)}
              href={`/admin/leads?lead=${encodeURIComponent(leadId)}`}
              className="text-xs text-primary underline-offset-4 hover:underline"
            >
              {VIEW_LEAD}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Below md the header is hidden and each row stacks, so the column name goes in the cell. */
function MobileLabel({ children }: { children: string }) {
  return <span className="mb-1 block text-xs text-muted-foreground md:hidden">{children}</span>;
}

/** Pure table: masked phones only, no request of its own. Rows stack below md. */
export function ContactIdentityReviewTable({
  rows,
  focusId,
  disabled = false,
  onAction,
}: {
  rows: IdentityReviewRow[];
  focusId?: string | null;
  disabled?: boolean;
  onAction: (row: IdentityReviewRow, choice: Choice) => void;
}) {
  if (rows.length === 0) return <AdminEmptyState title={IDENTITY_REVIEW_COPY.empty} />;
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table className="md:min-w-[760px]">
            <TableHeader className="max-md:hidden">
              <TableRow>
                <TableHead className="w-[28%]">{IDENTITY_REVIEW_COPY.reasonColumn}</TableHead>
                <TableHead>{IDENTITY_REVIEW_COPY.contactA}</TableHead>
                <TableHead>{IDENTITY_REVIEW_COPY.contactB}</TableHead>
                <TableHead className="w-[30%]">{IDENTITY_REVIEW_COPY.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const conflict = row.reason === "whatsapp_identity_conflict";
                return (
                  <TableRow
                    key={row.id}
                    data-review-id={row.id}
                    data-state={focusId === row.id ? "selected" : undefined}
                    className="align-top max-md:grid max-md:grid-cols-2"
                  >
                    <TableCell className="space-y-2 max-md:col-span-2">
                      <Badge variant={conflict ? "destructive" : "secondary"}>
                        {conflict
                          ? IDENTITY_REVIEW_COPY.conflictBadge
                          : IDENTITY_REVIEW_COPY.duplicateBadge}
                      </Badge>
                      {conflict ? (
                        <p className="text-xs text-muted-foreground">
                          {IDENTITY_REVIEW_COPY.conflictExplanation}
                        </p>
                      ) : null}
                      {conflict && row.conversationId ? (
                        <a
                          href={`/admin/whatsapp?conversation=${encodeURIComponent(row.conversationId)}`}
                          className="block text-xs text-primary underline-offset-4 hover:underline"
                        >
                          {OPEN_CHAT}
                        </a>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <MobileLabel>{IDENTITY_REVIEW_COPY.contactA}</MobileLabel>
                      <ContactCell contact={row.a} />
                    </TableCell>
                    <TableCell>
                      <MobileLabel>{IDENTITY_REVIEW_COPY.contactB}</MobileLabel>
                      <ContactCell contact={row.b} />
                    </TableCell>
                    <TableCell className="max-md:col-span-2">
                      <div className="flex flex-col items-stretch gap-2">
                        {identityReviewChoices(row).map((choice) => (
                          <Button
                            key={choice.action}
                            type="button"
                            size="sm"
                            variant={choice.action === "dismiss" ? "ghost" : "outline"}
                            className="h-auto min-h-11 whitespace-normal text-left lg:min-h-9"
                            disabled={disabled}
                            onClick={() => onAction(row, choice)}
                          >
                            <span className="flex flex-col">
                              <span>{choice.label}</span>
                              {choice.detail ? (
                                <span className="text-xs font-normal text-muted-foreground tabular-nums">
                                  {choice.detail}
                                </span>
                              ) : null}
                            </span>
                          </Button>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

type Pending = { row: IdentityReviewRow; choice: Choice };
type DialogError = { message: string; reload: boolean };

/** The open review list with its confirm dialog. Admin and manager only (the server enforces it). */
export function ContactIdentityReviewList({
  focusId,
  onResolved,
}: {
  focusId?: string | null;
  onResolved?: () => void;
}) {
  const [rows, setRows] = useState<IdentityReviewRow[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dialogError, setDialogError] = useState<DialogError | null>(null);
  const requestRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
      requestRef.current += 1;
    },
    [],
  );

  const load = useCallback(async (cursor: string | null = null) => {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const page = await fetchContactIdentityReviews({ status: "open", cursor });
      if (request !== requestRef.current) return;
      setRows((current) => (cursor && current ? [...current, ...page.rows] : page.rows));
      setNextCursor(page.nextCursor);
      setLoadError(null);
    } catch {
      if (request === requestRef.current) setLoadError(LOAD_FAILED);
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!focusId || !rows) return;
    document
      .querySelector(`[data-review-id="${CSS.escape(focusId)}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [focusId, rows]);

  function close() {
    if (submitting) return;
    setPending(null);
    setNote("");
    setDialogError(null);
  }

  async function confirm() {
    if (!pending || submitting) return;
    setSubmitting(true);
    setDialogError(null);
    try {
      await resolveContactIdentityReviewItem({
        id: pending.row.id,
        action: pending.choice.action,
        note: note.trim() || null,
      });
      if (!mountedRef.current) return;
      toast.success(IDENTITY_REVIEW_COPY.success);
      setPending(null);
      setNote("");
      onResolved?.();
      void load();
    } catch (error) {
      if (!mountedRef.current) return;
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? (error as { status: unknown }).status
          : undefined;
      const code = error instanceof Error ? error.message.trim() : "";
      if (code === "REVIEW_STOP_NOT_FOUND")
        setDialogError({ message: IDENTITY_REVIEW_COPY.stopNotFound, reload: true });
      else if (status === 409 || code === "REVIEW_ALREADY_RESOLVED")
        setDialogError({ message: IDENTITY_REVIEW_COPY.alreadyResolved, reload: true });
      else if (code === "REVIEW_ACTION_NOT_ALLOWED")
        setDialogError({ message: IDENTITY_REVIEW_COPY.notAllowed, reload: true });
      else setDialogError({ message: SUBMIT_FAILED, reload: false });
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  }

  function reloadAfterConflict() {
    setPending(null);
    setNote("");
    setDialogError(null);
    onResolved?.();
    void load();
  }

  return (
    <section aria-labelledby="identity-review-title" className="space-y-3">
      <div>
        <h2 id="identity-review-title" className="text-base font-semibold">
          {IDENTITY_REVIEW_COPY.title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{IDENTITY_REVIEW_COPY.description}</p>
      </div>
      {loadError ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{loadError}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
              <RotateCcw className="h-4 w-4" />
              {RELOAD}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {rows === null && loading ? <Skeleton className="h-48 w-full" /> : null}
      {rows ? (
        <ContactIdentityReviewTable
          rows={rows}
          focusId={focusId}
          disabled={submitting}
          onAction={(row, choice) => {
            setPending({ row, choice });
            setNote("");
            setDialogError(null);
          }}
        />
      ) : null}
      {nextCursor ? (
        <Button
          type="button"
          variant="outline"
          disabled={loading}
          onClick={() => void load(nextCursor)}
        >
          {NEXT_PAGE}
        </Button>
      ) : null}

      <Dialog open={pending !== null} onOpenChange={(open) => (open ? undefined : close())}>
        <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{IDENTITY_REVIEW_COPY.confirmTitle}</DialogTitle>
            <DialogDescription className="flex flex-col">
              <span>{pending?.choice.label}</span>
              {pending?.choice.detail ? (
                <span className="font-medium text-foreground tabular-nums">
                  {pending.choice.detail}
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="identity-review-note">{IDENTITY_REVIEW_COPY.noteLabel}</Label>
            <Textarea
              id="identity-review-note"
              rows={3}
              maxLength={500}
              value={note}
              disabled={submitting}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          {dialogError ? (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>{dialogError.message}</span>
                {dialogError.reload ? (
                  <Button type="button" size="sm" variant="outline" onClick={reloadAfterConflict}>
                    <RotateCcw className="h-4 w-4" />
                    {RELOAD}
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={submitting} onClick={close}>
              {CANCEL}
            </Button>
            <Button
              type="button"
              disabled={submitting || dialogError?.reload === true}
              onClick={() => void confirm()}
            >
              {IDENTITY_REVIEW_COPY.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
