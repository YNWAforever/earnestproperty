import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { LoaderCircle, MessageCircle, Phone, Send, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  formatHandoffPhoneForDisplay,
  liveAgentPhoneErrorFromBody,
  liveAgentPhoneErrorMessage,
  validateHandoffPhone,
} from "@/lib/ai/live-agent";
import { isInternalCardHref, type LiveAgentCard } from "@/lib/ai/live-agent-reply";

import {
  LIVE_AGENT_ICON_CLASS,
  LIVE_AGENT_LABEL_CLASS,
  liveAgentTriggerClass,
} from "./live-agent-trigger";
import { nextHandoffOffered, readLiveAgentMessageResponse } from "./live-agent-widget-state";

const liveAgentEndpoints = {
  session: "/api/live-agent/session",
  message: "/api/live-agent/message",
  handoff: "/api/live-agent/handoff",
} as const;
// Route coverage: api\/live-agent\/session api\/live-agent\/message api\/live-agent\/handoff

const anonymousStorageKey = "earnest-live-agent-anonymous-id";

type Message = { role: "assistant" | "visitor"; text: string; cards?: LiveAgentCard[] };

const initialMessages: Message[] = [
  {
    role: "assistant",
    text: "你好，我是 Earnest Property 問樓助手。想買樓、租樓、放盤估價，還是查詢屋苑資料？",
  },
];

const handoffPhoneErrorId = "live-agent-handoff-phone-error";
const handoffPhonePreviewId = "live-agent-handoff-phone-preview";

type LiveAgentHandoffPanelProps = {
  phone: string;
  phoneTouched: boolean;
  consent: boolean;
  loading: boolean;
  serverError: string | null;
  onPhoneChange: (value: string) => void;
  onPhoneBlur: () => void;
  onConsentChange: (value: boolean) => void;
  onSubmit: () => void;
};

