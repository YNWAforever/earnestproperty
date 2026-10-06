import { useEffect, useState } from "react";

import { formatHkDateTime } from "@/lib/format";
import { fetchLeadLiveAgentTranscript } from "@/lib/neon/admin-data";
import type { AdminLeadTranscriptMessage } from "@/lib/neon/admin-data.types";

export type LeadChatTranscriptState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; messages: AdminLeadTranscriptMessage[] };

const ROLE_LABELS: Record<AdminLeadTranscriptMessage["role"], string> = {
  visitor: "訪客",
  assistant: "問樓助手",
  system: "系統",
  staff: "同事",
};

export function LeadChatTranscriptView({
  state,
  onRetry,
}: {
  state: LeadChatTranscriptState;
  onRetry: () => void;
}) {
  return (
    <section className="rounded-lg border p-4" aria-label="網站問樓助手對話">
      <h3 className="text-sm font-semibold">網站問樓助手對話</h3>
      {state.kind === "loading" ? (
        <p className="mt-3 text-sm text-muted-foreground">載入中…</p>
      ) : state.kind === "error" ? (
        <p role="alert" className="mt-3 text-sm">
          未能載入網站對話紀錄。
          <button type="button" className="underline" onClick={onRetry}>
            重新載入
          </button>
        </p>
      ) : state.messages.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          沒有網站對話紀錄
        </p>
      ) : (
        <ol className="mt-3 space-y-2">
          {state.messages.map((message, index) => (
            <li key={index} className="rounded-lg border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{ROLE_LABELS[message.role]}</span>
                <time dateTime={message.created_at}>
                  {formatHkDateTime(message.created_at) ?? "—"}
                </time>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{message.text}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function LeadChatTranscript({ leadId }: { leadId: string }) {
  const [state, setState] = useState<LeadChatTranscriptState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    fetchLeadLiveAgentTranscript({ data: { leadId } })
      .then((messages) => {
        if (live) setState({ kind: "ready", messages });
      })
      .catch(() => {
        if (live) setState({ kind: "error" });
      });
    return () => {
      live = false;
    };
  }, [leadId, retry]);
  return <LeadChatTranscriptView state={state} onRetry={() => setRetry((n) => n + 1)} />;
}
