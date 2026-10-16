import { z } from "zod";

import { getYouTubeVideoId } from "../youtube-video-url.js";
import { canonicalYouTubeUrl, planManualAdoptions } from "./youtube-reconciliation";
import { YOUTUBE_CHANNEL_ID, type YouTubeVideo } from "./youtube-sync.types";

const MAX_ROWS = 10_000;
const videoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/, "Invalid YouTube video ID");

// Date.parse accepts rollover dates and timestamps without a timezone.
function validTimestamp(value: string): boolean {
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!parts) return false;
  const [, year, month, day, hour, minute, second, zone] = parts;
  const leap = +year % 4 === 0 && (+year % 100 !== 0 || +year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    +month >= 1 &&
    +month <= 12 &&
    +day >= 1 &&
    +day <= days[+month - 1] &&
    +hour < 24 &&
    +minute < 60 &&
    +second < 60 &&
    (zone === "Z" ||
      (+zone.slice(1, 3) <= 14 &&
        +zone.slice(4) < 60 &&
        (+zone.slice(1, 3) !== 14 || +zone.slice(4) === 0))) &&
    Number.isFinite(Date.parse(value))
  );
}

const timestampSchema = z
  .string()
  .refine(validTimestamp, "Invalid timestamp; use ISO date/time with timezone");
const evidenceSchema = z
  .object({
    capturedAt: timestampSchema,
    complete: z.boolean(),
    synthetic: z.boolean(),
  })
  .strict();
export type YouTubePreviewUpload = Omit<YouTubeVideo, "description"> & {
  description: string | null;
};

const uploadSchema: z.ZodType<YouTubePreviewUpload> = z
  .object({
    videoId: videoIdSchema,
    title: z
      .string()
      .max(2_048)
      .refine((title) => title.trim().length > 0, "Empty video title"),
    description: z.string().max(100_000).nullable(),
    publishedAt: timestampSchema,
    canonicalUrl: z.string().max(2_048),
  })
  .strict();
const rowSchema = z
  .object({
    id: z.string().min(1).max(200),
    title: z.string().max(2_048),
    videoUrl: z.string().max(2_048),
    description: z.string().max(100_000).nullable(),
    publishedAt: timestampSchema.nullable(),
    published: z.boolean().nullable(),
    managed: z.boolean().nullable(),
    available: z.boolean().nullable(),
    sortOrder: z.number().finite().nullable().optional(),
    youtubeVideoId: videoIdSchema.nullable().optional(),
  })
  .strict();
const inputSchema = z
  .object({
    channel: evidenceSchema.extend({ id: z.string(), verified: z.boolean() }).strict(),
    uploads: z.array(uploadSchema).max(MAX_ROWS, "Uploads row limit exceeded"),
    inventory: evidenceSchema
      .extend({
        scope: z.enum(["full_db", "public_only", "unknown"]),
        rows: z.array(rowSchema).max(MAX_ROWS, "Inventory row limit exceeded"),
      })
      .strict(),
    boundaryVideoId: videoIdSchema.nullable(),
  })
  .strict();

export type YouTubeInventoryRow = z.infer<typeof rowSchema>;
export type YouTubePreviewInput = z.infer<typeof inputSchema>;
export type PreviewClassification = "insert" | "adoption" | "changed" | "unchanged" | "unresolved";
type ProposedVideo = {
  title: string;
  videoUrl: string;
  description: string | null;
  publishedAt: string;
  published: boolean | null;
  managed: true;
  available: true;
  sortOrder: number | null;
};
export type YouTubePreviewEntry = {
  videoId: string;
  classification: PreviewClassification;
  candidateEvidence: YouTubePreviewUpload;
  existingEvidence: YouTubeInventoryRow | null;
  proposed: ProposedVideo;
  expectedPublication: {
    published: boolean | null;
    available: true;
    publiclyVisible: boolean | null;
  };
  changeFields: (keyof ProposedVideo)[];
  uncertainties: string[];
  olderThanBoundary: boolean | null;
};
export type YouTubeBackfillPreview = {
  mode: "additive_preview";
  offline: true;
  channelId: typeof YOUTUBE_CHANNEL_ID;
  synthetic: boolean;
  evidence: {
    channel: YouTubePreviewInput["channel"];
    inventory: Omit<YouTubePreviewInput["inventory"], "rows">;
  };
  inventoryIsComplete: boolean;
  exactWriteCounts: null;
  counts: Record<PreviewClassification, number>;
  entries: YouTubePreviewEntry[];
  boundary: {
    videoId: string | null;
    found: boolean;
    olderMissingIds: string[];
  };
  targetedBackfillIds: string[];
  unmatchedInventoryRowIds: string[];
  warnings: string[];
};