// The same validator the handoff route uses, so the button is enabled only for a phone the
// server will accept. `serverError` is client-side copy chosen by `liveAgentPhoneErrorFromBody`,
// never raw response text.
export function LiveAgentHandoffPanel({
  phone,
  phoneTouched,
  consent,
  loading,
  serverError,
  onPhoneChange,
  onPhoneBlur,
  onConsentChange,
  onSubmit,
}: LiveAgentHandoffPanelProps) {
  const check = validateHandoffPhone(phone);
  const error =
    serverError ??
    (phoneTouched && phone.trim() && !check.ok ? liveAgentPhoneErrorMessage(check.code) : null);
  const describedBy = error ? handoffPhoneErrorId : check.ok ? handoffPhonePreviewId : undefined;

  return (
    <div className="space-y-2 border-t pt-3">
      <Input
        value={phone}
        onChange={(event) => onPhoneChange(event.target.value)}
        onBlur={onPhoneBlur}
        placeholder="WhatsApp 電話"
        aria-label="轉接 WhatsApp 電話"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        autoComplete="tel"
        inputMode="tel"
      />
      {error ? (
        <p id={handoffPhoneErrorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : check.ok ? (
        <p id={handoffPhonePreviewId} className="text-xs text-muted-foreground">
          代理會用 {formatHandoffPhoneForDisplay(check.normalized)} 聯絡你
        </p>
      ) : null}
      <label className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <Checkbox
          checked={consent}
          onCheckedChange={(checked) => onConsentChange(checked === true)}
          aria-label="同意 WhatsApp 跟進聯絡"
        />
        <span>我同意 Earnest Property 透過 WhatsApp 聯絡我跟進今次查詢。</span>
      </label>
      <Button onClick={onSubmit} type="button" variant="outline" disabled={loading || !check.ok}>
        {loading ? (
          <LoaderCircle className="h-4 w-4 animate-spin" />
        ) : (
          <Phone className="h-4 w-4" />
        )}
        轉介代理
      </Button>
    </div>
  );
}

// Card links are plain <a> to internal pages only (property, estate, listings search): the
// widget also renders with no router, and a full page load to a property page is fine. Any
// other href renders the title as text.
export function LiveAgentReplyCards({ cards }: { cards: LiveAgentCard[] }) {
  if (cards.length === 0) return null;
  return (
    <ul className="mt-2 space-y-2">
      {cards.map((card, index) => (
        <li
          className="rounded-md border bg-background p-2 text-xs break-words"
          key={`${card.type}-${index}`}
        >
          {isInternalCardHref(card.href) ? (
            <a
              href={card.href ?? undefined}
              className="inline-block rounded-sm py-1 font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              {card.title}
            </a>
          ) : (
            <p className="font-medium">{card.title}</p>
          )}
          {card.lines.map((line, lineIndex) => (
            <p className="text-muted-foreground" key={lineIndex}>
              {line}
            </p>
          ))}
        </li>
      ))}
    </ul>
  );
}

export function LiveAgentWidget({ initiallyOpen = false }: { initiallyOpen?: boolean } = {}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [handoffPhone, setHandoffPhone] = useState("");
  const [handoffPhoneTouched, setHandoffPhoneTouched] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [handoffConsent, setHandoffConsent] = useState(false);
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [handoffOffered, setHandoffOffered] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const showHandoffPanel = handoffOffered;

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ block: "end" });
  }, [messages, loading]);

  async function ensureSession() {
    if (sessionId && accessToken) return { id: sessionId, token: accessToken };

    const response = await fetch(liveAgentEndpoints.session, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        anonymousId: readOrCreateAnonymousId(),
        sourcePath: window.location.pathname,
      }),
    });

    if (!response.ok) throw new Error("Unable to start live-agent session.");
    const data = (await response.json()) as { id?: unknown; accessToken?: unknown };
    if (typeof data.id !== "string" || !data.id) throw new Error("Invalid live-agent session.");
    if (typeof data.accessToken !== "string" || !data.accessToken) {
      throw new Error("Invalid live-agent session.");
    }

    setSessionId(data.id);
    setAccessToken(data.accessToken);
    return { id: data.id, token: data.accessToken };
  }

  async function sendMessage(text = input) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setInput("");
    setMessages((current) => [...current, { role: "visitor", text: trimmed }]);
    setLoading(true);

    try {
      const { id, token } = await ensureSession();
      const response = await fetch(liveAgentEndpoints.message, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: id, accessToken: token, message: trimmed }),
      });

      if (!response.ok) throw new Error("Unable to answer live-agent message.");
      const data = (await response.json()) as { handoffSuggested?: unknown } | null;
      const reply = readLiveAgentMessageResponse(data);

      setMessages((current) => [
        ...current,
        { role: "assistant", text: reply.text, cards: reply.cards },
      ]);
      // The server decides, but a reply with nothing usable (no text, or a listings reply with
      // no safe listing card) always offers the handoff so the enquiry is never lost.
      setHandoffOffered((current) => nextHandoffOffered(current, data ?? {}) || !reply.usable);
    } catch {
      setMessages((current) => [
        ...current,
        { role: "assistant", text: "暫時未能連線，請稍後再試。" },
      ]);
      // Never lose an enquiry: a failed send (5xx, network error) still lets the visitor leave a
      // WhatsApp number.
      setHandoffOffered(true);
    } finally {
      setLoading(false);
    }
  }

  async function requestHandoff() {
    if (handoffLoading || !validateHandoffPhone(handoffPhone).ok) return;

    setHandoffLoading(true);
    try {
      const { id, token } = await ensureSession();
      const response = await fetch(liveAgentEndpoints.handoff, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: id,
          accessToken: token,
          phone: handoffPhone,
          intent: "buyer",
          opt_in_whatsapp: handoffConsent,
        }),
      });
      if (!response.ok) {
        // Only the two phone codes map to client copy; any other failure keeps the generic
        // message below and the server's text is never shown.
        const body: unknown = await response.json().catch(() => null);
        const phoneError = liveAgentPhoneErrorFromBody(body);
        if (phoneError) {
          setHandoffError(phoneError);
          return;
        }
        throw new Error("Unable to request live-agent handoff.");
      }

      setHandoffError(null);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: "已記錄跟進要求。請確認 WhatsApp 電話正確，代理會跟進。",
        },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        { role: "assistant", text: "暫時未能記錄轉介要求，請稍後再試。" },
      ]);
    } finally {
      setHandoffLoading(false);
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen} modal={false}>
      <DialogPrimitive.Trigger asChild>
        <Button aria-label="問樓助手" className={liveAgentTriggerClass()} type="button">
          <MessageCircle className={LIVE_AGENT_ICON_CLASS} />
          <span className={LIVE_AGENT_LABEL_CLASS}>問樓助手</span>
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className="fixed bottom-3 right-3 z-50 flex h-[min(520px,calc(100dvh-1.5rem))] w-[min(390px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border bg-background shadow-xl sm:bottom-5 sm:right-5"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <div className="flex items-center justify-between gap-3 border-b px-3 py-2.5">
            <div className="min-w-0">
              <DialogPrimitive.Title className="truncate text-sm font-semibold text-foreground">
                Earnest 問樓助手
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="truncate text-xs text-muted-foreground">
                公開物業資料查詢
              </DialogPrimitive.Description>
            </div>
            <Button
              aria-label="關閉即時客服"
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
                {message.cards?.length ? (
                  <>
                    <p>{message.text}</p>
                    <LiveAgentReplyCards cards={message.cards} />
                  </>
                ) : (
                  message.text
                )}
              </div>
            ))}

            {loading ? (
              <div className="mr-8 flex items-center gap-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                回覆中
              </div>
            ) : null}
            {showHandoffPanel ? (
              <LiveAgentHandoffPanel
                phone={handoffPhone}
                phoneTouched={handoffPhoneTouched}
                consent={handoffConsent}
                loading={handoffLoading}
                serverError={handoffError}
                onPhoneChange={(value) => {
                  setHandoffPhone(value);
                  setHandoffError(null);
                }}
                onPhoneBlur={() => setHandoffPhoneTouched(true)}
                onConsentChange={setHandoffConsent}
                onSubmit={requestHandoff}
              />
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
              ref={inputRef}
              aria-label="即時客服訊息"
              autoComplete="off"
              onChange={(event) => setInput(event.target.value)}
              placeholder="輸入問題..."
              value={input}
            />
            <Button disabled={loading || !input.trim()} size="icon" type="submit" aria-label="傳送">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
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
