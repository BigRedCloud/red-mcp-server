import type { Request } from "express";

import {
  loadYouTubeVideosForAdmin,
  runYouTubeCatalogSync,
  updateYouTubeVideoVisibility,
} from "./youtube-sync-service.js";
import { getBrcEduSyncSecret } from "../../edu/brc_edu_synced_store.js";
import { timingSafeEqual } from "node:crypto";

function secretsMatch(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function authorizeYouTubeServiceSyncSecret(
  providedSecret: string | undefined,
): { ok: true } | { ok: false; status: 401 | 503; error: string } {
  const configured = getBrcEduSyncSecret();
  if (!configured) {
    return {
      ok: false,
      status: 503,
      error: "YouTube service sync is not configured.",
    };
  }

  const normalized = providedSecret?.trim() ?? "";
  if (!normalized || !secretsMatch(configured, normalized)) {
    return { ok: false, status: 401, error: "Unauthorized." };
  }

  return { ok: true };
}

export async function handleYouTubeAdminListVideos(): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const result = await loadYouTubeVideosForAdmin();
  if (!result.ok) {
    return { status: result.status, body: { error: result.error } };
  }

  return {
    status: 200,
    body: {
      videos: result.payload.videos,
      status: result.payload.status,
      counts: result.payload.counts,
    },
  };
}

export async function handleYouTubeAdminManualSync(): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const result = await runYouTubeCatalogSync("manual");
  if (!result.ok) {
    return {
      status: 503,
      body: {
        ok: false,
        error: result.error,
        preservedPreviousCatalog: result.preservedPreviousCatalog,
        status: result.status,
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      counts: result.counts,
      status: result.status,
      videos: result.catalog.items,
    },
  };
}

export async function handleYouTubeServiceSync(
  source: "timer" | "webhook" = "timer",
): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const result = await runYouTubeCatalogSync(source);
  if (!result.ok) {
    return {
      status: 503,
      body: {
        ok: false,
        error: result.error,
        preservedPreviousCatalog: result.preservedPreviousCatalog,
        status: result.status,
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      counts: result.counts,
      status: result.status,
    },
  };
}

export async function handleYouTubeVisibilityUpdate(params: {
  videoId: string;
  body: unknown;
  excludedBy?: string | null;
}): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const record =
    params.body && typeof params.body === "object"
      ? (params.body as Record<string, unknown>)
      : null;

  if (!record || typeof record.excluded !== "boolean") {
    return {
      status: 400,
      body: { error: 'Request body must include boolean "excluded".' },
    };
  }

  const reason =
    typeof record.reason === "string" ? record.reason.trim() : undefined;

  const result = await updateYouTubeVideoVisibility({
    videoId: params.videoId,
    excluded: record.excluded,
    reason,
    excludedBy: params.excludedBy?.trim() || undefined,
  });

  if (!result.ok) {
    return {
      status: result.status,
      body: { error: result.error },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      video: result.video,
      counts: {
        total: result.catalog.itemCount,
        visible: result.catalog.visibleCount,
        excluded: result.catalog.excludedCount,
      },
    },
  };
}

/**
 * Minimal YouTube PubSubHubbub / Atom notification validation.
 * Accepts hub challenge verification and POST notifications that mention a video id
 * or the configured channel id.
 */
export function handleYouTubeWebhookRequest(req: Request): {
  status: number;
  body?: string;
  contentType?: string;
  shouldSync: boolean;
} {
  const method = req.method.toUpperCase();

  if (method === "GET") {
    const hubMode = String(req.query["hub.mode"] ?? "");
    const hubChallenge = String(req.query["hub.challenge"] ?? "");
    const hubTopic = String(req.query["hub.topic"] ?? "");
    const configuredSecret = process.env.BRC_YOUTUBE_WEBHOOK_SECRET?.trim();
    const hubVerifyToken = String(req.query["hub.verify_token"] ?? "");

    if (configuredSecret && hubVerifyToken && hubVerifyToken !== configuredSecret) {
      return { status: 403, body: "Forbidden", shouldSync: false };
    }

    if (
      (hubMode === "subscribe" || hubMode === "unsubscribe") &&
      hubChallenge
    ) {
      return {
        status: 200,
        body: hubChallenge,
        contentType: "text/plain; charset=utf-8",
        shouldSync: false,
      };
    }

    if (hubTopic) {
      return {
        status: 200,
        body: "ok",
        contentType: "text/plain; charset=utf-8",
        shouldSync: false,
      };
    }

    return { status: 400, body: "Missing hub challenge.", shouldSync: false };
  }

  if (method === "POST") {
    const rawBody =
      typeof req.body === "string"
        ? req.body
        : Buffer.isBuffer(req.body)
          ? req.body.toString("utf8")
          : typeof req.body === "object" && req.body
            ? JSON.stringify(req.body)
            : "";

    const channelId = process.env.BRC_YOUTUBE_CHANNEL_ID?.trim() ?? "";
    const mentionsChannel =
      !channelId ||
      rawBody.includes(channelId) ||
      rawBody.includes("youtube.com") ||
      rawBody.includes("yt:video");
    const looksLikeAtom =
      rawBody.includes("<entry") ||
      rawBody.includes("yt:videoId") ||
      rawBody.includes("videoId");

    if (!mentionsChannel && !looksLikeAtom) {
      return { status: 400, body: "Unrecognized notification.", shouldSync: false };
    }

    return {
      status: 204,
      shouldSync: true,
    };
  }

  return { status: 405, body: "Method not allowed.", shouldSync: false };
}
