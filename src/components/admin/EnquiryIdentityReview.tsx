import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchEnquiryIdentityReview,
  reviewEnquiryPhonePurpose,
  resolveEnquiryHeldReply,
} from "@/lib/neon/enquiry-forwarding";
import type { EnquiryInfoReviewState } from "@/lib/neon/enquiry-info-review.types";
import { formatHkDateTime } from "@/lib/format";

type Form = { kind: "phone" | "receipt"; key: string; sourceReference: string; statement: string };
const emptyForm: Form = { kind: "phone", key: "", sourceReference: "", statement: "" };
type Action = "approved" | "revoked" | "customer" | "staff";
type FormProps = {
  data: EnquiryInfoReviewState;
  form: Form;
  busy: boolean;
  error: string;
  notice: string;
  onForm: (value: Form) => void;
  onAction: (action: Action) => void;
  onRefresh: () => void;
};
export function EnquiryIdentityReviewForm({
  data,
  form,
  busy,
  error,
  notice,
  onForm,
  onAction,
  onRefresh,
}: FormProps) {
  const phone = data.phones.find((row) => row.phone === form.key),
    receipt = data.heldReplies.find((row) => row.receiptId === form.key);
  const hasEvidence = form.sourceReference.trim().length >= 3 && form.statement.trim().length >= 3;
  const select = (kind: Form["kind"], key: string) =>
    onForm({ kind, key, sourceReference: "", statement: "" });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={form.kind === "phone" ? "default" : "outline"}
          onClick={() =>
            select(
              "phone",
              data.phones.find(
                (row) =>
                  row.state === "unreviewed" || row.state === "changed" || row.state === "revoked",
              )?.phone ??
                data.phones[0]?.phone ??
                "",
            )
          }
        >
          收件用途
        </Button>
        <Button
          type="button"
          variant={form.kind === "receipt" ? "default" : "outline"}
          onClick={() => select("receipt", data.heldReplies[0]?.receiptId ?? "")}
        >
          待核對回覆（{data.heldCount}）
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onRefresh}>
          重新整理
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
      {form.kind === "phone" ? (
        <>
          <label className="block space-y-1 text-sm">
            <span>收件電話</span>
            <select
              aria-label="收件電話"
              className="w-full rounded-md border bg-background p-2"
              value={form.key}
              disabled={busy}
              onChange={(e) => select("phone", e.target.value)}
            >
              <option value="" disabled>
                選擇收件電話
              </option>
              {data.phones.map((row) => (
                <option key={row.phone} value={row.phone}>
                  {row.names.join("、")} · {row.phone}
                </option>
              ))}
            </select>
          </label>
          {phone ? (
            <p className="text-sm">
              {phone.retired ? "歷史通知電話 · " : null}
              {phone.state === "approved"
                ? "通知用途已核對"
                : phone.state === "revoked"
                  ? "已撤回通知用途"
                  : phone.state === "changed"
                    ? "收件資料已變更，須重新核對"
                    : phone.state === "policy"
                      ? "現有收件用途"
                      : "通知用途待核對"}
              {phone.memberAssociated ? " · 身份關聯已核對" : ""}
              {phone.customerConflictCount ? " · 有現有身份重疊" : ""}
            </p>
          ) : null}
        </>
      ) : (
        <>
          {data.heldCount === 0 ? (
            <p className="text-sm text-muted-foreground">暫無待核對回覆。</p>
          ) : (
            <label className="block space-y-1 text-sm">
              <span>待核對回覆</span>
              <select
                aria-label="待核對回覆"
                className="w-full rounded-md border bg-background p-2"
                value={form.key}
                disabled={busy}
                onChange={(e) => select("receipt", e.target.value)}
              >
                <option value="" disabled>
                  選擇回覆
                </option>
                {data.heldReplies.map((row) => (
                  <option key={row.receiptId} value={row.receiptId}>
                    {formatHkDateTime(row.receivedAt)} · {row.text.slice(0, 40) || "未有文字"}
                  </option>
                ))}
              </select>
            </label>
          )}
          {receipt ? (
            <div className="space-y-2 rounded-md border p-3 text-sm">
              <p>
                {formatHkDateTime(receipt.messageAt ?? receipt.receivedAt)}
                {receipt.fromPhone ? ` · ${receipt.fromPhone}` : ""}
              </p>
              {receipt.contactNames.length ? <p>{receipt.contactNames.join("、")}</p> : null}
              <blockquote className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words">
                {receipt.text || "未有文字"}
              </blockquote>
              {receipt.blockedReason ? (
                <p className="text-amber-800 dark:text-amber-300">{receipt.blockedReason}</p>
              ) : null}
              {!receipt.staffAllowed ? (
                <p className="text-muted-foreground">未有可核實的同事身份關聯。</p>
              ) : null}
            </div>
          ) : null}
          {data.hasMore ? (
            <p className="text-sm text-muted-foreground">目前顯示首 25 項，完成後可重新整理。</p>
          ) : null}
        </>
      )}
      <label className="block space-y-1 text-sm">
        <span>核對來源</span>
        <Input
          aria-label="核對來源"
          maxLength={500}
          disabled={busy}
          value={form.sourceReference}
          onChange={(e) => onForm({ ...form, sourceReference: e.target.value })}
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>核對內容</span>
        <Textarea
          aria-label="核對內容"
          rows={3}
          maxLength={4000}
          disabled={busy}
          value={form.statement}
          onChange={(e) => onForm({ ...form, statement: e.target.value })}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {form.kind === "phone" ? (
          <>
            <Button
              type="button"
              disabled={busy || !hasEvidence || !phone?.eligible || phone.retired === true}
              onClick={() => onAction("approved")}
            >
              確認通知用途
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || !hasEvidence || !phone || phone.state === "revoked"}
              onClick={() => onAction("revoked")}
            >
              撤回通知用途
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              disabled={busy || !hasEvidence || !receipt?.customerAllowed}
              onClick={() => onAction("customer")}
            >
              確認客戶並保存原回覆
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || !hasEvidence || !receipt?.staffAllowed}
              onClick={() => onAction("staff")}
            >
              確認同事回覆
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
function errorText(error: unknown) {
  const value = error as { status?: number; message?: string };
  if (value?.status === 401) return "登入已過期，請重新登入。";
  if (value?.status === 403) return "沒有身份核對權限。";
  return value?.message && /[\u3400-\u9fff]/.test(value.message)
    ? value.message
    : "未能完成身份核對，請重新整理。";
}
const alwaysCurrent = () => true;
export function EnquiryIdentityReview({
  isWorkspaceCurrent = alwaysCurrent,
  onChanged,
}: {
  isWorkspaceCurrent?: () => boolean;
  onChanged?: () => void | Promise<void>;
}) {
  const [data, setData] = useState<EnquiryInfoReviewState | null>(null),
    [form, setForm] = useState<Form>(emptyForm),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const mounted = useRef(false),
    revision = useRef(0);
  const current = useCallback(() => mounted.current && isWorkspaceCurrent(), [isWorkspaceCurrent]);
  const refresh = useCallback(async () => {
    const token = ++revision.current;
    if (!current()) return;
    const result = await fetchEnquiryIdentityReview(current);
    if (!current() || token !== revision.current) return;
    setData(result);
    setForm((old) => ({
      ...old,
      sourceReference: "",
      statement: "",
      key: (
        old.kind === "phone"
          ? result.phones.some((row) => row.phone === old.key)
          : result.heldReplies.some((row) => row.receiptId === old.key)
      )
        ? old.key
        : old.kind === "phone"
          ? (result.phones.find(
              (row) =>
                row.state === "unreviewed" || row.state === "changed" || row.state === "revoked",
            )?.phone ??
            result.phones[0]?.phone ??
            "")
          : (result.heldReplies[0]?.receiptId ?? ""),
    }));
  }, [current]);
  const invalidate = useCallback(() => {
    revision.current++;
  }, []);
  useEffect(() => {
    mounted.current = true;
    setData(null);
    Promise.resolve()
      .then(refresh)
      .catch((value) => {
        if (current()) setError(errorText(value));
      });
    return () => {
      mounted.current = false;
      invalidate();
    };
  }, [current, refresh, invalidate]);
  const manualRefresh = async () => {
    if (!current() || busy) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await refresh();
    } catch (value) {
      if (current()) setError(errorText(value));
    } finally {
      if (current()) setBusy(false);
    }
  };
  const act = async (action: Action) => {
    if (
      !current() ||
      busy ||
      !data ||
      form.sourceReference.trim().length < 3 ||
      form.statement.trim().length < 3
    )
      return;
    const phone = data.phones.find((row) => row.phone === form.key),
      receipt = data.heldReplies.find((row) => row.receiptId === form.key);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const evidence = { sourceReference: form.sourceReference, statement: form.statement };
      if ((action === "approved" || action === "revoked") && form.kind === "phone" && phone) {
        await reviewEnquiryPhonePurpose(
          {
            ...evidence,
            phone: phone.phone,
            decision: action,
            expectedRevision: phone.revision,
            profileHash: phone.profileHash,
            conflictHash: phone.conflictHash,
          },
          current,
        );
      } else if (
        (action === "customer" || action === "staff") &&
        form.kind === "receipt" &&
        receipt
      ) {
        const result = await resolveEnquiryHeldReply(
          {
            ...evidence,
            receiptId: receipt.receiptId,
            expectedRevision: receipt.expectedRevision,
            expectedMemberRevision: receipt.expectedMemberRevision,
            resolution: action,
          },
          current,
        );
        if (result.resolved !== true) throw Error("回覆仍未完成核對。");
      } else {
        return;
      }
      if (current()) {
        await refresh();
        await onChanged?.();
        if (current()) setNotice("已完成核對。");
      }
    } catch (value) {
      if (current()) {
        setError(errorText(value));
        try {
          await refresh();
        } catch (refreshError) {
          if (current()) setError(`${errorText(value)} ${errorText(refreshError)}`);
        }
      }
    } finally {
      if (current()) setBusy(false);
    }
  };
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          身份核對{data?.heldCount ? `（${data.heldCount}）` : ""}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>通知身份核對</DialogTitle>
        </DialogHeader>
        {data && isWorkspaceCurrent() ? (
          <EnquiryIdentityReviewForm
            data={data}
            form={form}
            busy={busy}
            error={error}
            notice={notice}
            onForm={(value) => {
              if (value.kind !== form.kind || value.key !== form.key) {
                setError("");
                setNotice("");
              }
              setForm(value);
            }}
            onAction={(action) => {
              void act(action);
            }}
            onRefresh={() => {
              void manualRefresh();
            }}
          />
        ) : (
          <div className="space-y-3">
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : (
              <p>載入中…</p>
            )}
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                void manualRefresh();
              }}
            >
              重新整理
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
