import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/district/ting-kau")({
  beforeLoad: () => {
    throw redirect({
      to: "/castle-peak-road/$segment",
      params: { segment: "ting-kau" },
      statusCode: 301,
    });
  },
});
