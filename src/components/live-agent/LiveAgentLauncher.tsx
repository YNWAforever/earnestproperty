import { useState, useEffect, type ComponentType } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
export function LiveAgentLauncher() {
  const [Widget, setWidget] = useState<ComponentType<{ initiallyOpen?: boolean }> | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  if (Widget) return <Widget initiallyOpen />;
  return (
    <Button
      type="button"
      disabled={loading || !ready}
      aria-label="問樓助手"
      className="fixed bottom-4 right-4 z-50 h-11 rounded-full px-4 shadow-lg sm:bottom-5 sm:right-5"
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
      <MessageCircle className="mr-2 h-5 w-5" />
      {loading ? "載入中…" : failed ? "重試問樓助手" : "問樓助手"}
    </Button>
  );
}
