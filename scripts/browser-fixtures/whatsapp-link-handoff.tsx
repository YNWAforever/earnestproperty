import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { WhatsappLinkWizard } from "../../src/components/admin/whatsapp/WhatsappLinkWizard";
import type { LinkOfferSelection } from "../../src/lib/admin/whatsapp-link-selection";
// Test entry point mounts directly; it is not a Fast Refresh module.
// eslint-disable-next-line react-refresh/only-export-components
function Harness() {
  const [seed, setSeed] = useState<LinkOfferSelection[]>([]);
  useEffect(() => {
    Object.assign(window, { injectSelection: setSeed, fixtureReady: true });
  }, []);
  return (
    <WhatsappLinkWizard seed={seed} agents={[]} actorScope="fixture-admin" onCreated={() => {}} />
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
