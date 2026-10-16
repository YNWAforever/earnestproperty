import { renderToStaticMarkup } from "react-dom/server";
import { YouTubeSyncStatusView } from "@/components/admin/YouTubeSyncStatus";
import { statusCases, type StatusCase } from "./status-data";

export function renderStatus(name: StatusCase) {
  return renderToStaticMarkup(<YouTubeSyncStatusView status={statusCases[name]} />);
}
