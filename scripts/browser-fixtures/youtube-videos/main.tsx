import { createRoot } from "react-dom/client";
import { Route } from "@/routes/videos";
import {
  YouTubeSyncStatusPanel,
  YouTubeSyncStatusView,
} from "@/components/admin/YouTubeSyncStatus";
import { setLoaderData } from "./router";
import { statusCases, type StatusCase } from "./status-data";
import "@/styles.css";

async function start() {
  let component;
  if (location.pathname === "/__fixture/status") {
    const params = new URLSearchParams(location.search);
    if (params.has("panel")) {
      component = <YouTubeSyncStatusPanel />;
    } else {
      const name = params.get("case") as StatusCase;
      if (!Object.hasOwn(statusCases, name)) throw new Error("Unknown synthetic status");
      component = <YouTubeSyncStatusView status={statusCases[name]} />;
    }
  } else {
    // Import and render the actual route component, including its real loader
    // option. The only data source is the owned, no-store loopback JSON response.
    const loader = Route.options.loader;
    if (typeof loader !== "function") throw new Error("Videos fixture requires a function loader");
    setLoaderData(await loader({} as never));
    const Component = Route.options.component!;
    component = <Component />;
  }
  createRoot(document.getElementById("root")!).render(
    <>
      <p role="note">SYNTHETIC FIXTURE ONLY</p>
      {component}
    </>,
  );
}

void start();
