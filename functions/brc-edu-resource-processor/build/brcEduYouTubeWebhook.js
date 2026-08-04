import { app } from "@azure/functions";
import { RED_BRC_EDU_SYNC_SECRET_HEADER, RED_BRC_YOUTUBE_SYNC_ENDPOINT_ENV, RED_BRC_YOUTUBE_SYNC_SECRET_ENV, RED_BRC_YOUTUBE_WEBHOOK_FORWARD_ENV, } from "./constants.js";
/**
 * Optional Function-hosted YouTube PubSubHubbub endpoint.
 * Prefer pointing YouTube at Red `/internal/brc-edu/youtube/webhook` when possible.
 * This Function forwards verified notifications to Red's service sync endpoint.
 */
export async function brcEduYouTubeWebhook(request, context) {
    if (request.method === "GET") {
        const hubChallenge = request.query.get("hub.challenge") ?? "";
        if (hubChallenge) {
            return {
                status: 200,
                headers: { "Content-Type": "text/plain; charset=utf-8" },
                body: hubChallenge,
            };
        }
        return { status: 400, body: "Missing hub challenge." };
    }
    if (request.method !== "POST") {
        return { status: 405, body: "Method not allowed." };
    }
    const body = await request.text();
    const looksValid = body.includes("<entry") ||
        body.includes("yt:videoId") ||
        body.includes("youtube.com");
    if (!looksValid) {
        return { status: 400, body: "Unrecognized notification." };
    }
    const forward = process.env[RED_BRC_YOUTUBE_WEBHOOK_FORWARD_ENV]?.trim().toLowerCase() !==
        "false";
    if (forward) {
        const endpoint = process.env[RED_BRC_YOUTUBE_SYNC_ENDPOINT_ENV]?.trim();
        const secret = process.env[RED_BRC_YOUTUBE_SYNC_SECRET_ENV]?.trim();
        if (!endpoint || !secret) {
            context.error("YouTube webhook received but Red sync endpoint/secret is not configured.");
        }
        else {
            try {
                const response = await fetch(endpoint, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        [RED_BRC_EDU_SYNC_SECRET_HEADER]: secret,
                        "x-red-youtube-sync-source": "webhook",
                    },
                    body: "{}",
                });
                if (!response.ok) {
                    context.error(`YouTube webhook forward failed (${response.status}).`);
                }
                else {
                    context.log("YouTube webhook forwarded to Red sync.");
                }
            }
            catch (error) {
                context.error(`YouTube webhook forward error: ${error instanceof Error ? error.message : "unknown"}`);
            }
        }
    }
    return { status: 204 };
}
app.http("brcEduYouTubeWebhook", {
    methods: ["GET", "POST"],
    authLevel: "anonymous",
    route: "brc-edu/youtube/webhook",
    handler: brcEduYouTubeWebhook,
});
