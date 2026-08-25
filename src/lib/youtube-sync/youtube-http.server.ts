import "@tanstack/react-start/server-only";

import { z } from "zod";

import { writeAudit as defaultWriteAudit } from "@/lib/control-plane/audit.server";
import { requireStaffPermission as defaultRequireStaffPermission } from "@/lib/control-plane/permissions";
import { createOperationContext } from "@/lib/control-plane/request-context";
import type { StaffAccess } from "@/lib/neon/auth.server";

import { runYouTubeSync } from "./youtube-sync.server";
import {
  YOUTUBE_CHANNEL_ID,
  YouTubeSyncError,
  type YouTubeSyncMode,
  type YouTubeSyncOutcome,
  type YouTubeSyncTrigger,
} from "./youtube-sync.types";

const staffBodySchema = z.object({ mode: z.enum(["incremental", "full"]) }).strict();

type Context = { requestId: string; startedAt: string };
type Dependencies = {
  cronSecret: () => string | undefined;
  requireStaffPermission: (request: Request, permission: "cms.publish") => Promise<StaffAccess>;
  writeAudit: typeof defaultWriteAudit;
  createContext: () => Context;
  runSync: (input: {
    mode: YouTubeSyncMode;
    trigger: YouTubeSyncTrigger;
  }) => Promise<YouTubeSyncOutcome>;
};

const publicMessages = {
  youtube_quota_exhausted: "YouTube quota is exhausted.",
  youtube_auth_failed: "YouTube synchronization is not configured.",
  youtube_rate_limited: "YouTube rate-limited the synchronization request.",
  youtube_unavailable: "YouTube is temporarily unavailable.",
  youtube_invalid_snapshot: "YouTube returned an invalid snapshot.",
  youtube_sync_in_progress: "A YouTube synchronization is already running.",
  youtube_lease_lost: "The YouTube synchronization lease was lost.",
  youtube_validation_error: "The YouTube synchronization request is invalid.",
} as const;

function errorStatus(code: keyof typeof publicMessages) {
  if (code === "youtube_rate_limited") return 429;
  if (code === "youtube_invalid_snapshot") return 502;
  if (code === "youtube_sync_in_progress" || code === "youtube_lease_lost") return 409;
  if (code === "youtube_validation_error") return 400;
  return 503;
}

function safeErrorResponse(error: unknown, cron: boolean) {
  if (error instanceof YouTubeSyncError) {
    const status = cron && error.code === "youtube_lease_lost" ? 503 : errorStatus(error.code);
    return Response.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: publicMessages[error.code],
          retryable: error.retryable,
        },
      },
      { status },
    );
  }
  return Response.json(
    {
      ok: false,
      error: {
        code: "internal_error",
        message: "The synchronization could not be completed.",
        retryable: false,
      },
    },
    { status: 500 },
  );
}

function success(outcome: YouTubeSyncOutcome, staff: boolean) {
  if (outcome.status === "skipped") {
    if (staff) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "youtube_sync_in_progress",
            message: publicMessages.youtube_sync_in_progress,
            retryable: true,
          },
        },
        { status: 409 },
      );
    }
    return Response.json({ ok: true, status: "skipped", reason: outcome.reason }, { status: 200 });
  }
  return Response.json({ ok: true, status: "completed", ...outcome.summary });
}

export function createYouTubeSyncHttpHandlers(overrides: Partial<Dependencies> = {}) {
  const dependencies: Dependencies = {
    cronSecret: () => process.env.CRON_SECRET,
    requireStaffPermission: defaultRequireStaffPermission,
    writeAudit: defaultWriteAudit,
    createContext: createOperationContext,
    runSync: runYouTubeSync,
    ...overrides,
  };

  async function writeAuditSafely(input: Parameters<Dependencies["writeAudit"]>[0]) {
    try {
      await dependencies.writeAudit(input);
      return true;
    } catch {
      return false;
    }
  }

  async function cron(request: Request, mode: YouTubeSyncMode) {
    const expected = dependencies.cronSecret();
    if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    try {
      return success(await dependencies.runSync({ mode, trigger: "cron" }), false);
    } catch (error) {
      return safeErrorResponse(error, true);
    }
  }

  async function staff(request: Request) {
    const context = dependencies.createContext();
    let actor: StaffAccess;
    try {
      actor = await dependencies.requireStaffPermission(request, "cms.publish");
    } catch (error) {
      if (error instanceof Response) return error;
      return safeErrorResponse(error, false);
    }

    const parsed = staffBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      const audited = await writeAuditSafely({
        actor,
        permission: "cms.publish",
        action: "youtube.sync.manual",
        resourceType: "youtube_channel",
        resourceId: YOUTUBE_CHANNEL_ID,
        outcome: "failure",
        context,
        metadata: { code: "VALIDATION_ERROR" },
      });
      if (!audited) return safeErrorResponse(null, false);
      return Response.json(
        {
          ok: false,
          error: {
            code: "validation_error",
            message: "Mode must be incremental or full.",
          },
        },
        { status: 400 },
      );
    }

    let outcome: YouTubeSyncOutcome;
    try {
      outcome = await dependencies.runSync({ mode: parsed.data.mode, trigger: "staff" });
    } catch (error) {
      await writeAuditSafely({
        actor,
        permission: "cms.publish",
        action: "youtube.sync.manual",
        resourceType: "youtube_channel",
        resourceId: YOUTUBE_CHANNEL_ID,
        outcome: "failure",
        context,
        metadata: {
          mode: parsed.data.mode,
          code: error instanceof YouTubeSyncError ? error.code : "internal_error",
        },
      });
      return safeErrorResponse(error, false);
    }

    const audited = await writeAuditSafely({
      actor,
      permission: "cms.publish",
      action: "youtube.sync.manual",
      resourceType: "youtube_channel",
      resourceId: YOUTUBE_CHANNEL_ID,
      outcome: outcome.status === "completed" ? "success" : "failure",
      context,
      metadata:
        outcome.status === "completed"
          ? outcome.summary
          : { mode: parsed.data.mode, reason: outcome.reason },
    });
    if (!audited) return safeErrorResponse(null, false);
    return success(outcome, true);
  }

  return { cron, staff };
}
