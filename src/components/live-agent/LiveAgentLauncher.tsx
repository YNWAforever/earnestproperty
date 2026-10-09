import { useState, useEffect, type ComponentType } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

import {
  liveAgentTriggerClass,
  liveAgentTriggerIconClass,
  liveAgentTriggerLabelClass,
} from "./live-agent-trigger";

type LiveAgentWidgetProps = {
  initiallyOpen?: boolean;
  docked?: boolean;
  triggerClassName?: string;
};

export function LiveAgentLauncher({ docked = false }: { docked?: boolean } = {}) {
  const [Widget, setWidget] = useState<ComponentType<LiveAgentWidgetProps> | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  if (Widget) {
    return (
      <Widget initiallyOpen docked={docked} triggerClassName={liveAgentTriggerClass(docked)} />
    );
  }
  return (
    <Button
      type="button"
      disabled={loading || !ready}
      aria-label="問樓助手"
      className={liveAgentTriggerClass(docked)}
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
      <MessageCircle className={liveAgentTriggerIconClass(docked)} />
      <span className={liveAgentTriggerLabelClass(docked)}>
        {loading ? "載入中…" : failed ? "重試問樓助手" : "問樓助手"}
      </span>
    </Button>
  );
}
