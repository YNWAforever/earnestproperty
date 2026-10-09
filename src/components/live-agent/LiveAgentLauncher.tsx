import { useState, useEffect, type ComponentType } from "react";
import { LoaderCircle, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

import {
  LIVE_AGENT_FAILED_DOT_CLASS,
  LIVE_AGENT_ICON_CLASS,
  LIVE_AGENT_ICON_LOADING_CLASS,
  LIVE_AGENT_LABEL_CLASS,
  LIVE_AGENT_SPINNER_CLASS,
  liveAgentTriggerClass,
} from "./live-agent-trigger";

export function LiveAgentLauncher() {
  const [Widget, setWidget] = useState<ComponentType<{ initiallyOpen?: boolean }> | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  if (Widget) return <Widget initiallyOpen />;
  // The label is also the accessible name, so the loading and retry states are announced
  // even where the visible label is hidden (docked beside a mobile bar).
  const label = loading ? "載入中…" : failed ? "重試問樓助手" : "問樓助手";
  return (
    <Button
      type="button"
      disabled={loading || !ready}
      aria-label={label}
      className={liveAgentTriggerClass()}
      onClick={async () => {
        setLoading(true);
        setFailed(false);
        try {
          const module = await import("./LiveAgentWidget");
          setWidget(() => module.LiveAgentWidget);
        } catch {
          setFailed(true);
        } finally {
          setLoading(false);
        }
      }}
    >
      <MessageCircle className={loading ? LIVE_AGENT_ICON_LOADING_CLASS : LIVE_AGENT_ICON_CLASS} />
      {loading ? <LoaderCircle aria-hidden className={LIVE_AGENT_SPINNER_CLASS} /> : null}
      <span className={LIVE_AGENT_LABEL_CLASS}>{label}</span>
      {failed ? (
        <span aria-hidden className={LIVE_AGENT_FAILED_DOT_CLASS} data-live-agent-failed />
      ) : null}
    </Button>
  );
}