function checkedUrlId(value: string): string {
  const id = getYouTubeVideoId(value);
  if (!id || !videoIdSchema.safeParse(id).success) {
    throw new Error("Invalid YouTube video URL or video ID");
  }
  const url = new URL(value);
  const validPath =
    url.hostname.toLowerCase() === "youtu.be"
      ? /^\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname)
      : /^\/watch\/?$/.test(url.pathname) ||
        /^\/(?:shorts|embed)\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname);
  if (url.username || /^https?:\/\/[^/?#]*@/i.test(value.trim()) || url.port || !validPath) {
    throw new Error("Invalid YouTube video URL");
  }
  const queryIds = url.searchParams.getAll("v");
  if (queryIds.some((queryId) => queryId !== id)) {
    throw new Error("Conflicting YouTube URL identity");
  }
  return id;
}

/**
 * File evidence only. Capture completeness is supplied by the caller, not verified
 * here. Classifications are conditional comparisons, never executable write counts.
 */
export function previewYouTubeBackfill(value: unknown): YouTubeBackfillPreview {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid preview input: ${parsed.error.message}`);
  const data = parsed.data;
  if (data.channel.id !== YOUTUBE_CHANNEL_ID || data.channel.verified !== true) {
    throw new Error(`A verified channel ${YOUTUBE_CHANNEL_ID} is required`);
  }
  const incomingIds = new Set<string>();
  for (const video of data.uploads) {
    if (incomingIds.has(video.videoId)) throw new Error("Duplicate upload video ID");
    incomingIds.add(video.videoId);
    if (checkedUrlId(video.canonicalUrl) !== video.videoId) {
      throw new Error("Upload video ID and URL identity conflict");
    }
    if (Date.parse(video.publishedAt) > Date.parse(data.channel.capturedAt)) {
      throw new Error("Upload timestamp is after channel evidence capture");
    }
  }
  const rowIds = new Set<string>();
  const rowsByVideo = new Map<string, YouTubeInventoryRow>();
  for (const row of data.inventory.rows) {
    if (rowIds.has(row.id)) throw new Error("Duplicate inventory row ID");
    rowIds.add(row.id);
    const id = checkedUrlId(row.videoUrl);
    if (rowsByVideo.has(id)) throw new Error("Duplicate inventory YouTube identity");
    if (row.youtubeVideoId != null && (row.youtubeVideoId !== id || row.managed === false)) {
      throw new Error("Inventory managed ID and URL identity conflict");
    }
    if (row.managed === true && row.youtubeVideoId === null) {
      throw new Error("Managed inventory row has a null YouTube identity");
    }
    if (
      row.publishedAt !== null &&
      Date.parse(row.publishedAt) > Date.parse(data.inventory.capturedAt)
    ) {
      throw new Error("Inventory publication timestamp is after evidence capture");
    }
    rowsByVideo.set(id, row);
  }

  const inventoryIsComplete = data.inventory.scope === "full_db" && data.inventory.complete;
  const normalized = data.uploads.map((video) => ({
    ...video,
    canonicalUrl: canonicalYouTubeUrl(video.videoId),
  }));
  const adoptions = new Map(
    planManualAdoptions(
      normalized.filter((video): video is YouTubeVideo => video.description !== null),
      data.inventory.rows.filter((row) => row.managed === false),
    ).map((video) => [video.videoId, video.adoptionId]),
  );
  const boundary = data.uploads.find((video) => video.videoId === data.boundaryVideoId);
  const warnings = [
    "Offline conditional comparison only; exact database writes are unknown until identity/CAS checks at execution.",
    "Never infer deletes, unavailability or source absence from missing evidence. No reconciliation of absent rows.",
    "Unchanged means compared content is unchanged; the writer may still update bookkeeping timestamps.",
    "Verification and completeness flags describe supplied file evidence; they are not independently verified here.",
  ];
  if (data.channel.synthetic || data.inventory.synthetic) {
    warnings.push(
      "SYNTHETIC evidence: sample comparison only; no live verification or acceptance claim.",
    );
  }
  if (!inventoryIsComplete) {
    warnings.push(
      `Incomplete ${data.inventory.scope} inventory: unseen IDs may be hidden or existing DB rows; insert/adoption and publication remain unresolved.`,
    );
  }
  if (!data.channel.complete) {
    warnings.push(
      "Incomplete channel evidence: only supplied uploads are compared; channel coverage is unknown.",
    );
  }
  if (data.boundaryVideoId && !boundary) {
    warnings.push(
      "Saved boundary was not observed in channel evidence; older-than-boundary status is unknown.",
    );
  }
  if (data.boundaryVideoId === null) {
    warnings.push("Saved boundary was not supplied; older-than-boundary status is unknown.");
  }
  if (data.channel.capturedAt !== data.inventory.capturedAt) {
    warnings.push(
      "Channel and inventory captures differ; concurrent changes between captures are unknown.",
    );
  }
  const entries = data.uploads.map((raw): YouTubePreviewEntry => {
    const existing = rowsByVideo.get(raw.videoId) ?? null;
    const uncertainties: string[] = [];
    if (raw.description === null) {
      uncertainties.push(
        "Provider description is unknown; never substitute public CMS text as source evidence.",
      );
    }
    if (!inventoryIsComplete)
      uncertainties.push(
        "Incomplete inventory; identity conflicts and hidden rows are not excluded.",
      );
    if (!existing) {
      if (!inventoryIsComplete)
        uncertainties.push(
          "Unseen ID may insert, adopt or update an existing hidden row; staff fields and publication are unknown.",
        );
    } else {
      for (const field of ["managed", "published", "available", "publishedAt"] as const) {
        if (existing[field] === null) uncertainties.push(`Existing ${field} is unknown.`);
      }
      if (existing.sortOrder == null)
        uncertainties.push("Existing sort order is unknown and must be preserved.");
    }
    const isInsert = !existing && inventoryIsComplete && raw.description !== null;
    // Unknown descriptions cannot enter the writer's YouTubeVideo contract.
    // Their manual identity is still observable after the unique-URL checks above.
    const adoption =
      existing?.managed === false &&
      (raw.description === null || adoptions.get(raw.videoId) === existing.id);
    const missingRequiredDescription =
      raw.description === null && (!existing || (adoption && existing.description === null));
    const published = existing ? existing.published : isInsert ? true : null;
    const proposed: ProposedVideo = {
      title: raw.title,
      videoUrl: canonicalYouTubeUrl(raw.videoId),
      description: existing
        ? adoption
          ? (existing.description ?? raw.description)
          : existing.description
        : isInsert
          ? raw.description
          : null,
      publishedAt: raw.publishedAt,
      published,
      managed: true,
      available: true,
      sortOrder: existing ? (existing.sortOrder ?? null) : isInsert ? 1000 : null,
    };
    const changeFields: (keyof ProposedVideo)[] = [];
    if (existing) {
      for (const field of [
        "title",
        "videoUrl",
        "publishedAt",
        "managed",
        "available",
        "description",
      ] as const) {
        if (field === "publishedAt" && existing.publishedAt !== null) {
          if (Date.parse(existing.publishedAt) !== Date.parse(proposed.publishedAt))
            changeFields.push(field);
        } else if (existing[field] !== proposed[field] && existing[field] !== null) {
          changeFields.push(field);
        } else if (
          field === "description" &&
          existing.description === null &&
          proposed.description !== null
        ) {
          changeFields.push(field);
        }
      }
    }
    const knownExisting =
      existing &&
      existing.managed !== null &&
      existing.published !== null &&
      existing.available !== null &&
      (adoption || existing.publishedAt !== null);
    const classification: PreviewClassification = isInsert
      ? "insert"
      : !inventoryIsComplete || !knownExisting || missingRequiredDescription
        ? "unresolved"
        : adoption
          ? "adoption"
          : changeFields.length
            ? "changed"
            : "unchanged";
    const sameBoundaryTime =
      boundary &&
      raw.videoId !== boundary.videoId &&
      Date.parse(raw.publishedAt) === Date.parse(boundary.publishedAt);
    if (sameBoundaryTime)
      uncertainties.push("Same timestamp as boundary; upload ordering is unknown.");
    return {
      videoId: raw.videoId,
      classification,
      candidateEvidence: { ...raw },
      existingEvidence: existing ? { ...existing } : null,
      proposed,
      expectedPublication: { published, available: true, publiclyVisible: published },
      changeFields,
      uncertainties,
      olderThanBoundary:
        boundary && !sameBoundaryTime
          ? Date.parse(raw.publishedAt) < Date.parse(boundary.publishedAt)
          : null,
    };
  });
  const missingEntries = entries.filter((entry) => entry.existingEvidence === null);
  const counts: Record<PreviewClassification, number> = {
    insert: 0,
    adoption: 0,
    changed: 0,
    unchanged: 0,
    unresolved: 0,
  };
  for (const entry of entries) counts[entry.classification]++;
  const { rows: _rows, ...inventoryEvidence } = data.inventory;
  return {
    mode: "additive_preview",
    offline: true,
    channelId: YOUTUBE_CHANNEL_ID,
    synthetic: data.channel.synthetic || data.inventory.synthetic,
    evidence: { channel: { ...data.channel }, inventory: inventoryEvidence },
    inventoryIsComplete,
    exactWriteCounts: null,
    counts,
    entries,
    boundary: {
      videoId: data.boundaryVideoId,
      found: Boolean(boundary),
      olderMissingIds: missingEntries
        .filter((entry) => entry.olderThanBoundary)
        .map((entry) => entry.videoId),
    },
    targetedBackfillIds: missingEntries.map((entry) => entry.videoId),
    unmatchedInventoryRowIds: data.inventory.rows
      .filter((row) => !incomingIds.has(checkedUrlId(row.videoUrl)))
      .map((row) => row.id),
    warnings,
  };
}
