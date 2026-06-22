import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/castle-peak-road")({
  component: CastlePeakRoadLayout,
});

function CastlePeakRoadLayout() {
  return <Outlet />;
}
