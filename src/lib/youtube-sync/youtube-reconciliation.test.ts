import assert from "node:assert/strict";
import { test } from "bun:test";

import {
  canonicalYouTubeUrl,
  hongKongMonthPeriod,
  planManualAdoptions,
  validateYouTubeSnapshot,
} from "./youtube-reconciliation";
import type { YouTubeVideo } from "./youtube-sync.types";

function video(videoId: string, title = videoId): YouTubeVideo {
  return {
    videoId,
    title,
    description: `${title} description`,
    publishedAt: "2026-08-01T00:00:00.000Z",
    canonicalUrl: canonicalYouTubeUrl(videoId),
  };
}

test("canonical watch URLs and Hong Kong periods are deterministic", () => {
  assert.equal(canonicalYouTubeUrl("AAAAAAAAAAA"), "https://www.youtube.com/watch?v=AAAAAAAAAAA");
  assert.equal(hongKongMonthPeriod(new Date("2026-08-31T16:30:00.000Z")), "2026-09-01");
});

test("manual URL variants are adopted in place", () => {
  const [planned] = planManualAdoptions(
    [video("AAAAAAAAAAA")],
    [{ id: "11111111-1111-4111-8111-111111111111", videoUrl: "https://youtu.be/AAAAAAAAAAA" }],
  );
  assert.equal(planned.adoptionId, "11111111-1111-4111-8111-111111111111");
  assert.equal(planned.expectedManualUrl, "https://youtu.be/AAAAAAAAAAA");
});

test("unmatched uploads remain inserts", () => {
  const [planned] = planManualAdoptions(
    [video("BBBBBBBBBBB")],
    [{ id: "11111111-1111-4111-8111-111111111111", videoUrl: "https://youtu.be/AAAAAAAAAAA" }],
  );
  assert.equal(planned.adoptionId, null);
  assert.equal(planned.expectedManualUrl, null);
});

test("two manual rows matching one incoming upload fail before writes", () => {
  assert.throws(
    () =>
      planManualAdoptions(
        [video("AAAAAAAAAAA")],
        [
          { id: "11111111-1111-4111-8111-111111111111", videoUrl: "https://youtu.be/AAAAAAAAAAA" },
          {
            id: "22222222-2222-4222-8222-222222222222",
            videoUrl: "https://youtube.com/watch?v=AAAAAAAAAAA",
          },
        ],
      ),
    (error) =>
      error instanceof Error && "code" in error && error.code === "youtube_invalid_snapshot",
  );
});

test("snapshot validation rejects duplicate and malformed video IDs", () => {
  assert.throws(
    () => validateYouTubeSnapshot([video("AAAAAAAAAAA"), video("AAAAAAAAAAA")]),
    /invalid YouTube snapshot/i,
  );
  assert.throws(() => validateYouTubeSnapshot([video("short")]), /invalid YouTube snapshot/i);
});
