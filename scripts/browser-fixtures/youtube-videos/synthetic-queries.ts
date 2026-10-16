import type { VideosFixtureData } from "./data";

export async function fetchVideosPageData(): Promise<VideosFixtureData> {
  const response = await fetch("/__fixture/videos.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Synthetic loopback loader failed");
  return response.json();
}
