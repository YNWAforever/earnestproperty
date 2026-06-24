import { useEffect, useRef, useState } from "react";
import { LoaderCircle, MessageCircle, Send, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const liveAgentEndpoints = {
  session: "/api/live-agent/session",
  message: "/api/live-agent/message",
  handoff: "/api/live-agent/handoff",
} as const;

const anonymousStorageKey = "earnest-live-agent-anonymous-id";

type Message = { role: "assistant" | "visitor"; text: string };

const initialMessages: Message[] = [
  {
    role: "assistant",
    text: "你好，我是 Earnest Property 問樓助手。想買樓、租樓、放盤估價，還是查詢屋苑資料？",
  },
];

export function LiveAgentWidget() {
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ block: "end" });
  }, [messages, loading]);

  async function ensureSession() {
    if (sessionId) return sessionId;

    const response = await fetch(liveAgentEndpoints.session, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        anonymousId: readOrCreateAnonymousId(),
        sourcePath: window.location.pathname,
      }),
    });

    if (!response.ok) throw new Error("Unable to start live-agent session.");
    const data = (await response.json()) as { id?: unknown };
    if (typeof data.id !== "string" || !data.id) throw new Error("Invalid live-agent session.");

    setSessionId(data.id);
    return data.id;
  }

  async function sendMessage(text = input) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setInput("");
    setMessages((current) => [...current, { role: "visitor", text: trimmed }]);
    setLoading(true);

    try {
      const id = await ensureSession();
      const response = await fetch(liveAgentEndpoints.message, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: id, message: trimmed }),
      });

      if (!response.ok) throw new Error("Unable to answer live-agent message.");
      const data = (await response.json()) as { message?: { message_text?: unknown } };
      const reply =
        typeof data.message?.message_text === "string" && data.message.message_text.trim()
          ? data.message.message_text
          : "暫時未能回答，請稍後再試。";

      setMessages((current) => [...current, { role: "assistant", text: reply }]);
    } catch {
      setMessages((current) => [
        ...current,
        { role: "assistant", text: "暫時未能連線，請稍後再試。" },
      ]);
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <Button
        className="fixed bottom-4 right-4 z-50 h-11 rounded-full px-4 shadow-lg sm:bottom-5 sm:right-5"
        onClick={() => setOpen(true)}
        type="button"
      >
        <MessageCircle className="mr-2 h-5 w-5" />
        問樓助手
      </Button>
    );
  }

  return (
    <div
      aria-label="Earnest Property live agent"
      className="fixed bottom-3 right-3 z-50 flex h-[min(520px,calc(100vh-1.5rem))] w-[min(390px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border bg-background shadow-xl sm:bottom-5 sm:right-5"
      role="dialog"
    >
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">Earnest 問樓助手</p>
          <p className="truncate text-xs text-muted-foreground">公開物業資料查詢</p>
        </div>
        <Button
          aria-label="Close live agent"
          onClick={() => setOpen(false)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div aria-live="polite" className="flex-1 space-y-3 overflow-y-auto p-3">
        <div className="flex flex-wrap gap-2">
          {["買樓", "租樓", "放盤估價", "問屋苑"].map((choice) => (
            <Button
              disabled={loading}
              key={choice}
              onClick={() => sendMessage(choice)}
              size="sm"
              type="button"
              variant="outline"
            >
              {choice}
            </Button>
          ))}
        </div>

        {messages.map((message, index) => (
          <div
            className={
              message.role === "visitor"
                ? "ml-8 whitespace-pre-wrap rounded-lg bg-primary p-3 text-sm text-primary-foreground"
                : "mr-8 whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm text-foreground"
            }
            key={`${message.role}-${index}`}
          >
            {message.text}
          </div>
        ))}

        {loading ? (
          <div className="mr-8 flex items-center gap-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            回覆中
          </div>
        ) : null}
        <div ref={scrollRef} />
      </div>

      <form
        className="flex gap-2 border-t p-3"
        onSubmit={(event) => {
          event.preventDefault();
          sendMessage();
        }}
      >
        <Input
          aria-label="Live agent message"
          autoComplete="off"
          onChange={(event) => setInput(event.target.value)}
          placeholder="輸入問題..."
          value={input}
        />
        <Button disabled={loading || !input.trim()} size="icon" type="submit" aria-label="Send">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}

function readOrCreateAnonymousId() {
  try {
    const current = window.localStorage.getItem(anonymousStorageKey);
    if (current) return current;

    const next =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `anon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(anonymousStorageKey, next);
    return next;
  } catch {
    return null;
  }
}
